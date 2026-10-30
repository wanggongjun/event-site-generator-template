import {api,isUnauthenticated} from '../api';
import {submissionRequest} from './draft-state';

export async function submitRegistration(user:string,id:string,data:unknown,expectedVersion:number,onChecking:()=>void){
 const requestId=submissionRequest(user,id,data);
 try{
  const result=await api('/api/forum/submit',{id,requestId,data,expectedVersion},undefined,{timeoutMs:45000});
  if(result.record?.id!==id||!result.record?.version)throw new Error('Missing saved registration');
  return result.record;
 }catch(e){
  const status=(e as {status?:number})?.status;
  // Explicit validation/auth failures are not ambiguous writes.
  if(status&&status<500&&status!==408)throw e;
  onChecking();
  try{
   const result=await api('/api/forum/submission-result?requestId='+encodeURIComponent(requestId),undefined,undefined,{timeoutMs:15000});
   if(result.state==='completed'&&result.record?.id===id&&result.record?.version)return result.record;
  }catch(checkError){if(isUnauthenticated(checkError))throw checkError;}
  // Retain the idempotency key and form so retry resumes the same operation.
  throw new Error('暂未确认报名结果，填写内容已保留。请稍后重试，将继续处理同一次提交。');
 }
}

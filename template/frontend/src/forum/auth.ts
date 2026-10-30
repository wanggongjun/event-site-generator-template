import {api} from '../api';
let binding:string;
export async function confirmed(capabilityId:string,path:string,body:unknown,preview:Record<string,string>={}){
 if(!binding){binding=sessionStorage.getItem('forum-confirmation-binding')||Array.from(crypto.getRandomValues(new Uint8Array(32)),x=>x.toString(16).padStart(2,'0')).join('');sessionStorage.setItem('forum-confirmation-binding',binding);}
 const key=crypto.randomUUID();const prepared=await api('/api/v1/confirmations/prepare',{capabilityId,payload:preview,clientBinding:binding,idempotencyKey:key});
 if(prepared.data?.confirmation!=='single')throw new Error('账号操作需要额外确认，请联系会务组');
 const r=await fetch(path,{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json','X-Confirmation-Id':prepared.data.confirmationId,'X-Confirmation-Binding':binding,'X-Idempotency-Key':key},body:JSON.stringify(body)});const result=await r.json().catch(()=>({}));if(!r.ok)throw Object.assign(new Error(result.error?.message||'账号操作失败'),{code:result.error?.code,status:r.status,details:result.error?.details,retryAfterSeconds:Number(r.headers.get('retry-after')??result.error?.details?.retryAfterSeconds??60)});return result;
}
export const phonePreview=(phone:string)=>{
 const normalized=phone.startsWith('+86')?phone:'+86'+phone;
 if(!/^\+861[3-9]\d{9}$/.test(normalized))throw new Error('请输入有效的中国大陆手机号');
 return{phoneMasked:normalized.slice(0,5)+'******'+normalized.slice(-3)};
};

import {useCallback,useEffect,useRef,useState,type FormEvent} from 'react';
import {api,isUnauthenticated} from '../../api';
import {formatDate} from '../../types';

export type PersonalQuestion={id:string;question:string;reply:string;createdAt:string;repliedAt:string|null};
type QuestionList={questions:PersonalQuestion[]};
type QuestionResult={question:PersonalQuestion};

function requestId(){
 if(typeof globalThis.crypto?.randomUUID==='function')return globalThis.crypto.randomUUID();
 const bytes=new Uint8Array(16);globalThis.crypto.getRandomValues(bytes);
 return Array.from(bytes,x=>x.toString(16).padStart(2,'0')).join('');
}

export function MyQuestions({timezone,pollSeconds=60,onSessionExpired}:{timezone:string;pollSeconds?:number;onSessionExpired:()=>void}){
 const [questions,setQuestions]=useState<PersonalQuestion[]>([]);
 const [question,setQuestion]=useState('');
 const [loading,setLoading]=useState(true);
 const [busy,setBusy]=useState(false);
 const [error,setError]=useState('');
 const [message,setMessage]=useState('');
 const mounted=useRef(false);
 const readVersion=useRef(0);
 const postPending=useRef(false);
 const pendingRequest=useRef<{question:string;requestId:string}|null>(null);

 const load=useCallback(async(quiet=false)=>{
  const version=++readVersion.current;
  if(!quiet){setLoading(true);setError('')}
  try{
   const result=await api<QuestionList>('/api/me/questions');
   if(!Array.isArray(result.questions))throw new Error('问题列表暂时无法加载。');
   if(mounted.current&&version===readVersion.current)setQuestions(result.questions);
  }catch(caught){
   if(!mounted.current||version!==readVersion.current)return;
   if(isUnauthenticated(caught)){onSessionExpired();return}
   if(!quiet)setError(caught instanceof Error?caught.message:'问题列表暂时无法加载。');
  }finally{if(mounted.current&&version===readVersion.current)setLoading(false)}
 },[onSessionExpired]);

 useEffect(()=>{
  mounted.current=true;void load();
  const timer=window.setInterval(()=>{if(!postPending.current)void load(true)},Math.max(10,pollSeconds)*1000);
  return()=>{mounted.current=false;readVersion.current++;window.clearInterval(timer)};
 },[load,pollSeconds]);

 async function submit(event:FormEvent){
  event.preventDefault();if(postPending.current)return;
  const text=question.trim();
  if(!text){setError('请输入问题。');return}
  if(text.length>5000){setError('问题最多5000字。');return}
  if(pendingRequest.current?.question!==text)pendingRequest.current={question:text,requestId:requestId()};
  postPending.current=true;readVersion.current++;setLoading(false);setBusy(true);setError('');setMessage('');
  try{
   const result=await api<QuestionResult>('/api/me/questions',pendingRequest.current);
   if(!result.question?.id||result.question.question!==text)throw new Error('问题提交结果暂时无法确认，请重试。');
   if(!mounted.current)return;
   setQuestions(current=>[result.question,...current.filter(item=>item.id!==result.question.id)]);
   setQuestion('');pendingRequest.current=null;setMessage('问题已提交。');
  }catch(caught){
   if(!mounted.current)return;
   if(isUnauthenticated(caught)){onSessionExpired();return}
   setError(caught instanceof Error?caught.message:'问题提交失败，请重试。');
  }finally{postPending.current=false;if(mounted.current)setBusy(false)}
 }

 return <section className="account-panel my-questions" aria-label="我的问题">
  <div className="account-panel__heading"><h3>我的问题</h3></div>
  <p className="auth-help">问题和工作人员的回复仅你本人可见。提交后不能修改问题。</p>
  {error&&<p className="auth-message--error" role="alert">{error}</p>}
  {message&&<p className="auth-message--status" role="status">{message}</p>}
  <form onSubmit={submit}>
   <label className="auth-field"><span>问题</span><textarea required maxLength={5000} rows={5} value={question} disabled={busy} onChange={event=>setQuestion(event.target.value)}/></label>
   <button className="account-button" type="submit" disabled={busy}>{busy?'正在提交':'提交问题'}</button>
  </form>
  <div className="my-questions__history-heading"><h4>已提交的问题</h4><button className="account-link-button" type="button" disabled={busy||loading} onClick={()=>void load()}>刷新问题</button></div>
  {loading&&<p role="status">正在加载问题…</p>}
  {!loading&&!questions.length&&!error&&<p className="auth-help">暂无已提交的问题。</p>}
  <div className="my-questions__list">{questions.map(item=><article className="my-questions__item" key={item.id}>
   <p className="my-questions__text">{item.question}</p>
   <p className="auth-help">提交时间：{formatDate(item.createdAt,timezone)}</p>
   {item.reply?<div className="review-feedback"><strong>工作人员回复</strong><p>{item.reply}</p>{item.repliedAt&&<p className="auth-help">回复时间：{formatDate(item.repliedAt,timezone)}</p>}</div>:<p className="auth-help">等待工作人员回复。</p>}
  </article>)}</div>
 </section>;
}

// React state/API-contract regressions in an in-memory DOM, not browser/visual/live API acceptance.
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {MemoryRouter} from 'react-router-dom';
import {renderToStaticMarkup} from 'react-dom/server';
import type {PersonalQuestion} from '../src/features/learner/MyQuestions';

const dom=new JSDOM('<!doctype html><html><body></body></html>',{url:'http://localhost:3000/account?mode=login'});
Object.assign(globalThis,{window:dom.window,document:dom.window.document,HTMLElement:dom.window.HTMLElement,Element:dom.window.Element,IS_REACT_ACT_ENVIRONMENT:true});
Object.defineProperty(globalThis,'navigator',{value:dom.window.navigator,configurable:true});
dom.window.scrollTo=()=>{};
const passed:string[]=[];
type Request={path:string;method:string;body:any;user:string|null};
const requests:Request[]=[];
let authenticated:string|null=null;
let failAfterQuestionCreate=false;
let rejectQuestion=false;
let loginFailure=false;
let sequence=0;
const phones={a:'13900000000',b:'13800000000'};
const createdAt='2026-09-01T08:00:00.000Z';
const questions:Record<string,PersonalQuestion[]>={
 a:[{id:'a-1',question:'A 的旧问题',reply:'',createdAt,repliedAt:null}],
 b:[{id:'b-1',question:'B 的旧问题',reply:'B 的工作人员回复',createdAt,repliedAt:createdAt}],
};
const requestKeys=new Map<string,PersonalQuestion>();
const pendingReads:Array<()=>Promise<Response>>=[];
const pendingPosts:Array<(record:PersonalQuestion)=>Promise<Response>>=[];
const response=(data:any,status=200)=>new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json'}});
const denied=(message='请先登录')=>response({error:{code:'UNAUTHENTICATED',message}},401);
globalThis.fetch=async(input:any,options:any={})=>{
 const path=String(input),method=options.method||'GET',body=options.body?JSON.parse(options.body):undefined,user=authenticated;
 requests.push({path,method,body,user});
 if(path==='/api/auth/sms/request')return response({ok:true,simulationCode:'123456'});
 if(path==='/api/auth/login'){
  if(loginFailure){loginFailure=false;return response({error:{code:'LOGIN_FAILED',message:'手机号或密码错误。'}},401)}
  authenticated=body.phone===phones.b?'b':'a';return response({ok:true});
 }
 if(path==='/api/auth/logout'){authenticated=null;return response({ok:true})}
 if(!user)return denied();
 if(path==='/api/me/profile')return response({editable:true,user:{id:user,phone:phones[user as 'a'|'b']},profile:{name:`用户 ${user.toUpperCase()}`,email:`${user}@example.org`,organization:'研究单位',identity:'研究人员',researchDirection:'研究方向'}});
 if(path==='/api/me/attendance')return method==='GET'?response({attendance:{status:'none'},attendanceStats:{total:0,capacity:null}}):response({error:{code:'NOT_READY',message:'报名暂时无法提交。'}},409);
 if(path==='/api/me/submission')return response({submission:method==='GET'?null:{...body,status:'draft'}});
 if(path==='/api/me/submission/submit')return response({error:{code:'NOT_READY',message:'投稿暂时无法提交。'}},409);
 if(path==='/api/me/questions'&&method==='GET'){
  if(pendingReads.length)return pendingReads.shift()!();
  return response({questions:questions[user]});
 }
 if(path==='/api/me/questions'&&method==='POST'){
  if(rejectQuestion){rejectQuestion=false;return response({error:{code:'BAD_QUESTION',message:'问题暂时无法提交。'}},409)}
  const key=`${user}:${body.requestId}`,existing=requestKeys.get(key);
  if(existing)return response({question:existing});
  const record={id:`${user}-${++sequence+1}`,question:body.question,reply:'',createdAt,repliedAt:null};
  questions[user].unshift(record);requestKeys.set(key,record);
  if(failAfterQuestionCreate){failAfterQuestionCreate=false;throw new Error('连接中断，请重试。')}
  if(pendingPosts.length)return pendingPosts.shift()!(record);
  return response({question:record},201);
 }
 throw Error('Unexpected mocked API '+method+' '+path);
};

const {render,fireEvent,waitFor,cleanup,act}=await import('@testing-library/react');
const {App}=await import('../src/App');
const {AccountAccessPanel}=await import('../src/features/learner/AccountAccessPanel');
const {eventDates,formatDate}=await import('../src/types');
const {default:baseConfig}=await import('../src/config.generated.json');
const sameRoute=dom.window.location.href;
let view=render(<MemoryRouter initialEntries={['/account?mode=login']}><App/></MemoryRouter>);
const entry=()=>view.container.querySelector('.mobile-service-bar__entry')?.textContent;
async function login(phone:string){
 await view.findByRole('heading',{name:'登录个人中心'});
 fireEvent.change(view.getByLabelText('手机号'),{target:{value:phone}});
 fireEvent.change(view.getByLabelText('密码'),{target:{value:'Passw0rd!'}});
 fireEvent.submit(view.getByRole('button',{name:'登录'}).closest('form')!);
 await view.findByRole('button',{name:'退出登录'});
 await waitFor(()=>assert.equal(entry(),'个人中心'));
}
async function logout(){
 fireEvent.click(view.getByRole('button',{name:'退出登录'}));
 await view.findByRole('heading',{name:'登录个人中心'});
 await waitFor(()=>assert.equal(entry(),'登录／注册'));
 assert.ok(view.queryByRole('tab',{name:'我的问题'})===null);
 assert.equal(dom.window.location.href,sameRoute);
}
const openQuestions=()=>fireEvent.click(view.getByRole('tab',{name:'我的问题'}));
const submitQuestion=(value:string)=>{
 fireEvent.change(view.getByLabelText('问题'),{target:{value}});
 fireEvent.submit(view.getByRole('button',{name:'提交问题'}).closest('form')!);
};

try{
 await view.findByRole('heading',{name:'登录个人中心'});assert.equal(entry(),'登录／注册');
 loginFailure=true;
 fireEvent.change(view.getByLabelText('手机号'),{target:{value:phones.a}});
 fireEvent.change(view.getByLabelText('密码'),{target:{value:'Passw0rd!'}});
 fireEvent.submit(view.getByRole('button',{name:'登录'}).closest('form')!);
 await view.findByText('手机号或密码错误。');assert.equal(entry(),'登录／注册');assert.ok(view.queryByText(/登录成功/)===null);
 await login(phones.a);assert.equal(dom.window.location.href,sameRoute);
 passed.push('failed login has no false success','same-route login updates entry');

 fireEvent.click(view.getByRole('tab',{name:'参会报名'}));
 assert.equal((view.getByRole('button',{name:'提交参会报名'}) as HTMLButtonElement).disabled,false);
 assert.doesNotMatch(view.container.querySelector('.account-panel')!.textContent||'',/未确认|未提供|暂不开放|预览/);
 fireEvent.submit(view.getByRole('button',{name:'提交参会报名'}).closest('form')!);
 await view.findByText('报名暂时无法提交。');assert.ok(view.queryByText('参会报名已提交审核。')===null);
 fireEvent.click(view.getByRole('tab',{name:'在线投稿'}));
 assert.equal((view.getByRole('button',{name:'提交审核'}) as HTMLButtonElement).disabled,false);
 assert.doesNotMatch(view.container.querySelector('.account-panel')!.textContent||'',/未确认|未提供|暂不开放|预览/);
 fireEvent.change(view.getByLabelText(/投稿标题/),{target:{value:'研究报告'}});
 fireEvent.change(view.getByLabelText(/摘要/),{target:{value:'研究摘要'}});
 fireEvent.change(view.getByLabelText(/关键词/),{target:{value:'研究'}});
 fireEvent.submit(view.getByRole('button',{name:'提交审核'}).closest('form')!);
 await view.findByText('投稿暂时无法提交。');assert.ok(view.queryByText('投稿已提交审核。')===null);
 passed.push('incomplete conditions keep normal buttons visible; real API failures do not claim success');

 openQuestions();await view.findByText('A 的旧问题');
 assert.ok(view.queryByText('B 的旧问题')===null);assert.equal(view.getByLabelText('问题').getAttribute('maxlength'),'5000');
 rejectQuestion=true;submitQuestion('第一个被拒绝的问题');
 await view.findByText('问题暂时无法提交。');assert.ok(view.queryByText('问题已提交。')===null);
 assert.equal((view.getByLabelText('问题') as HTMLTextAreaElement).value,'第一个被拒绝的问题');
 const rejected=requests.filter(x=>x.path==='/api/me/questions'&&x.method==='POST').at(-1)!;
 failAfterQuestionCreate=true;submitQuestion('网络断开后的同一个问题');
 await view.findByText('连接中断，请重试。');assert.ok(view.queryByText('问题已提交。')===null);
 const failed=requests.filter(x=>x.path==='/api/me/questions'&&x.method==='POST').at(-1)!;
 assert.match(failed.body.requestId,/^[A-Za-z0-9_-]{10,80}$/);assert.notEqual(failed.body.requestId,rejected.body.requestId,'Editing the failed question starts a new request');
 submitQuestion('网络断开后的同一个问题');await view.findByText('问题已提交。');
 const retried=requests.filter(x=>x.path==='/api/me/questions'&&x.method==='POST').at(-1)!;
 assert.equal(retried.body.requestId,failed.body.requestId);assert.equal(view.getAllByText('网络断开后的同一个问题').length,1);
 assert.equal(questions.a.filter(x=>x.question===failed.body.question).length,1);
 assert.equal((view.getByLabelText('问题') as HTMLTextAreaElement).value,'');
 passed.push('question API errors preserve draft without false success','lost-response retry reuses requestId and has one question');

 const submissionsBefore=requests.filter(x=>x.path==='/api/me/questions'&&x.method==='POST').length;
 submitQuestion('   ');await view.findByText('请输入问题。');
 submitQuestion('字'.repeat(5001));await view.findByText('问题最多5000字。');
 assert.equal(requests.filter(x=>x.path==='/api/me/questions'&&x.method==='POST').length,submissionsBefore);
 fireEvent.change(view.getByLabelText('问题'),{target:{value:'重复点击仅提交一次'}});
 const questionForm=view.getByRole('button',{name:'提交问题'}).closest('form')!;
 fireEvent.submit(questionForm);fireEvent.submit(questionForm);
 await view.findByText('问题已提交。');
 assert.equal(requests.filter(x=>x.path==='/api/me/questions'&&x.method==='POST').length,submissionsBefore+1);
 passed.push('blank and over-limit questions are rejected locally','duplicate in-flight clicks send one POST');

 questions.a[0].reply='工作人员第一次回复';questions.a[0].repliedAt=createdAt;
 fireEvent.click(view.getByRole('button',{name:'刷新问题'}));await view.findByText('工作人员第一次回复');
 questions.a[0].reply='工作人员更新后的唯一回复';
 fireEvent.click(view.getByRole('button',{name:'刷新问题'}));await view.findByText('工作人员更新后的唯一回复');
 assert.ok(view.queryByText('工作人员第一次回复')===null);assert.equal(view.getAllByText('工作人员更新后的唯一回复').length,1);
 passed.push('refresh displays staff single-reply updates');

 // A late list response must not populate the next account after logout/login.
 let resolveRead!:(value:Response)=>void;
 const staleRead=response({questions:[{id:'private-a',question:'A 的迟到私有问题',reply:'A 的迟到私有回复',createdAt,repliedAt:createdAt}]});
 pendingReads.push(()=>new Promise(resolve=>{resolveRead=resolve}));
 fireEvent.click(view.getByRole('button',{name:'刷新问题'}));
 await waitFor(()=>assert.equal(typeof resolveRead,'function'));
 await logout();await login(phones.b);openQuestions();await view.findByText('B 的旧问题');
 await act(async()=>{resolveRead(staleRead)});
 assert.ok(view.queryByText('A 的迟到私有问题')===null);assert.ok(view.queryByText('A 的迟到私有回复')===null);
 assert.ok(view.queryByText('A 的旧问题')===null);assert.ok(view.queryByText('网络断开后的同一个问题')===null);
 passed.push('logout clears private questions and ignores late prior-account GET');

 // A late create response is also isolated, even though logout remains available while it is pending.
 await logout();await login(phones.a);openQuestions();await view.findByText('A 的旧问题');
 let resolvePost!:(value:Response)=>void;let lateRecord!:PersonalQuestion;
 pendingPosts.push(record=>new Promise(resolve=>{lateRecord=record;resolvePost=resolve}));
 submitQuestion('A 的迟到提交');await waitFor(()=>assert.equal(typeof resolvePost,'function'));
 await logout();await login(phones.b);openQuestions();await view.findByText('B 的旧问题');
 await act(async()=>{resolvePost(response({question:lateRecord},201))});
 assert.ok(view.queryByText('A 的迟到提交')===null);assert.ok(view.queryByText('问题已提交。')===null);
 assert.equal((view.getByLabelText('问题') as HTMLTextAreaElement).value,'');
 passed.push('late prior-account POST cannot leak question or success state');

 // A fresh component reads only the authenticated account, not a retained in-memory list.
 cleanup();view=render(<MemoryRouter initialEntries={['/account']}><App/></MemoryRouter>);
 await view.findByRole('tab',{name:'我的问题'});openQuestions();await view.findByText('B 的旧问题');
 assert.ok(view.queryByText('A 的旧问题')===null);
 passed.push('remount reloads authenticated account questions');

 // Authentication expiry removes all private state and updates the same-route entry.
 pendingReads.push(async()=>denied('登录已失效，请重新登录'));
 fireEvent.click(view.getByRole('button',{name:'刷新问题'}));
 await view.findByRole('heading',{name:'登录个人中心'});await waitFor(()=>assert.equal(entry(),'登录／注册'));
 assert.ok(view.queryByText('B 的旧问题')===null);assert.ok(view.queryByRole('tab',{name:'我的问题'})===null);
 passed.push('question 401 clears session and private state');
 cleanup();

 const access=render(<AccountAccessPanel onAuthenticated={()=>{}}/>);
 fireEvent.click(access.getByRole('tab',{name:'注册账号'}));
 fireEvent.change(access.getByLabelText('手机号'),{target:{value:phones.a}});
 fireEvent.submit(access.getByRole('button',{name:'获取验证码'}).closest('form')!);
 await access.findByText('验证码请求已受理。');
 assert.ok(access.queryByText(/123456|模拟|本地|不会发送/)===null);
 passed.push('SMS response code and simulation hints are never shown');
 cleanup();

 // Even stale diagnostic fields in an old public payload must never create an entry or warning.
 const diagnosticConfig=baseConfig as any;
 diagnosticConfig.branding.heroWarning='旧横幅绑定诊断信息';
 diagnosticConfig.readiness={mode:'preview',attendanceEnabled:false,submissionEnabled:false,unresolved:[{key:'event.capacity',reason:'内部容量条件未提供'}]};
 diagnosticConfig.runtime={mode:'simulation'};
 diagnosticConfig.sourceNotes=[{title:'内部来源诊断',body:'内部来源仅构建者可见'}];
 for(const path of ['/','/travel','/contact','/resources','/faq','/account']){
  const html=renderToStaticMarkup(<MemoryRouter initialEntries={[path]}><App preview/></MemoryRouter>);
  assert.doesNotMatch(html,/会务条件待确认|资料预览|人数容量未确认|窗口未确认|最终提交暂不开放|本地演示|短信.*模拟|飞书审核模拟台|\/simulation|heroWarning|旧横幅绑定诊断信息|内部容量条件未提供|内部来源仅构建者可见/);
  assert.doesNotMatch(html,/A 的旧问题|B 的旧问题|工作人员更新后的唯一回复/);
 }
 const missing=structuredClone(baseConfig);Object.assign(missing.event,{location:'',startDate:'',endDate:'',startAt:null,endAt:null});
 assert.equal(eventDates(missing),'');assert.equal(formatDate(null,'Asia/Shanghai'),'');
 const unavailable=renderToStaticMarkup(<MemoryRouter initialEntries={['/simulation']}><App preview/></MemoryRouter>);
 assert.match(unavailable,/页面不存在/);assert.doesNotMatch(unavailable,/飞书审核模拟台/);
 assert.equal(requests.filter(x=>x.path==='/api/public/config').length,0);
 passed.push('six public pages have no diagnostic/simulation UI or private Q&A','removed simulation route returns not found','unknown dates omit repeated missing facts');
 console.log(JSON.stringify({passed,scope:'React component state/API contract in mocked in-memory DOM and SSR; NOT browser/visual/live API acceptance'}));
}finally{cleanup();dom.window.close()}

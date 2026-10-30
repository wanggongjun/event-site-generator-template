// Verify the actual signed-in account dependencies without creating accounts or records.
import {ForumFeishu} from '../backend/forum-feishu.js';
import {signHubRequest} from '../backend/profile-hub.js';
import {randomBytes} from 'node:crypto';
import {CmsFeishu} from '../backend/site-cms-feishu.js';
import {cmsTables} from '../backend/site-cms-model.js';
const client=new ForumFeishu(process.env);
const report=(stage,e)=>{
 console.error(JSON.stringify({dependency:'account-records',stage,version:client.version,ok:false,name:e.name,message:e.message,code:e.code,status:e.status,category:e.category,requestId:e.requestId}));
 process.exitCode=1;
};
try{await client.check();console.log(JSON.stringify({dependency:'account-fields',version:client.version,ok:true}));}catch(e){report('fields',e);}
for(const kind of ['registration','submission']){
 try{
  const rows=await client.records(kind);
  console.log(JSON.stringify({dependency:'account-records',version:client.version,kind,ok:true,count:rows.length}));
 }catch(e){
  report(kind,e);
  if(e.message==='Invalid Base v3 record matrix.'){
   const data=await client.api(client.path(kind)+'/records?limit=200&offset=0');
   console.log(JSON.stringify({dependency:'record-response-shape',kind,keys:Object.keys(data??{}),shape:Object.fromEntries(Object.entries(data??{}).map(([k,v])=>[k,v===null?'null':Array.isArray(v)?'array:'+v.length:typeof v]))}));
  }
 }
}
// Empty input exercises routing and client authentication, but cannot read or
// create a person's profile. 422 is the expected authenticated validation result.
for(const endpoint of ['/lookup','/sync']){
 try{
  const body=JSON.stringify({phone:''});
  const r=await fetch(process.env.PROFILE_HUB_URL+endpoint,{method:'POST',headers:signHubRequest(process.env.PROFILE_HUB_SECRET,body,undefined,undefined,process.env.PROFILE_HUB_CLIENT),body,signal:AbortSignal.timeout(10000)});
  await r.body?.cancel();
  if(r.status!==422)throw Error('Shared profile client contract failed: HTTP '+r.status);
  console.log(JSON.stringify({dependency:'profile-hub',endpoint,authenticated:true,ok:true}));
 }catch(e){report('profile-hub'+endpoint,e);}
}
try{
 if(process.env.TASHAN_SSO_ORIGIN!==process.env.PUBLIC_ORIGIN||!process.env.TASHAN_SSO_CLIENT_ID||!process.env.TASHAN_SSO_CLIENT_SECRET)throw Error('Site SSO configuration is missing');
 const r=await fetch(process.env.TASHAN_SSO_API_BASE+'/auth/sso/session/check',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({client_id:process.env.TASHAN_SSO_CLIENT_ID,client_secret:process.env.TASHAN_SSO_CLIENT_SECRET,session_token:randomBytes(32).toString('base64url')}),signal:AbortSignal.timeout(15000),redirect:'error'});
 const data=await r.json();
 if(r.status!==200||data.active!==false)throw Error('SSO client validation failed: HTTP '+r.status);
 console.log(JSON.stringify({dependency:'tashan-sso',clientAuthenticated:true,ok:true}));
}catch(e){report('tashan-sso',e);}
try{
 const cms=new CmsFeishu(process.env),tables=JSON.parse(process.env.CMS_TABLES||'{}');
 for(const key of Object.keys(cmsTables)){
  if(!tables[key])throw Error('Missing CMS table: '+key);
  const rows=await cms.rows(tables[key]);
  if(key==='control'&&rows.length!==1)throw Error('CMS needs exactly one control row');
  console.log(JSON.stringify({dependency:'site-cms',table:key,ok:true,count:rows.length}));
 }
}catch(e){report('site-cms',e);}

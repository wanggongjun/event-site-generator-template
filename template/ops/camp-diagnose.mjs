// Read-only dependency diagnostics. Never print credentials or participant records.
import {pathToFileURL} from 'node:url';
import {execFileSync} from 'node:child_process';
const root='/opt/events/kiz-ai-camp-2026/production/current';
const {ForumFeishu}=await import(pathToFileURL(root+'/backend/forum-feishu.js'));
const client=new ForumFeishu(process.env);
for(const kind of ['registration','submission']){
 try{const rows=await client.records(kind);console.log(JSON.stringify({dependency:'feishu-records',kind,ok:true,count:rows.length}));}
 catch(e){console.log(JSON.stringify({dependency:'feishu-records',kind,ok:false,name:e.name,code:e.code,status:e.status,category:e.category,requestId:e.requestId}));}
}
const logs=execFileSync('journalctl',['-u','kiz-ai-camp-2026','--since','2 hours ago','-o','cat','--no-pager'],{encoding:'utf8'});
const errors=logs.split('\n').map(line=>line.match(/^Forum request failed: ([A-Za-z]+)\s*([A-Za-z0-9_]*)$/)).filter(Boolean);
console.log(JSON.stringify({dependency:'recent-request-errors',errors:errors.slice(-15).map(m=>({name:m[1],code:m[2]}))}));
const {signHubRequest}=await import(pathToFileURL(root+'/backend/profile-hub.js'));
for(const endpoint of ['/lookup','/sync']){
 const body=JSON.stringify({phone:''});
 const r=await fetch(process.env.PROFILE_HUB_URL+endpoint,{method:'POST',headers:signHubRequest(process.env.PROFILE_HUB_SECRET,body,undefined,undefined,process.env.PROFILE_HUB_CLIENT),body,signal:AbortSignal.timeout(10000)});
 console.log(JSON.stringify({dependency:'profile-hub-auth-contract',endpoint,status:r.status}));
 await r.body?.cancel();
}
for(const name of ['tashan-topiclab-topiclab-backend-1','tashan-profile-hub-production','kiz-ai-camp-2026-profile']){
 const details=JSON.parse(execFileSync('docker',['inspect',name],{encoding:'utf8'}))[0];
 console.log(JSON.stringify({dependency:'integration-runtime',name,image:details.Config.Image,mounts:details.Mounts.map(m=>({source:m.Source,destination:m.Destination}))}));
 const source="import inspect,json\nfrom app.services import profile_hub_service as p\nfrom app.api import profile_hub as a\nprint(json.dumps({'sync_implemented':hasattr(p,'sync_by_identity'),'sync_route':hasattr(a,'sync'),'clients':sorted(a.CLIENTS)}))";
 console.log(execFileSync('docker',['exec',name,'python','-c',source],{encoding:'utf8'}).trim());
}
const sso="import json\nfrom app.services.sso_service import list_clients\nprint(json.dumps([c for c in list_clients() if c['origin'] in ['https://kiz-ai-camp-2026.tashan.ac.cn','https://panshi-forum.tashan.ac.cn']]))";
console.log('SSO clients',execFileSync('docker',['exec','tashan-topiclab-topiclab-backend-1','python','-c',sso],{encoding:'utf8'}).trim());

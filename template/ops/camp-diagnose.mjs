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

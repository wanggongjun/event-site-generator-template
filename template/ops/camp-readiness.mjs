// Verify the actual signed-in account dependencies without creating accounts or records.
import {ForumFeishu} from '../backend/forum-feishu.js';
const client=new ForumFeishu(process.env);
try{
 await client.check();
 for(const kind of ['registration','submission']){
  const rows=await client.records(kind);
  console.log(JSON.stringify({dependency:'account-records',version:client.version,kind,ok:true,count:rows.length}));
 }
}catch(e){
 console.error(JSON.stringify({dependency:'account-records',ok:false,name:e.name,code:e.code,status:e.status,category:e.category,requestId:e.requestId}));
 process.exitCode=1;
}

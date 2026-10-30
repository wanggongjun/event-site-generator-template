// Verify the actual signed-in account dependencies without creating accounts or records.
import {ForumFeishu} from '../backend/forum-feishu.js';
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

import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import {FeishuClient} from '../backend/feishu-client.js';
import {forumFields} from '../backend/forum-feishu.js';
const file=process.argv[2];
const client=new FeishuClient(process.env);
const base=process.env.FORUM_FEISHU_BASE_TOKEN;
if(!/^[a-zA-Z0-9]+$/.test(base||''))throw Error('Missing authorized Base');
const slug='kiz-ai-camp-2026',path=`/bitable/v1/apps/${base}`;
const specs=[{kind:'registration',name:slug+'报名审核',key:'FORUM_REGISTRATION_TABLE_ID'},{kind:'submission',name:slug+'系统保留（不开放投稿）',key:'FORUM_SUBMISSION_TABLE_ID'}];
const ids=existsSync(file)?JSON.parse(readFileSync(file,'utf8')):{FORUM_FEISHU_BASE_TOKEN:base};
if(ids.FORUM_FEISHU_BASE_TOKEN!==base)throw Error('Base mismatch');
let tables=await client.list(path+'/tables');
for(const spec of specs){
 const found=tables.filter(t=>t.name===spec.name);
 if(found.length>1)throw Error('Duplicate activity table name');
 let id=ids[spec.key]||found[0]?.table_id;
 if(id&&!tables.some(t=>t.table_id===id&&t.name===spec.name))throw Error('Stored activity table does not match');
 if(!id){const result=await client.api(path+'/tables',{method:'POST',body:JSON.stringify({table:{name:spec.name,default_view_name:'全部记录',fields:[{field_name:spec.kind==='registration'?'注册ID':'投稿ID',type:1}]}})});id=result.table_id;}
 ids[spec.key]=id;writeFileSync(file,JSON.stringify(ids,null,2),{mode:0o600});
 const fields=await client.list(path+'/tables/'+id+'/fields');
 for(const name of forumFields[spec.kind]){
  const type=['个人材料','历史个人材料','最新版提交材料','历史附件','资料快照附件','文字快照附件'].includes(name)?17:1;
  const match=fields.filter(f=>f.field_name===name);
  if(match.length>1||match.length&&match[0].type!==type)throw Error('Activity field conflicts: '+name);
  if(!match.length)await client.api(path+'/tables/'+id+'/fields',{method:'POST',body:JSON.stringify({field_name:name,type})});
 }
 console.log(`${spec.name}: configured`);
}
console.log('Review URL: https://scnnpwzbl7rs.feishu.cn/base/'+base+'?table='+ids.FORUM_REGISTRATION_TABLE_ID);

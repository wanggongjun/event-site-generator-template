import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import {CmsFeishu,feishuText} from '../backend/site-cms-feishu.js';
import {cmsTables,seedCms} from '../backend/site-cms-model.js';
const filename=process.argv[2],client=new CmsFeishu(process.env),config=JSON.parse(readFileSync('config.json','utf8'));
const state=existsSync(filename)?JSON.parse(readFileSync(filename,'utf8')):{base:client.base,tables:{},seeded:false};if(state.base!==client.base)throw Error('CMS Base mismatch');
const base=`/bitable/v1/apps/${client.base}`;const tables=await client.list(base+'/tables');
const save=()=>writeFileSync(filename,JSON.stringify(state,null,2),{mode:0o600});
for(const [key,spec]of Object.entries(cmsTables)){
 const name=config.event.slug+'·'+spec.name;const matches=tables.filter(t=>t.name===name);if(matches.length>1)throw Error('Duplicate CMS table');let id=state.tables[key]||matches[0]?.table_id;
 if(id&&!tables.some(t=>t.table_id===id&&t.name===name))throw Error('CMS table mismatch');
 if(!id){id=(await client.api(base+'/tables',{method:'POST',body:JSON.stringify({table:{name,default_view_name:spec.name,fields:[spec.fields[0]]}})})).table_id;state.tables[key]=id;save();}
 state.tables[key]=id;const fields=await client.list(base+'/tables/'+id+'/fields');for(const specField of spec.fields){const existing=fields.find(f=>f.field_name===specField.field_name);if(existing&&existing.type!==specField.type)throw Error('CMS field type mismatch: '+specField.field_name);if(!existing)await client.api(base+'/tables/'+id+'/fields',{method:'POST',body:JSON.stringify(specField)});}
}
if(!state.seeded){const seed=seedCms(config);for(const [key,rows]of Object.entries(seed)){const existing=await client.rows(state.tables[key]);const primary=cmsTables[key].fields[0].field_name;for(const fields of rows)if(!existing.some(r=>feishuText(r.fields[primary])===fields[primary]))await client.write(state.tables[key],fields);}state.seeded=true;save();}
const reg=process.env.FORUM_REGISTRATION_TABLE_ID;const rf=await client.list(base+'/tables/'+reg+'/fields');if(!rf.some(f=>f.field_name==='自定义报名信息'))await client.api(base+'/tables/'+reg+'/fields',{method:'POST',body:JSON.stringify({field_name:'自定义报名信息',type:1})});
for(const[key,id]of Object.entries(state.tables))console.log(cmsTables[key].name+': https://scnnpwzbl7rs.feishu.cn/base/'+client.base+'?table='+id);

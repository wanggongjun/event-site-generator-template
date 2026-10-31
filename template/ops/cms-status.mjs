// Read-only delivery verification. Never print private preview tokens or content.
import {CmsFeishu,feishuText} from '../backend/site-cms-feishu.js';
const client=new CmsFeishu(process.env),tables=JSON.parse(process.env.CMS_TABLES);
const origin=process.env.PUBLIC_ORIGIN,local='http://127.0.0.1:'+process.env.PORT;
let result;
for(let attempt=0;attempt<12;attempt++){
 const rows=await client.rows(tables.control);if(rows.length!==1)throw Error('CMS control row missing');
 const f=rows[0].fields,command=feishuText(f['操作']);
 if(command!=='待命'){await new Promise(r=>setTimeout(r,2500));continue;}
 const live=await (await fetch(local+'/api/site/content',{signal:AbortSignal.timeout(10000)})).json();
 if(live.preview!==false)throw Error('CMS live endpoint returned a preview');
 if(live.revision!==feishuText(f['当前版本'])){await new Promise(r=>setTimeout(r,2500));continue;}
 const url=feishuText(f['预览链接']);let previewVerified=false;
 if(url){const parsed=new URL(url);if(parsed.origin!==origin||!/^\/cms-preview\/[a-f0-9]{64}\/$/.test(parsed.pathname))throw Error('CMS preview URL is invalid');const token=parsed.pathname.split('/')[2];const response=await fetch(local+'/api/site/content?preview='+token,{signal:AbortSignal.timeout(10000)});if(response.status===200){const draft=await response.json();if(draft.preview!==true||draft.revision!==feishuText(f['待发布版本']))throw Error('CMS preview version mismatch');previewVerified=true;}else if(response.status!==404)throw Error('CMS preview unavailable');}
 const history=await client.rows(tables.history);if(!history.some(r=>feishuText(r.fields['版本'])===live.revision))throw Error('Published version missing from Feishu history');
 result={dependency:'cms-publishing',ok:true,currentVersion:live.revision,previewVerified,pages:live.pages.length,fields:live.fields.length};break;
}
if(!result)throw Error('CMS control action did not settle');console.log(JSON.stringify(result));

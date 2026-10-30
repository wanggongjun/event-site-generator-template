import {randomBytes} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {CmsFeishu,feishuText} from './site-cms-feishu.js';
import {compileCms,hash} from './site-cms-model.js';
const validation=message=>{throw Object.assign(Error(message),{cmsValidation:true});};
export async function createSiteCms({db,env,config}){
 if(!env.CMS_TABLES)return null;
 const tables=JSON.parse(env.CMS_TABLES),client=new CmsFeishu(env),origin=env.PUBLIC_ORIGIN;
 db.exec(`CREATE TABLE IF NOT EXISTS cms_state(key TEXT PRIMARY KEY,value TEXT NOT NULL);CREATE TABLE IF NOT EXISTS cms_versions(id TEXT PRIMARY KEY,payload TEXT NOT NULL,createdAt TEXT NOT NULL,published INTEGER NOT NULL DEFAULT 0,action TEXT,source TEXT);CREATE TABLE IF NOT EXISTS cms_images(id TEXT PRIMARY KEY,mime TEXT NOT NULL,bytes BLOB NOT NULL);`);
 const get=k=>{const x=db.prepare('SELECT value FROM cms_state WHERE key=?').get(k);return x?JSON.parse(x.value):null;};
 const set=(k,v)=>db.prepare('INSERT INTO cms_state VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(k,JSON.stringify(v));
 const version=id=>{const row=db.prepare('SELECT * FROM cms_versions WHERE id=?').get(id);return row?{...row,payload:JSON.parse(row.payload)}:null;};
 let live=version(get('current')),busy=false,closing=false,timer,active;
 const historyFields=()=>db.prepare('SELECT payload FROM cms_versions WHERE published=1').all().flatMap(r=>JSON.parse(r.payload).fields);
 const readRows=async()=>Object.fromEntries(await Promise.all(['settings','pages','questions'].map(async key=>[key,await client.rows(tables[key])])));
 const rowDigest=rows=>hash(Object.fromEntries(Object.entries(rows).map(([k,rs])=>[k,rs.map(r=>({record_id:r.record_id,fields:Object.fromEntries(Object.entries(r.fields).sort(([a],[b])=>a.localeCompare(b)))})).sort((a,b)=>a.record_id.localeCompare(b.record_id))])));
 async function imageUrl(token){const cached=get('image:'+token);if(cached&&db.prepare('SELECT id FROM cms_images WHERE id=?').get(cached))return '/api/site/media/'+cached;const {bytes,mime}=await client.image(token),id=hash(bytes);db.prepare('INSERT OR IGNORE INTO cms_images VALUES(?,?,?)').run(id,mime,bytes);set('image:'+token,id);return '/api/site/media/'+id;}
 async function prepare(rows){const copied=structuredClone(rows);for(const row of copied.settings){const key=feishuText(row.fields['设置标识']),images=row.fields['图片'];if(!['banner','logo'].includes(key)){if(images?.length)validation('只有横幅和标志设置可以上传图片');continue;}if(images?.length>1)validation('每项请只上传一张图片');if(images?.length)row.fields['内容']=await imageUrl(images[0].file_token);}
  for(const row of copied.pages){const images=row.fields['图片']||[];if(images.length>6)validation('每个页面最多6张图片');row.cmsImages=[];for(const image of images)row.cmsImages.push(await imageUrl(image.file_token));}
  const payload=compileCms(copied,config,historyFields());const id='v'+Date.now()+'-'+hash(payload).slice(0,8);db.prepare('INSERT INTO cms_versions(id,payload,createdAt) VALUES(?,?,?)').run(id,JSON.stringify(payload),new Date().toISOString());return{id,payload};}
 function activate(id,action,source=''){const v=version(id);if(!v)validation('版本不存在');db.exec('BEGIN IMMEDIATE');try{set('previous',get('current'));set('current',id);db.prepare('UPDATE cms_versions SET published=1,action=?,source=? WHERE id=?').run(action,source,id);db.exec('COMMIT');}catch(e){db.exec('ROLLBACK');throw e;}live=version(id);return live;}
 async function history(v){const rows=await client.rows(tables.history);if(!rows.some(r=>feishuText(r.fields['版本'])===v.id))await client.write(tables.history,{'版本':v.id,'发布时间':new Date().toISOString(),'操作':v.action||'初始版本','内容摘要':`${v.payload.pages.length}个页面；${v.payload.fields.filter(q=>q.enabled).length}组报名字段`,'来源版本':v.source||''});}
 async function initialize(){if(live)return;const rows=await readRows();const prepared=await prepare(rows);activate(prepared.id,'初始导入');await history(live);}
 await initialize();
 // Apply an explicitly requested theme once, without publishing unrelated Feishu drafts.
 if(env.CMS_THEME_PATCH){
  const patch=JSON.parse(env.CMS_THEME_PATCH),key='theme:'+patch.id;
  if(!/^[a-z0-9-]{1,80}$/.test(patch.id)||!/^#[a-f0-9]{6}$/i.test(patch.color)||!/^\/assets\/assets\/[a-z0-9-]+\.png$/.test(patch.banner))throw Error('Invalid theme patch');
  if(!get(key)){
   const controls=await client.rows(tables.control);if(controls.length!==1||feishuText(controls[0].fields['操作'])!=='待命'||get('pendingResult'))throw Error('Finish the pending Feishu publishing action before updating the theme');
   const rows=await client.rows(tables.settings),banner=rows.filter(r=>feishuText(r.fields['设置标识'])==='banner'),color=rows.filter(r=>feishuText(r.fields['设置标识'])==='primaryColor');
   if(banner.length!==1||color.length!==1)throw Error('Theme settings must be unique');
   const bytes=await readFile(resolve(env.APP_ROOT||resolve(import.meta.dirname,'..'),'dist','.'+patch.banner));
   if(!bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))throw Error('Theme image must be PNG');
   const imageId=hash(bytes),imagePath='/api/site/media/'+imageId;
   db.prepare('INSERT OR IGNORE INTO cms_images VALUES(?,?,?)').run(imageId,'image/png',bytes);
   await client.write(tables.settings,{'内容':imagePath,'图片':[]},banner[0].record_id);
   await client.write(tables.settings,{'内容':patch.color},color[0].record_id);
   const payload=structuredClone(live.payload);payload.config.branding.backgroundImage=imagePath;payload.config.branding.primaryColor=patch.color;payload.settings.banner=imagePath;payload.settings.primaryColor=patch.color;
   const id='theme-'+patch.id,at=new Date().toISOString();
   db.prepare('INSERT OR IGNORE INTO cms_versions(id,payload,createdAt) VALUES(?,?,?)').run(id,JSON.stringify(payload),at);
   await history({...version(id),action:'主题更新',source:live.id});
   await client.write(tables.control,{'当前版本':id,'预览链接':'','待发布版本':'','处理结果':'湖蓝横幅与按钮配色已更新。其他草稿未发布；需要预览时请重新生成。','更新时间':at},controls[0].record_id);
   db.exec('BEGIN IMMEDIATE');try{set('previous',get('current'));set('current',id);set('preview',null);set(key,true);db.prepare('UPDATE cms_versions SET published=1,action=?,source=? WHERE id=?').run('主题更新',live.id,id);db.exec('COMMIT');}catch(e){db.exec('ROLLBACK');throw e;}
   live=version(id);console.log(JSON.stringify({themePatch:patch.id,ok:true}));
  }
 }
 async function poll(){if(busy||closing)return;busy=true;let control;try{
  const controls=await client.rows(tables.control);if(controls.length!==1)validation('网站发布表必须且只能保留一行');control=controls[0];const command=feishuText(control.fields['操作']);
  const existing=get('pendingResult');if(existing){if(command!=='待命')await client.write(tables.control,existing.fields,existing.recordId);set('pendingResult',null);await history(live);return;}
  if(command==='待命'||!command){if(feishuText(control.fields['当前版本'])!==live.id)await client.write(tables.control,{'当前版本':live.id},control.record_id);await history(live);return;}
  let result,previewFields={};
  if(command==='生成预览'){
   const rows=await readRows(),digest=rowDigest(rows),prepared=await prepare(rows);const token=randomBytes(32).toString('hex');set('preview',{id:prepared.id,token,digest,expires:Date.now()+7*86400000});
   previewFields={'预览链接':origin+'/cms-preview/'+token+'/','待发布版本':prepared.id};result='预览已生成。确认内容后选择“发布预览”；预览不接受报名。';
  }else if(command==='发布预览'){
   const draft=get('preview');if(!draft||draft.expires<Date.now())validation('请先生成新的预览');if(feishuText(control.fields['待发布版本'])!==draft.id)validation('待发布版本与预览不一致，请重新生成预览');if(rowDigest(await readRows())!==draft.digest)validation('预览生成后内容又有修改，请重新生成预览');if(draft.id!==live.id)activate(draft.id,'发布');result='已发布，正式网站刷新后生效。';
  }else if(command==='回滚'){
   const target=feishuText(control.fields['回滚到版本'])||get('previous');const old=version(target);if(!old?.published)validation('请选择发布记录中已经上线的版本');if(target===live.id)validation('该版本已经是当前版本');
   const id='v'+Date.now()+'-'+hash(old.payload).slice(0,8);db.prepare('INSERT INTO cms_versions(id,payload,createdAt) VALUES(?,?,?)').run(id,JSON.stringify(old.payload),new Date().toISOString());activate(id,'回滚',target);result='已回滚正式网站；飞书编辑区保留原草稿，不会覆盖。';
  }else validation('不支持的发布操作');
  const fields={'操作':'待命','处理结果':result,'更新时间':new Date().toISOString(),'当前版本':live.id,...previewFields};set('pendingResult',{recordId:control.record_id,fields});await client.write(tables.control,fields,control.record_id);set('pendingResult',null);await history(live);
 }catch(e){console.error('CMS sync:',e.name,e.code||'');if(control&&!get('pendingResult')){const fields={'操作':'待命','处理结果':e.cmsValidation?e.message:'飞书连接或发布处理暂时失败，当前正式版本保持；请稍后重试。','更新时间':new Date().toISOString(),'当前版本':live.id};try{await client.write(tables.control,fields,control.record_id);}catch{}}}finally{busy=false;}}
 timer=setInterval(()=>{if(!busy)active=poll();},30000);timer.unref();active=poll();
 function selected(token){if(!token)return live;const draft=get('preview');if(!draft||draft.token!==token||draft.expires<Date.now())return null;return version(draft.id);}
 function publicPayload(v,token){const payload=structuredClone(v.payload);delete payload.settings;delete payload.config.source;delete payload.config.sourceNotes;delete payload.config.readiness;delete payload.config.sync;delete payload.config.publicFiles;for(const key of ['heroWarning','heroBinding','heroSourceImage'])delete payload.config.branding[key];if(token){for(const p of payload.pages)p.images=(p.images||[]).map(url=>url+'?preview='+token);for(const key of ['backgroundImage'])if(payload.config.branding[key]?.startsWith('/api/site/media/'))payload.config.branding[key]+='?preview='+token;for(const b of payload.config.brandmarks||[])if(b.asset.startsWith('/api/site/media/'))b.asset+='?preview='+token;}return {...payload,revision:v.id,preview:Boolean(token)};}
 return {current:()=>live.payload,fields:revision=>{const found=db.prepare('SELECT payload FROM cms_versions WHERE published=1').all().map(r=>JSON.parse(r.payload)).find(p=>p.formRevision===revision);return found?.fields;},async handle(req,res,url,send){
  if(url.pathname==='/api/site/content'&&req.method==='GET'){const token=url.searchParams.get('preview'),v=selected(token);if(!v){send(res,404,{error:{message:'预览已过期，请在飞书重新生成。'}});return true;}send(res,200,publicPayload(v,token),{'x-robots-tag':token?'noindex, nofollow':'all'});return true;}
  const match=url.pathname.match(/^\/api\/site\/media\/([a-f0-9]{64})$/);if(match&&['GET','HEAD'].includes(req.method)){const v=selected(url.searchParams.get('preview'));const allowed=v&&[v.payload.config.branding.backgroundImage,...(v.payload.config.brandmarks||[]).map(x=>x.asset),...v.payload.pages.flatMap(p=>p.images||[])].includes(url.pathname);const image=allowed?db.prepare('SELECT mime,bytes FROM cms_images WHERE id=?').get(match[1]):null;if(!image){send(res,404,{error:{message:'图片不存在'}});return true;}res.writeHead(200,{'content-type':image.mime,'cache-control':url.searchParams.has('preview')?'private,no-store':'public,max-age=300','x-content-type-options':'nosniff'});res.end(req.method==='HEAD'?undefined:Buffer.from(image.bytes));return true;}
  return false;},async close(){closing=true;clearInterval(timer);await active;}};
}

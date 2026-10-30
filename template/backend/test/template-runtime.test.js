import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {createForumServer} from '../forum-server.js';
import {configuredTracks,checkWindow} from '../event-policy.js';
import {createOssStorage} from '../forum-oss.js';
import {memoryStorage} from './memory-storage.js';
const profile={name:'示例参会者',email:'test@example.org',identityType:'在职人员',organization:'示例大学',jobPosition:'研究人员',attachmentIds:[]};
const practice={key:'practice',title:'实践报告',form:'practice',subtypes:['工具展示'],evidenceRequired:true};
const paper={track:'practice',flashType:'工具展示',title:'示例工具',description:'实践介绍',links:'https://example.org/demo',attachmentIds:[]};
class FeishuFixture{
 rows={registration:[],submission:[]};files=new Map();fail=false;
 async check(){}
 async records(kind){return structuredClone(this.rows[kind]);}
 async find(kind,key,value,meeting){return structuredClone(this.rows[kind].find(r=>r.fields[key]===value&&r.fields['会议标识']===meeting));}
 async write(kind,key,value,meeting,fields){if(this.fail)throw Error('test outage');let row=this.rows[kind].find(r=>r.fields[key]===value);if(!row){row={record_id:randomUUID(),fields:{}};this.rows[kind].push(row);}Object.assign(row.fields,fields);return structuredClone(row);}
 async attachment(file){const token=randomUUID();this.files.set(token,Buffer.from(file.content));return {file_token:token};}
 async download(token){return this.files.get(token);}
}
async function fixture(t,extra={}){
 const root=await mkdtemp(join(tmpdir(),'event-v5-'));const remote=new FeishuFixture(),storage=memoryStorage();let server,base;
 const config={event:{slug:'independent-demo',workflow:'forum',capacity:2},attendance:{},submission:{perTrackLimit:1},tracks:[{key:'academic',title:'学术报告',form:'academic'},practice],...extra};
 await mkdir(join(root,'dist'));await writeFile(join(root,'dist/index.html'),'test');await writeFile(join(root,'config.json'),JSON.stringify(config));
 async function start(){server=await createForumServer({appRoot:root,dataDir:join(root,'state'),origin:'https://test.invalid',fileStorage:storage,feishu:remote,identityResolver:req=>({id:req.headers['x-user']||'one',phone:'+8613900000000'})});await new Promise(r=>server.listen(0,'127.0.0.1',r));base='http://127.0.0.1:'+server.address().port;}
 await start();t.after(async()=>{await server.shutdown();await rm(root,{recursive:true,force:true});});
 const call=async(path,data,user='one')=>{const r=await fetch(base+path,{method:data?'POST':'GET',headers:{origin:'https://test.invalid','content-type':'application/json','x-user':user},...(data?{body:JSON.stringify(data)}:{})});return {status:r.status,data:await r.json()};};
 const draft=async(kind,data,user='one')=>(await call('/api/forum/draft',{kind,data},user)).data.record;
 const submit=(r,data,key=randomUUID(),user='one')=>call('/api/forum/submit',{id:r.id,data,requestId:key,expectedVersion:r.version},user);
 return {root,storage,remote,call,draft,submit,download:(path,user='one')=>fetch(base+path,{headers:{'x-user':user}}),restart:async()=>{await server.shutdown();await start();}};
}
test('default is a single academic category; timing is explicit',()=>{
 assert.equal(configuredTracks({}).length,1);
 assert.doesNotThrow(()=>checkWindow({submission:{closeAt:'2000-01-01'}},'submission'));
 assert.throws(()=>checkWindow({submission:{autoClose:true,closeAt:'2000-01-01'}},'submission'),/截止/);
 assert.throws(()=>checkWindow({submission:{autoClose:true}},'submission'),/valid deadline/);
});
test('OSS environment isolation is explicit, not inferred from hostname',()=>{
 const env={FORUM_OSS_BUCKET:'test-bucket',FORUM_OSS_REGION:'oss-cn-beijing',FORUM_OSS_PREFIX:'my-event/staging/',FORUM_OSS_ACCESS_KEY_ID:'fixture',FORUM_OSS_ACCESS_KEY_SECRET:'fixture',DEPLOY_ENV:'production'};
 assert.throws(()=>createOssStorage(env),/mismatch/);
 assert.doesNotThrow(()=>createOssStorage({...env,DEPLOY_ENV:'staging'}));
});
test('registration review, pending submission, edits, stale reviews, ownership and restart',async t=>{
 const f=await fixture(t);let reg=await f.draft('registration',profile);let result=await f.submit(reg,profile);assert.equal(result.status,200);reg=result.data.record;assert.equal(reg.status,'under_review');
 let report=await f.draft('submission',paper);const submitted=await f.submit(report,paper);assert.equal(submitted.status,200);report=submitted.data.record;
 assert.equal(f.remote.rows.registration[0].fields['当前状态'],'待审核');
 const registration=f.remote.rows.registration[0];registration.fields['当前状态']='已通过';registration.fields['公开意见']='欢迎参会';registration.fields['会务备注']='private-staff';
 let me=await f.call('/api/forum/me');assert.equal(me.data.registration.status,'accepted');assert.ok(!JSON.stringify(me.data).includes('private-staff'));
 const revised=await f.submit(reg,{...profile,organization:'新单位'});assert.equal(revised.status,200);assert.equal(revised.data.record.status,'under_review');assert.equal(revised.data.record.history[0].review.status,'accepted');
 registration.fields['当前状态']='已通过';registration.fields['审核对应版本']='1';me=await f.call('/api/forum/me');assert.equal(me.data.registration.status,'under_review');
 assert.equal((await f.call('/api/forum/draft',{kind:'submission',data:paper})).status,409);
 assert.equal((await f.call('/api/forum/draft',{kind:'submission',id:report.id,data:paper},'two')).status,404);
 assert.equal((await f.call('/api/forum/draft',{kind:'submission',data:{...paper,track:'missing'}})).status,400);
 const edit=await f.submit(report,{...paper,title:'修改后的工具'});assert.equal(edit.data.record.number,report.number);assert.equal(edit.data.record.version,2);
 await f.restart();me=await f.call('/api/forum/me');assert.equal(me.data.registration.data.organization,'新单位');assert.equal(me.data.submissions[0].version,2);
});
test('ambiguous submission retries same operation, never duplicates; status lookup owner isolation',async t=>{
 const f=await fixture(t),r=await f.draft('registration',profile),key=randomUUID();f.remote.fail=true;
 assert.equal((await f.submit(r,profile,key)).status,503);
 assert.equal((await f.call('/api/forum/submission-result?requestId='+key)).data.state,'pending');
 assert.equal((await f.call('/api/forum/submission-result?requestId='+key,undefined,'two')).data.state,'unknown');
 f.remote.fail=false;assert.equal((await f.submit(r,profile,key)).status,200);assert.equal((await f.submit(r,profile,key)).status,200);assert.equal(f.remote.rows.registration.length,1);
 assert.equal((await f.call('/api/forum/submission-result?requestId='+key)).data.state,'completed');
});
test('practice evidence requirements and configurable capacity',async t=>{
 const f=await fixture(t,{event:{slug:'capacity-demo',workflow:'forum',capacity:1},attendance:{enforceCapacity:true}});
 const r=await f.draft('registration',profile);assert.equal((await f.submit(r,profile)).status,200);
 const p=await f.draft('submission',paper);assert.equal((await f.submit(p,{...paper,links:''})).status,400);
 const other=await f.draft('registration',profile,'two');assert.equal((await f.submit(other,profile,randomUUID(),'two')).status,409);
 assert.equal((await f.submit((await f.call('/api/forum/me')).data.registration,{...profile,name:'更新姓名'})).status,200);
});
test('uploaded bytes stay in object storage, not SQLite; download ownership is enforced',async t=>{
 const f=await fixture(t),bytes=Buffer.from('attachment fixture bytes');
 const result=await f.call('/api/forum/files',{name:'evidence.txt',contentBase64:bytes.toString('base64')});assert.equal(result.status,201);
 const db=new DatabaseSync(join(f.root,'state/recovery.sqlite'),{readOnly:true});
 const file=db.prepare('SELECT * FROM files WHERE id=?').get(result.data.file.id);assert.equal(file.content.length,0);assert.equal(file.size,bytes.length);db.close();
 assert.deepEqual(await f.storage.get(file.oss_key),bytes);
 const received=await f.download('/api/forum/files/'+file.id);assert.equal(received.status,200);assert.deepEqual(Buffer.from(await received.arrayBuffer()),bytes);
 assert.equal((await f.download('/api/forum/files/'+file.id,'two')).status,404);
});

// Explicit local QA only. No SMS, Feishu, OSS or central-profile writes.
import {randomUUID} from 'node:crypto';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {createForumServer} from '../forum-server.js';
if(process.env.NODE_ENV==='production')throw Error('Production refuses fixture server');
const root=resolve(import.meta.dirname,'../..');
const config=JSON.parse(await readFile(join(root,'config.json'),'utf8'));
const files=new Map(),objects=new Map(),rows={registration:[],submission:[]};
const storage={put:async(k,v)=>objects.set(k,Buffer.from(v)),get:async k=>{if(!objects.has(k))throw Error('Missing fixture object');return objects.get(k);}};
for(const file of config.publicFiles||[])await storage.put(file.key,await readFile(join(root,file.source)));
const remote={check:async()=>{},records:async kind=>structuredClone(rows[kind]),find:async(kind,key,value)=>structuredClone(rows[kind].find(r=>r.fields[key]===value)),write:async(kind,key,value,meeting,fields)=>{let row=rows[kind].find(r=>r.fields[key]===value);if(!row){row={record_id:randomUUID(),fields:{}};rows[kind].push(row);}Object.assign(row.fields,fields);return structuredClone(row);},attachment:async f=>{const token=randomUUID();files.set(token,Buffer.from(f.content));return {file_token:token};},download:async token=>files.get(token)};
const dir=await mkdtemp(join(tmpdir(),'event-browser-fixture-'));
const port=Number(process.env.PORT||3420),origin='http://127.0.0.1:'+port;
const server=await createForumServer({appRoot:root,dataDir:dir,origin,fileStorage:storage,feishu:remote,env:{PROFILE_HUB_URL:'',TASHAN_SSO_CLIENT_ID:'',AUTH_SERVICE_URL:'https://auth.example.invalid'},authTransport:async()=>Response.json({data:{user:{id:'local-test-user',phoneNormalized:'+8613900000000',passwordSet:false}}}),identityResolver:async()=>({id:'local-test-user',phone:'+8613900000000',passwordSet:false})});
await new Promise(r=>server.listen(port,'127.0.0.1',r));
const profile={name:'测试参会者',email:'test@example.org',identityType:'在职人员',organization:'示例大学',jobPosition:'研究人员',attachmentIds:[]};
const call=async(path,data)=>{const r=await fetch(origin+path,{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify(data)});if(!r.ok)throw Error('Fixture initialization failed');return r.json();};
const draft=await call('/api/forum/draft',{kind:'registration',data:profile});
await call('/api/forum/submit',{id:draft.record.id,requestId:randomUUID(),expectedVersion:0,data:profile});
console.log('LOCAL FIXTURE ONLY: '+origin+' (isolated test identity; data discarded on exit)');
let closing=false;async function close(){if(closing)return;closing=true;await server.shutdown();await rm(dir,{recursive:true,force:true});}
for(const signal of ['SIGINT','SIGTERM','SIGBREAK'])process.on(signal,()=>void close());

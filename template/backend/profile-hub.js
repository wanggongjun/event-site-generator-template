import {createHmac,randomBytes} from 'node:crypto';

/**
 * Forum side of the unified profile hub.
 *
 * The phone number always comes from the server-side session (`owner.phone`), never from
 * the request body, so a browser cannot ask for somebody else's material by changing a
 * number or an id. The hub answers candidates and confirmed values separately; nothing
 * here writes the forum registration.
 */
const FIELDS=['real_name','organization','major','research_direction','email','department'];
const LABELS={real_name:'姓名',organization:'单位',major:'专业',research_direction:'研究方向',email:'联系邮箱',department:'院系／部门'};
const LIMITS={real_name:80,organization:160,major:300,research_direction:2000,email:180,department:300};

export function profileHubConfig(env){
 if(!env.PROFILE_HUB_URL)return null;
 const secret=env.PROFILE_HUB_SECRET||'';
 if(secret.length<24)throw new Error('PROFILE_HUB_SECRET must be at least 24 characters');
 const url=new URL(env.PROFILE_HUB_URL);
 const loopback=env.PROFILE_HUB_ALLOW_LOOPBACK_HTTP==='1'&&['127.0.0.1','localhost','::1'].includes(url.hostname);
 if((url.protocol!=='https:'&&!(url.protocol==='http:'&&loopback))||url.username||url.password)
  throw new Error('PROFILE_HUB_URL must be an HTTPS endpoint');
 return{url:env.PROFILE_HUB_URL.replace(/\/+$/,''),secret,client:env.PROFILE_HUB_CLIENT||'event-site'};
}

export function signHubRequest(secret,rawBody,timestamp=String(Math.floor(Date.now()/1000)),nonce=null,client='panshi-forum'){
 const value=nonce||randomBytes(16).toString('hex');
 return{
  'content-type':'application/json',
  'x-tashan-client':client,
  'x-tashan-hub-version':'1',
  'x-tashan-timestamp':timestamp,
  'x-tashan-nonce':value,
  'x-tashan-hub-signature':'v1='+createHmac('sha256',secret).update(`${timestamp}.${value}.${rawBody}`).digest('hex'),
 };
}

export function normalizePhone(value){
 if(typeof value!=='string')return null;
 let cleaned=value.trim().replace(/[\s-]/g,'');
 if(cleaned.startsWith('+86'))cleaned=cleaned.slice(3);
 else if(cleaned.startsWith('0086'))cleaned=cleaned.slice(4);
 return /^1[3-9][0-9]{9}$/.test(cleaned)?cleaned:null;
}

export function cleanChanges(input){
 if(!input||typeof input!=='object'||Array.isArray(input))return null;
 const changes={};
 for(const [field,value]of Object.entries(input)){
  if(!FIELDS.includes(field))return null;
  if(typeof value!=='string')return null;
  const text=value.trim();
  if(!text)continue;
  if(text.length>LIMITS[field])return null;
  changes[field]=text;
 }
 return Object.keys(changes).length?changes:null;
}

export function createProfileHubClient({config,fetchImpl=globalThis.fetch,timeoutMs=6000}){
 if(!config)return null;
 const call=async(path,payload)=>{
  const body=JSON.stringify(payload);
  let response;
  try{
   response=await fetchImpl(config.url+path,{method:'POST',headers:signHubRequest(config.secret,body,undefined,undefined,config.client),body,
    redirect:'error',signal:AbortSignal.timeout(timeoutMs)});
  }catch{throw Object.assign(new Error('通用资料服务暂时不可用'),{status:503});}
  const data=await response.json().catch(()=>({}));
  if(!response.ok){
   const status=[401,403,404,409,422,429].includes(response.status)?response.status:503;
   const message=response.status===409?'通用资料已更新，请重新读取后再保存':status===503?'通用资料服务暂时不可用':'通用资料请求未完成';
   throw Object.assign(new Error(message),{status,code:data?.detail});
  }
  return data;
 };
 return{
  sync:(payload)=>call('/sync',payload),
  lookup:(phone)=>call('/lookup',{phone}),
  confirm:(phone,payload)=>call('/confirm',{phone,...payload}),
 };
}

/** Shape the hub answer for the browser: confirmed values first, candidates grouped per field. */
export function shapeHubAnswer(answer){
 const confirmed=answer?.confirmed??null;
 const groups=new Map();
 for(const item of answer?.candidates??[]){
  if(!FIELDS.includes(item.field))continue;
  const group=groups.get(item.field)||{field:item.field,label:LABELS[item.field],confirmed:confirmed?.fields?.[item.field]??null,values:[]};
  group.values.push({id:item.id,value:item.value,source:item.source_system,sourceUpdatedAt:item.source_updated_at??null,
   importedAt:item.imported_at??null,note:item.field_note??null});
  groups.set(item.field,group);
 }
 for(const field of FIELDS){
  if(!groups.has(field))groups.set(field,{field,label:LABELS[field],confirmed:confirmed?.fields?.[field]??null,values:[]});
 }
 return{found:Boolean(answer?.found),version:confirmed?.version??null,
  confirmed:confirmed?{version:confirmed.version,fields:confirmed.fields,sources:confirmed.sources}:null,
  fields:[...groups.values()]};
}

export function createProfileHubRoutes({hub,identity,error,send,body}){
 if(!hub)return async()=>false;
 const handle=async(req,res,url,method)=>{
  if(url.pathname!=='/api/forum/profile-hub'&&url.pathname!=='/api/forum/profile-hub/confirm')return false;
  if(url.pathname==='/api/forum/profile-hub'&&method!=='GET'){error(405,'请求方法不支持');}
  if(url.pathname==='/api/forum/profile-hub/confirm'&&method!=='POST'){error(405,'请求方法不支持');}
  const owner=await identity(req,res);
  if(!owner?.id)error(401,'请先登录');
  const phone=normalizePhone(owner.phone);
  if(!phone)error(403,'当前登录方式没有可信手机号，无法读取通用资料');
  if(url.pathname==='/api/forum/profile-hub'){
   try{
    const answer=await hub.lookup(phone);
    send(res,200,{enabled:true,available:true,...shapeHubAnswer(answer)});
   }catch(e){
    // The hub being down must not block login, drafting or submission.
    send(res,200,{enabled:true,available:false,message:e.status===503?'通用资料服务暂时不可用，可手动填写或稍后重试':e.message});
   }
   return true;
  }
  const input=await body(req);
  const changes=cleanChanges(input?.changes);
  if(!changes)error(422,'请提交有效的资料字段');
  if(!Number.isInteger(input?.expectedVersion)||input.expectedVersion<1)error(422,'资料版本无效，请重新读取');
  if(typeof input?.idempotencyKey!=='string'||!/^[A-Za-z0-9_.:-]{8,128}$/.test(input.idempotencyKey))error(422,'请求标识无效');
  const adoptions=input.adoptions??{};
  if(!adoptions||typeof adoptions!=='object'||Array.isArray(adoptions)||Object.entries(adoptions).some(([field,id])=>!Object.hasOwn(changes,field)||typeof id!=='string'||!/^[a-f0-9]{32}$/.test(id)))error(422,'来源选择无效');
  const result=await hub.confirm(phone,{expected_version:input.expectedVersion,idempotency_key:input.idempotencyKey,changes,adoptions});
  send(res,200,{version:result.version,replay:Boolean(result.replay),confirmed:result.fields});
  return true;
 };
 return handle;
}

export {FIELDS as PROFILE_HUB_FIELDS,LABELS as PROFILE_HUB_LABELS};

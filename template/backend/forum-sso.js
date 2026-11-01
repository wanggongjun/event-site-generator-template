import {randomBytes,randomUUID,createHash,createCipheriv,createDecipheriv,timingSafeEqual} from 'node:crypto';
const token=()=>randomBytes(32).toString('base64url'),hash=s=>createHash('sha256').update(s).digest('hex');
const fail=(status,message)=>{throw Object.assign(new Error(message),{status});};
const cookieName='__Host-forum_tashan',flowName='__Host-forum_tashan_flow';
const readCookie=(req,name)=>{const matches=(req.headers.cookie||'').split(';').map(s=>s.trim()).filter(s=>s.startsWith(name+'='));return matches.length===1?matches[0].slice(name.length+1):'';};
const cookie=(name,value,age)=>`${name}=${value}; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=${age}`;
const equal=(a,b)=>typeof a==='string'&&typeof b==='string'&&a.length===b.length&&timingSafeEqual(Buffer.from(a),Buffer.from(b));
export function profilePrefill(profile){
 const result={};for(const [local,remote]of Object.entries({name:'real_name',email:'email',organization:'organization',department:'department',majorCode:'major_code',major:'major',researchInterest:'research_interest',researchDirection:'research_direction',jobPosition:'job_position',identityDescription:'identity_description',personalIntroduction:'personal_introduction'}))if(profile?.[remote])result[local]=profile[remote];
 return result;
}
export function createForumSso({db,env,origin,transport=fetch,legacyIdentity,hasLegacyProfile=async()=>false,now=Date.now}){
 if(!env.TASHAN_SSO_CLIENT_ID)return null;
 if(env.TASHAN_SSO_ORIGIN&&env.TASHAN_SSO_ORIGIN!==origin)throw Error('SSO configuration belongs to another site');
 if(!env.TASHAN_SSO_CLIENT_SECRET||!/^\w{64}$/.test(env.TASHAN_SSO_ENCRYPTION_KEY??''))throw Error('SSO credentials or encryption key missing');
 const key=Buffer.from(env.TASHAN_SSO_ENCRYPTION_KEY,'hex');if(key.length!==32)throw Error('Invalid SSO encryption key');
 const api=env.TASHAN_SSO_API_BASE??'https://world.tashan.chat/api',login=env.TASHAN_SSO_LOGIN_URL??'https://world.tashan.chat/sso/login';
 for(const value of [origin,api,login]){const url=new URL(value);if(url.protocol!=='https:'||url.username||url.password)throw Error('SSO requires HTTPS');}
 db.exec(`CREATE TABLE IF NOT EXISTS tashan_links(subject TEXT PRIMARY KEY,owner TEXT NOT NULL UNIQUE,linked_at TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS tashan_sessions(hash TEXT PRIMARY KEY,subject TEXT NOT NULL,owner TEXT NOT NULL,secret TEXT NOT NULL,expires INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS tashan_flows(hash TEXT PRIMARY KEY,state TEXT NOT NULL,secret TEXT NOT NULL,expires INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS tashan_profile_history(id INTEGER PRIMARY KEY,owner TEXT NOT NULL,profile TEXT NOT NULL,created_at TEXT NOT NULL);`);
 const seal=value=>{const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key,iv);const data=Buffer.concat([cipher.update(JSON.stringify(value)),cipher.final()]);return Buffer.concat([iv,cipher.getAuthTag(),data]).toString('base64');};
 const open=value=>{const b=Buffer.from(value,'base64'),cipher=createDecipheriv('aes-256-gcm',key,b.subarray(0,12));cipher.setAuthTag(b.subarray(12,28));return JSON.parse(Buffer.concat([cipher.update(b.subarray(28)),cipher.final()]));};
 const buckets=new Map();function limit(req){const ip=req.socket.remoteAddress||'unknown',old=buckets.get(ip),entry=old&&old.until>now()?old:{count:0,until:now()+60000};if(++entry.count>40)fail(429,'请求过于频繁，请稍后重试');if(buckets.size>2000)buckets.clear();buckets.set(ip,entry);}
 async function request(path,data){let response;try{response=await transport(api.replace(/\/$/,'')+'/auth/sso/'+path,{method:'POST',redirect:'error',signal:AbortSignal.timeout(10000),headers:{'content-type':'application/json'},body:JSON.stringify({client_id:env.TASHAN_SSO_CLIENT_ID,client_secret:env.TASHAN_SSO_CLIENT_SECRET,...data})});}catch{fail(503,'他山认证暂时不可用，请稍后重试');}
  if(!response.ok)fail([401,403,409,422].includes(response.status)?response.status:503,response.status===409?'资料已变化，请刷新并核对后重新保存':'他山认证暂时无法完成此操作');return response.json();}
 function identity(value){if(!value?.active&&value?.active!==undefined)fail(401,'请重新登录');const u=value?.user,p=u?.profile;if(!Number.isSafeInteger(u?.user_id)||u.user_id<1||u.is_guest!==false||!Number.isSafeInteger(p?.version)||p.version<1)fail(503,'他山账号资料格式不正确');return {subject:'topiclab:'+u.user_id,profile:p};}
 async function session(req){const raw=readCookie(req,cookieName);if(!raw)return null;const row=db.prepare('SELECT * FROM tashan_sessions WHERE hash=? AND expires>?').get(hash(raw),now());if(!row)fail(401,'登录已失效，请重新登录');const secret=open(row.secret),value=await request('session/check',{session_token:secret.token});if(value.active!==true)fail(401,'请重新登录');const user=identity(value);if(user.subject!==row.subject)fail(401,'账号发生变化，请重新登录');return {row,secret,user};}
 async function resolve(req){const current=await session(req);if(!current)return null;const p=current.user.profile;const phone=/^(?:\+86)?1[3-9][0-9]{9}$/.test(p.phone??'')?p.phone:current.secret.legacyPhone;if(!phone)fail(403,'他山账号缺少手机号，请先使用原磐石账号登录并关联');return {id:current.row.owner,phone,passwordSet:false,tashan:true,subject:current.user.subject,profile:p};}
 async function handle(req,res,url,body,send){const path=url.pathname;if(path!=='/auth/callback'&&!path.startsWith('/api/forum/sso/'))return false;
  res.setHeader('cache-control','no-store');res.setHeader('referrer-policy','no-referrer');
  if(path==='/api/forum/sso/status'&&req.method==='GET'){send(res,200,{enabled:true,signedIn:Boolean(readCookie(req,cookieName))});return true;}
  if(path==='/api/forum/sso/start'&&req.method==='POST'){limit(req);const input=await body(req);if(!['login','link'].includes(input.mode))fail(400,'请选择登录或关联账号');const legacy=input.mode==='link'?await legacyIdentity(req,res):null;
   const browser=token(),state=token(),verifier=token();db.prepare('DELETE FROM tashan_flows WHERE expires<=?').run(now());db.prepare('INSERT INTO tashan_flows VALUES(?,?,?,?)').run(hash(browser),state,seal({verifier,legacy,legacyCookie:hash(readCookie(req,'panshi_learner_session'))}),now()+300000);
   const target=new URL(login);for(const [k,v]of Object.entries({sso_client:env.TASHAN_SSO_CLIENT_ID,sso_redirect:origin+'/auth/callback',sso_state:state,sso_code_challenge:createHash('sha256').update(verifier).digest('base64url'),sso_code_challenge_method:'S256'}))target.searchParams.set(k,v);
   res.setHeader('set-cookie',cookie(flowName,browser,300));send(res,200,{url:target.href});return true;}
  if(path==='/auth/callback'&&req.method==='GET'){limit(req);const raw=readCookie(req,flowName),flow=db.prepare('DELETE FROM tashan_flows WHERE hash=? RETURNING *').get(hash(raw));res.setHeader('set-cookie',cookie(flowName,'',0));
   try{if(!flow||flow.expires<=now()||url.searchParams.getAll('code').length!==1||url.searchParams.getAll('state').length!==1||!equal(flow.state,url.searchParams.get('state')))fail(400,'登录流程失效');const saved=open(flow.secret),code=url.searchParams.get('code');if(!code||code.length>256)fail(400,'登录流程失效');
    if(saved.legacy){if(!equal(saved.legacyCookie,hash(readCookie(req,'panshi_learner_session'))))fail(401,'原账号已变化');const current=await legacyIdentity(req,res);if(current.id!==saved.legacy.id)fail(401,'原账号已变化');}
    const value=await request('token',{code,code_verifier:saved.verifier,redirect_uri:origin+'/auth/callback'}),user=identity(value);if(typeof value.session_token!=='string'||value.session_token.length<32||!Number.isSafeInteger(value.expires_at)||value.expires_at*1000<=now())fail(503,'登录凭据格式不正确');
    let link=db.prepare('SELECT * FROM tashan_links WHERE subject=?').get(user.subject);
    if(saved.legacy&&link&&link.owner!==saved.legacy.id)fail(409,'此他山账号已关联其他论坛账号');
    if(!link&&!saved.legacy&&!/^(?:\+86)?1[3-9][0-9]{9}$/.test(user.profile.phone??''))fail(403,'请先使用原磐石手机号账号登录并关联');
    if(!link&&!saved.legacy&&await hasLegacyProfile(user.profile.phone))fail(409,'已有论坛资料，请先使用原磐石账号登录再关联');
    if(!link){const owner=saved.legacy?.id??randomUUID();if(db.prepare('SELECT 1 FROM tashan_links WHERE owner=?').get(owner))fail(409,'此论坛账号已关联其他他山账号');db.prepare('INSERT INTO tashan_links VALUES(?,?,?)').run(user.subject,owner,new Date(now()).toISOString());link={owner};}
    const browser=token();db.prepare('INSERT INTO tashan_sessions VALUES(?,?,?,?,?)').run(hash(browser),user.subject,link.owner,seal({token:value.session_token,legacyPhone:saved.legacy?.phone}),value.expires_at*1000);
    res.setHeader('set-cookie',[cookie(flowName,'',0),cookie('panshi_learner_session','',0),cookie(cookieName,browser,Math.max(0,value.expires_at-Math.floor(now()/1000)))]);res.writeHead(303,{location:'/account'});res.end();
   }catch{res.writeHead(303,{location:'/account?ssoError=1'});res.end();}return true;}
  if(path==='/api/forum/sso/logout'&&req.method==='POST'){const raw=readCookie(req,cookieName),row=db.prepare('DELETE FROM tashan_sessions WHERE hash=? RETURNING *').get(hash(raw));if(row)await request('session/revoke',{session_token:open(row.secret).token}).catch(()=>{});res.setHeader('set-cookie',cookie(cookieName,'',0));send(res,200,{ok:true});return true;}
  if(path==='/api/forum/sso/profile'&&req.method==='POST'){limit(req);const current=await session(req);if(!current)fail(401,'请通过他山账号登录');const input=await body(req);if(!Number.isSafeInteger(input.expectedVersion)||!/^[-\w.:]{1,128}$/.test(input.idempotencyKey??'')||!input.changes||Array.isArray(input.changes)||Object.keys(input.changes).some(k=>!['real_name','email','organization','department','major_code','major','research_interest','research_direction','job_position','identity_description','personal_introduction'].includes(k)))fail(400,'统一资料请求格式不正确');
   // Archive both the local business data and incoming remote state before an explicit write.
   const records=db.prepare('SELECT data FROM objects WHERE owner=?').all(current.row.owner);
   db.prepare('INSERT INTO tashan_profile_history(owner,profile,created_at) VALUES(?,?,?)').run(current.row.owner,JSON.stringify({central:current.user.profile,local:records.map(r=>JSON.parse(r.data)),changes:input.changes}),new Date(now()).toISOString());
   const value=await request('profile/update',{session_token:current.secret.token,expected_version:input.expectedVersion,idempotency_key:input.idempotencyKey,changes:input.changes});const user=identity(value);if(user.subject!==current.row.subject)fail(401,'账号发生变化');send(res,200,{profile:user.profile});return true;}
  fail(405,'请求方法不支持');
 }
 return {handle,resolve};
}

import {createHash,createHmac} from 'node:crypto';

export const sha256=bytes=>createHash('sha256').update(bytes).digest('hex');
export function createOssStorage(env,transport=fetch){
 const {FORUM_OSS_BUCKET:bucket,FORUM_OSS_REGION:region,FORUM_OSS_PREFIX:prefix,FORUM_OSS_ACCESS_KEY_ID:accessKey,FORUM_OSS_ACCESS_KEY_SECRET:secret}=env;
 if(!/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(bucket??'')||!/^oss-[a-z0-9-]+$/.test(region??'')||!/^[a-z0-9-]+\/(production|staging)\/$/.test(prefix??'')||!prefix.endsWith('/')||!accessKey||!secret)throw Error('Private forum OSS configuration required');
 if(!['staging','production'].includes(env.DEPLOY_ENV)||!prefix.endsWith('/'+env.DEPLOY_ENV+'/'))throw Error('OSS environment mismatch');
 const host=`${bucket}.${region}.aliyuncs.com`;
 function object(key){if(typeof key!=='string'||key.startsWith('/')||key.split('/').some(p=>!p||p==='.'||p==='..')||/[\\\x00-\x1f]/.test(key))throw Error('Invalid OSS object key');return prefix+key;}
 async function request(method,key,{bytes,mime='application/octet-stream',headers={}}={}){
  const name=object(key),date=new Date().toUTCString();
  const md5=bytes?createHash('md5').update(bytes).digest('base64'):'';
  const ossHeaders=Object.keys(headers).filter(k=>k.startsWith('x-oss-')).sort().map(k=>`${k}:${headers[k]}\n`).join('');
  const canonical=`${method}\n${md5}\n${bytes?mime:''}\n${date}\n${ossHeaders}/${bucket}/${name}`;
  const authorization=`OSS ${accessKey}:${createHmac('sha1',secret).update(canonical).digest('base64')}`;
  const r=await transport(`https://${host}/${name.split('/').map(encodeURIComponent).join('/')}`,{method,headers:{date,authorization,...(bytes?{'content-md5':md5,'content-type':mime}:{}),...headers},...(bytes?{body:bytes}:{}),redirect:'error',signal:AbortSignal.timeout(60000)});
  if(!r.ok){await r.body?.cancel();throw Object.assign(Error('OSS operation failed'),{code:`OSS_${r.status}`});}return r;
 }
 return {
  async put(key,bytes,mime){
   try{const r=await request('PUT',key,{bytes,mime,headers:{'x-oss-object-acl':'private','x-oss-forbid-overwrite':'true','x-oss-meta-sha256':sha256(bytes)}});await r.body?.cancel();}
   catch(e){ // A lost acknowledgement or an existing identical migration object is safe to retry.
    try{const existing=await this.get(key);if(existing.length===bytes.length&&sha256(existing)===sha256(bytes))return;}catch{}
    throw e;
   }
  },
  async get(key){const r=await request('GET',key);const chunks=[];let size=0;for await(const chunk of r.body){size+=chunk.length;if(size>256*1048576)throw Error('OSS object exceeds safety limit');chunks.push(chunk);}return Buffer.concat(chunks);},
  async remove(key){const r=await request('DELETE',key);await r.body?.cancel();},
  async probe(){const key=`checks/${crypto.randomUUID()}`,bytes=Buffer.from('forum-private-storage-check');await this.put(key,bytes,'text/plain');if(sha256(await this.get(key))!==sha256(bytes))throw Error('OSS integrity check failed');const anonymous=await transport(`https://${host}/${object(key)}`,{redirect:'error',signal:AbortSignal.timeout(15000)});await anonymous.body?.cancel();if(anonymous.status!==403)throw Error('OSS object must deny anonymous access');await this.remove(key);return {private:true,readWrite:true};}
 };
}

export function initializeFileStorage(db){
 const columns=new Set(db.prepare('PRAGMA table_info(files)').all().map(c=>c.name));
 for(const [name,type] of [['oss_key','TEXT'],['size','INTEGER'],['sha256','TEXT'],['oss_verified_at','TEXT']])if(!columns.has(name))db.exec(`ALTER TABLE files ADD COLUMN ${name} ${type}`);
 db.exec('UPDATE files SET size=length(content) WHERE size IS NULL');
}
export async function readStoredFile(storage,file){
 const bytes=file.oss_key?await storage.get(file.oss_key):Buffer.from(file.content);
 if(file.oss_key&&(bytes.length!==file.size||sha256(bytes)!==file.sha256))throw Error('Attachment integrity check failed');
 return bytes;
}
export async function migrateFiles(db,storage,{purge=false}={}){
 initializeFileStorage(db);const totals={verified:0,migrated:0,purged:0,bytes:0};
 // One file at a time; no attachment body is written to temporary files.
 for(const {id} of db.prepare('SELECT id FROM files').all()){
  const file=db.prepare('SELECT * FROM files WHERE id=?').get(id);
  const bytes=await readStoredFile(storage,file),hash=sha256(bytes),key=file.oss_key??`attachments/${id}`;
  if(!file.oss_key){await storage.put(key,bytes,file.mime);totals.migrated++;}
  const saved=await storage.get(key);if(saved.length!==bytes.length||sha256(saved)!==hash)throw Error('Migration verification failed');
  // Never clear the old bytes before the remote object has been read back and hashed.
  db.prepare('UPDATE files SET oss_key=?,size=?,sha256=?,oss_verified_at=? WHERE id=?').run(key,bytes.length,hash,new Date().toISOString(),id);
  if(purge&&file.content.length){db.prepare("UPDATE files SET content=x'' WHERE id=?").run(id);totals.purged++;}
  totals.verified++;totals.bytes+=bytes.length;
 }
 return totals;
}

import {readFile} from 'node:fs/promises';
import {createOssStorage,sha256} from '../backend/forum-oss.js';
const config=JSON.parse(await readFile(new URL('../config.json',import.meta.url),'utf8'));
if(process.env.FORUM_OSS_PREFIX!==config.event.slug+'/'+process.env.DEPLOY_ENV+'/')throw Error('OSS upload target does not match event/environment');
const storage=createOssStorage(process.env);
for(const file of config.publicFiles||[]){
 if(!file.source.startsWith('materials/oss-upload/')||file.source.includes('..'))throw Error('Invalid public asset source');
 const bytes=await readFile(new URL('../'+file.source,import.meta.url));
 if(sha256(bytes)!==file.sha256)throw Error('Public asset changed after generation');
 await storage.put(file.key,bytes,'application/octet-stream');
 if(sha256(await storage.get(file.key))!==file.sha256)throw Error('Public asset verification failed');
 console.log('Verified public file: '+file.name);
}

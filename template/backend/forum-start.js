import {existsSync} from 'node:fs';
import {loadEnvFile} from 'node:process';
const ssoConfig=process.env.FORUM_SSO_CONFIG;
if(ssoConfig&&existsSync(ssoConfig))loadEnvFile(ssoConfig);
import {createForumServer} from './forum-server.js';
const preview=process.argv.includes('--preview');if(preview&&process.env.NODE_ENV==='production')throw new Error('Production refuses preview mode.');
const port=Number(process.env.PORT??3300);const host='127.0.0.1';
if(!Number.isInteger(port)||port<1||port>65535)throw new Error('PORT must be between 1 and 65535.');
const server=await createForumServer({preview});
try{await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,host,()=>{server.removeListener('error',reject);resolve();});});console.log(`Forum ${preview?'preview':'service'} listening on ${host}:${port}`);}catch(e){await server.shutdown();throw e;}
let closing;const close=()=>closing??=(async()=>{await server.shutdown();console.log('Forum shutdown complete.');})();
for(const signal of ['SIGINT','SIGTERM','SIGBREAK'])process.on(signal,()=>void close());process.on('message',message=>{if(message==='shutdown')void close();});

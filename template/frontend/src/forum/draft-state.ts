import config from '../config.generated.json';
const prefix=`forum-${config.event.slug}-`;
export function readLocal(user:string,kind:string){try{return JSON.parse(localStorage.getItem(prefix+user+'-'+kind)||'null');}catch{return null;}}
export function writeLocal(user:string,kind:string,value:unknown){try{if(value===null)localStorage.removeItem(prefix+user+'-'+kind);else localStorage.setItem(prefix+user+'-'+kind,JSON.stringify(value));}catch{/* Server-side saved drafts remain available when browser storage is disabled. */}}
export function submissionRequest(user:string,id:string,data:unknown){const key='pending-'+id;const old=readLocal(user,key);if(old&&JSON.stringify(old.data)===JSON.stringify(data))return old.requestId;const requestId=crypto.randomUUID();writeLocal(user,key,{requestId,data});return requestId;}

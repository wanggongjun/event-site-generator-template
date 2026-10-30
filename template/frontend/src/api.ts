export async function api<T=any>(path:string,body?:unknown,method?:string,options?:{timeoutMs?:number}):Promise<T>{
 const controller=options?.timeoutMs?new AbortController():null;
 const timer=controller?setTimeout(()=>controller.abort(),options!.timeoutMs):undefined;
 try{
 const res=await fetch(path,{method:method??(body===undefined?'GET':'POST'),credentials:'same-origin',...(controller?{signal:controller.signal}:{}),headers:{Accept:'application/json',...(body===undefined?{}:{'Content-Type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)})});
 const value=await res.json().catch(()=>({}));
 if(!res.ok){const error=new Error(value.error?.message??`请求失败（${res.status}）`) as Error&{code?:string;status?:number};error.code=value.error?.code;error.status=res.status;throw error;}return value;
 }finally{if(timer!==undefined)clearTimeout(timer);}
}
export function isUnauthenticated(error:unknown){return error instanceof Error&&((error as Error&{status?:number}).status===401||['unauthenticated','UNAUTHENTICATED','authentication_required'].includes((error as Error&{code?:string}).code||''))}

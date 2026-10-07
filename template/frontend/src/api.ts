export async function api<T=any>(path:string,body?:unknown,method?:string):Promise<T>{
 const res=await fetch(path,{method:method??(body===undefined?'GET':'POST'),credentials:'same-origin',headers:{Accept:'application/json',...(body===undefined?{}:{'Content-Type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)})});
 const value=await res.json().catch(()=>({}));
 if(!res.ok){const error=new Error(value.error?.message??`请求失败（${res.status}）`) as Error&{code?:string;status?:number};error.code=value.error?.code;error.status=res.status;throw error;}return value;
}
export function isUnauthenticated(error:unknown){return error instanceof Error&&((error as Error&{status?:number}).status===401||['unauthenticated','UNAUTHENTICATED','authentication_required'].includes((error as Error&{code?:string}).code||''))}

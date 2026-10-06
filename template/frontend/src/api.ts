export async function api<T=any>(path:string,body?:unknown,method?:string):Promise<T>{
 const res=await fetch(path,{method:method??(body===undefined?'GET':'POST'),credentials:'same-origin',headers:{Accept:'application/json',...(body===undefined?{}:{'Content-Type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)})});
 const value=await res.json().catch(()=>({}));
 if(!res.ok){const error=new Error(value.error?.message??`请求失败（${res.status}）`) as Error&{code?:string};error.code=value.error?.code;throw error;}return value;
}

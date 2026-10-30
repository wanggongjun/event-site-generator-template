export function resolveAuthServiceUrl(value){
 if(!value)throw Error('AUTH_SERVICE_URL is required; configure the Tashan service or independent compatible adapter');
 const url=new URL(value);if(url.username||url.password||url.search||url.hash||url.pathname!=='/')throw Error('AUTH_SERVICE_URL must be an origin');
 return url.origin;
}
export async function verifyAuthService(value,transport=fetch){
 const origin=resolveAuthServiceUrl(value);
 for(const [path,status] of [['/healthz',200],['/api/v1/me/profile',401]]){
  const r=await transport(origin+path,{redirect:'error',signal:AbortSignal.timeout(15000)});await r.body?.cancel();
  if(r.status!==status)throw Error('Authentication contract failed: '+path);
 }
}

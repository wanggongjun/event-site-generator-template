import bundled from './config.generated.json';
export type SiteQuestion={id:string;label:string;type:string;required:boolean;enabled:boolean;options:string[];builtin:boolean;order:number;help:string};
export type SitePage={path:string;label:string;body:string;images?:string[];enabled:boolean;nav:boolean;order:number};
export const siteContent:{revision:string;preview:boolean;pages:SitePage[];fields:SiteQuestion[];formRevision:string}={revision:'bundled',preview:false,pages:[],fields:[],formRevision:''};
const config:any=structuredClone(bundled);
export default config;
export async function loadSiteContent(){
 const preview=window.location.pathname.match(/^\/cms-preview\/([a-f0-9]{64})(?:\/|$)/)?.[1];
 const response=await fetch('/api/site/content'+(preview?'?preview='+preview:''),{credentials:'same-origin',cache:'no-store',signal:AbortSignal.timeout(15000)});
 if(!response.ok)throw Error(preview?'预览已过期，请在飞书重新生成。':'网站内容暂时无法加载，请刷新重试。');
 const data=await response.json();if(!data.config?.event?.title||!Array.isArray(data.pages)||!Array.isArray(data.fields))throw Error('网站内容加载失败');
 Object.assign(config,data.config);Object.assign(siteContent,{revision:data.revision,preview:data.preview,pages:data.pages,fields:data.fields,formRevision:data.formRevision});
 return preview?'/cms-preview/'+preview:undefined;
}

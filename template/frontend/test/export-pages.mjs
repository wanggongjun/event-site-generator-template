// Internal SSR structure/link evidence. These files are not a deployable frontend or a customer entry.
import {readFileSync,writeFileSync,mkdirSync,cpSync,existsSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {pathToFileURL} from 'node:url';

const app=resolve(process.argv[2]||'.');
const {renderPage}=await import(pathToFileURL(join(app,'.page-test-build/render-pages.js')));
const css=['tokens.css','public.css','template.css'].map(p=>readFileSync(join(app,'frontend/src/styles',p),'utf8')).join('\n');
const cfg=JSON.parse(readFileSync(join(app,'frontend/src/config.generated.json'),'utf8'));
const dir=join(app,'test-evidence/public-pages');
mkdirSync(dir,{recursive:true});
for(const name of ['assets','brand']){
 const source=join(app,'frontend/public',name);
 if(existsSync(source))cpSync(source,join(dir,name),{recursive:true});
}
const pages=[['/','home','首页'],['/travel','travel','交通住宿'],['/contact','contact','联系我们'],['/resources','resources','相关资料'],['/faq','faq','常见问题'],['/account','account','个人中心']];
const escape=value=>String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;');
for(const [path,name,label] of pages){
 let html=renderPage(path);
 for(const [route,file] of pages)html=html.replaceAll(`href="${route}"`,`href="${file}.html"`).replaceAll(`href="${route}?`,`href="${file}.html?`);
 for(const folder of ['assets','brand'])html=html.replaceAll(`href="/${folder}/`,`href="${folder}/`).replaceAll(`src="/${folder}/`,`src="${folder}/`);
 const title=escape(`${cfg.event.shortTitle||cfg.event.title} · ${label}`);
 writeFileSync(join(dir,name+'.html'),`<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><style>${css}</style></head><body>${html}</body></html>`);
}
console.log(`六页结构验收证据已导出：${dir}`);

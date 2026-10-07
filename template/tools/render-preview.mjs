import {readFileSync,writeFileSync,mkdirSync,cpSync,existsSync} from 'node:fs';
import {resolve,join} from 'node:path';import {pathToFileURL} from 'node:url';
const app=resolve(process.argv[2]||'.');
const {renderPage}=await import(pathToFileURL(join(app,'.preview-build/preview.js')));
const css=['tokens.css','public.css','template.css'].map(p=>readFileSync(join(app,'frontend/src/styles',p),'utf8')).join('\n');
const cfg=JSON.parse(readFileSync(join(app,'config.json'),'utf8'));
const dir=join(app,'offline-preview');mkdirSync(dir,{recursive:true});
if(existsSync(join(app,'frontend/public/assets')))cpSync(join(app,'frontend/public/assets'),join(dir,'assets'),{recursive:true});
const pages=[['/','home'],['/travel','travel'],['/contact','contact'],['/resources','resources'],['/faq','faq'],['/account','account']];
for(const [path,name] of pages){let html=renderPage(path);
for(const [route,file] of pages){html=html.replaceAll(`href="${route}"`,`href="${file}.html"`).replaceAll(`href="${route}?`,`href="${file}.html?`)}
html=html.replaceAll('href="/assets/','href="assets/').replaceAll('src="/assets/','src="assets/');
writeFileSync(join(dir,name+'.html'),`<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${cfg.event.shortTitle} · 静态预览</title><style>${css}</style></head><body><div style="padding:8px 24px;background:#fff7e4;font-size:13px">资料预览 · 从实际React组件导出；离线表单不交互。真实浏览器交互验收尚未完成。</div>${html}</body></html>`)}
writeFileSync(join(dir,'index.html'),readFileSync(join(dir,'home.html')));console.log(`六页静态预览：${dir}/index.html`);

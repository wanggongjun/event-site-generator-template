import React from 'react';import {createRoot} from 'react-dom/client';import {BrowserRouter} from 'react-router-dom';
import {loadSiteContent,siteContent} from './site-content';
import './styles/tokens.css';import './styles/public.css';import './styles/template.css';
const root=createRoot(document.getElementById('root')!);
root.render(<p role="status">正在加载…</p>);
loadSiteContent().then(async basename=>{const {App}=await import('./App');root.render(<React.StrictMode><BrowserRouter basename={basename}><App preview={siteContent.preview}/></BrowserRouter></React.StrictMode>);}).catch(error=>root.render(<main style={{padding:'3rem'}}><p role="alert">{error.message}</p><button onClick={()=>window.location.reload()}>重新加载</button></main>));

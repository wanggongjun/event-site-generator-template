// Component state test in an in-memory DOM. Not a real browser/visual acceptance.
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {MemoryRouter} from 'react-router-dom';
const dom=new JSDOM('<!doctype html><html><body></body></html>',{url:'http://localhost:3000/account?mode=login'});
Object.assign(globalThis,{window:dom.window,document:dom.window.document,HTMLElement:dom.window.HTMLElement,Element:dom.window.Element,IS_REACT_ACT_ENVIRONMENT:true});
Object.defineProperty(globalThis,'navigator',{value:dom.window.navigator,configurable:true});
dom.window.scrollTo=()=>{};
let authenticated=false;const requests:string[]=[];
globalThis.fetch=async(input:any)=>{const path=String(input);requests.push(path);let status=200,data:any;
 if(path==='/api/public/config')data={runtime:{mode:'simulation'}};
 else if(path==='/api/auth/login'){authenticated=true;data={ok:true}}
 else if(path==='/api/auth/logout'){authenticated=false;data={ok:true}}
 else if(path==='/api/me/profile'){if(!authenticated){status=401;data={error:{code:'UNAUTHENTICATED',message:'请先登录'}}}else data={editable:true,user:{phone:'13900000000'},profile:{name:'模拟用户',email:'author@example.org',organization:'模拟单位',identity:'研究人员',researchDirection:'模拟研究'}}}
 else if(path==='/api/me/attendance')data={attendance:{status:'none'},attendanceStats:{total:0,capacity:null}};
 else if(path==='/api/me/submission')data={submission:null};
 else throw Error('Unexpected mocked API '+path);
 return new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json'}})
};
const {render,fireEvent,waitFor,cleanup}=await import('@testing-library/react');
const {App}=await import('../src/App');
const view=render(<MemoryRouter initialEntries={['/account?mode=login']}><App/></MemoryRouter>);
const entry=()=>view.container.querySelector('.mobile-service-bar__entry')?.textContent;
const sameRoute=dom.window.location.href;
try{
 await view.findByRole('heading',{name:'登录个人中心'});assert.equal(entry(),'登录／注册');
 fireEvent.change(view.getByLabelText('手机号'),{target:{value:'13900000000'}});
 fireEvent.change(view.getByLabelText('密码'),{target:{value:'Passw0rd!'}});
 fireEvent.submit(view.getByRole('button',{name:'登录'}).closest('form')!);
 await view.findByRole('button',{name:'退出登录'});
 await waitFor(()=>assert.equal(entry(),'个人中心'));
 assert.equal(dom.window.location.href,sameRoute,'Login must not require route navigation');
 fireEvent.click(view.getByRole('button',{name:'退出登录'}));
 await view.findByRole('heading',{name:'登录个人中心'});
 await waitFor(()=>assert.equal(entry(),'登录／注册'));
 assert.equal(dom.window.location.href,sameRoute,'Logout must not require route navigation');
 assert.equal(requests.filter(x=>x==='/api/auth/login').length,1);assert.equal(requests.filter(x=>x==='/api/auth/logout').length,1);
 console.log(JSON.stringify({passed:['same-route login updates entry','same-route logout updates entry'],scope:'React component state in mocked in-memory DOM; NOT browser/visual/live API acceptance'}));
}finally{cleanup();dom.window.close()}

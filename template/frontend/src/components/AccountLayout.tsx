import {useEffect,useRef,type ReactNode,type FocusEvent} from 'react';

// Layout and classes reused from panshi-ai4s-camp AccountPage/public.css.
export function AccountLayout({items,active,onSelect,children,label='个人中心'}:{
 items:readonly (readonly [string,string])[];
 active:string;
 onSelect:(section:string)=>void;
 children:ReactNode;
 label?:string;
}){
 const activeButton=useRef<HTMLButtonElement>(null);
 useEffect(()=>{activeButton.current?.scrollIntoView?.({block:'nearest',inline:'nearest'});},[active]);
 function keepControlVisible(event:FocusEvent<HTMLElement>){
  const control=event.target;
  if(window.innerWidth>640||!control.matches('button,input,select,textarea,a'))return;
  const dock=document.querySelector('.mobile-service-dock');
  if(dock&&control.getBoundingClientRect().bottom>dock.getBoundingClientRect().top)
   control.scrollIntoView?.({block:'center',behavior:'instant'});
 }
 return <section className="account-center account-page" aria-label={label} onFocusCapture={keepControlVisible}>
  <div className={items.length?'account-center__layout':undefined}>
   {items.length>0&&<nav className="account-tabs" aria-label="个人中心导航">
    {items.map(([value,label])=><button key={value} type="button" ref={active===value?activeButton:null}
     className={active===value?'is-active':''} aria-current={active===value?'page':undefined}
     onClick={()=>onSelect(value)}>{label}</button>)}
   </nav>}
   <div className="account-panel">{children}</div>
  </div>
 </section>;
}

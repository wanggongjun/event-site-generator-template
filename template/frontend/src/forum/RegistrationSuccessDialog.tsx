import {useEffect,useRef} from 'react';

export function RegistrationSuccessDialog({open,onClose}:{open:boolean;onClose:()=>void}){
 const dialog=useRef<HTMLDialogElement>(null);
 useEffect(()=>{if(open&&!dialog.current?.open)dialog.current?.showModal();else if(!open&&dialog.current?.open)dialog.current?.close();},[open]);
 if(!open)return null;
 return <dialog ref={dialog} className="registration-success-dialog" aria-labelledby="registration-success-title" onClose={onClose}>
  <span className="registration-success-icon" aria-hidden="true">✓</span>
  <h2 id="registration-success-title">报名已提交，待审核</h2>
  <p>报名信息已保存，审核结果将在“在线注册”中显示。待审核期间也可以投稿。</p>
  <button autoFocus type="button" className="account-button" onClick={()=>dialog.current?.close()}>我知道了</button>
 </dialog>;
}

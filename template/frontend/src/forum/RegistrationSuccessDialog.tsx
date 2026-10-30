import {useEffect,useRef} from 'react';

export function RegistrationSuccessDialog({open,onClose}:{open:boolean;onClose:()=>void}){
 const dialog=useRef<HTMLDialogElement>(null);
 useEffect(()=>{if(open&&!dialog.current?.open)dialog.current?.showModal();else if(!open&&dialog.current?.open)dialog.current?.close();},[open]);
 if(!open)return null;
 return <dialog ref={dialog} className="registration-success-dialog" aria-labelledby="registration-success-title" onClose={onClose}>
  <span className="registration-success-icon" aria-hidden="true">✓</span>
  <h2 id="registration-success-title">报名已提交，待审核</h2>
  <p>报名信息已保存，审核与缴费确认结果将在“注册报名”中显示。请按费用说明缴费，并将凭证发送至会务邮箱。</p>
  <button autoFocus type="button" className="account-button" onClick={()=>dialog.current?.close()}>我知道了</button>
 </dialog>;
}

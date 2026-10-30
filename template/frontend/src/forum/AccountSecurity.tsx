import {useState} from 'react';
import {confirmed} from './auth';
import {validPassword} from '../features/auth/AuthForm';
export function AccountSecurity({onSignedOut,passwordSet=true,onPasswordSet}:{onSignedOut:()=>void,passwordSet?:boolean,onPasswordSet?:()=>Promise<void>}){
 const [oldPassword,setOld]=useState(''),[newPassword,setNew]=useState(''),[confirmation,setConfirmation]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState('');
 async function change(){if(busy)return;if((passwordSet&&!oldPassword)||!validPassword(newPassword)||newPassword!==confirmation){setError(passwordSet?'请填写当前密码，新密码须为8—72字节且两次输入一致。':'密码须为8—72字节且两次输入一致。');return;}setBusy(true);setError('');try{setMessage('');await confirmed(passwordSet?'account.password_change':'account.password_set',passwordSet?'/api/v1/me/account/password':'/api/v1/me/account/password/set',passwordSet?{currentPassword:oldPassword,newPassword}:{newPassword},{account:'self'});setOld('');setNew('');setConfirmation('');if(passwordSet)onSignedOut();else{setMessage('密码已设置，以后也可使用密码登录。');await onPasswordSet?.();}}catch(e){setError(e instanceof Error?e.message:'修改密码失败');}finally{setBusy(false);}}
 async function logoutAll(){if(busy||!window.confirm('退出全部已登录设备？报名信息和稿件会保留。'))return;setBusy(true);setError('');try{await confirmed('auth.logout_all','/api/v1/auth/logout-all',{}, {scope:'all_web'});onSignedOut();}catch(e){setError(e instanceof Error?e.message:'退出失败');}finally{setBusy(false);}}
 return <section className="forum-account-security"><p className="auth-help">{passwordSet?'修改密码后需重新登录，报名信息和稿件不受影响。':'您尚未设置密码，可以继续使用验证码登录，也可在这里设置密码。报名信息和稿件不受影响。'}</p>{error&&<p className="auth-message--error" role="alert">{error}</p>}
  {message&&<p className="auth-message--status" role="status">{message}</p>}
  <form className="account-security-form" onSubmit={e=>{e.preventDefault();void change();}}>
   <fieldset disabled={busy} className="account-security-fields">
    {passwordSet&&<label>当前密码<input type="password" autoComplete="current-password" required value={oldPassword} onChange={e=>setOld(e.target.value)}/></label>}
    <label>新密码<input type="password" autoComplete="new-password" required value={newPassword} onChange={e=>setNew(e.target.value)}/></label>
    <label>确认新密码<input type="password" autoComplete="new-password" required value={confirmation} onChange={e=>setConfirmation(e.target.value)}/></label>
   </fieldset>
   <div className="account-actions"><button className="account-button" type="submit" disabled={busy}>{busy?'正在处理…':passwordSet?'修改密码':'设置密码'}</button></div>
  </form>
  <div className="account-session-actions"><button className="account-button account-button--danger" type="button" disabled={busy} onClick={()=>void logoutAll()}>退出全部设备</button></div>
 </section>;
}

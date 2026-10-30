const fields=[['name','姓名'],['organization','单位'],['department','院系／部门'],['major','专业'],['researchDirection','研究方向'],['email','邮箱']] as const;
export function CommonProfileStatus({status,profile,busy,onReload}:{status?:{enabled:boolean;available:boolean;pendingWrite?:boolean};profile:any;busy:boolean;onReload:()=>void}){
 const present=fields.filter(([key])=>typeof profile?.[key]==='string'&&profile[key].trim()).map(([,label])=>label);
 const available=status?.available===true;
 return <section className="account-notice" aria-label="共享资料库">
  <strong>他山共享资料库</strong>
  <p role="status">{available?(present.length?`已读取共享资料：${present.join('、')}。`:'已连接共享资料库，当前手机号暂无可带入的通用资料。'):'共享资料暂时未能读取，可继续填写或重新读取。'}</p>
  <p>已有资料会带入尚未提交的报名表；提交报名后，通用资料会同步回共享资料库。已提交的报名记录和审核结果单独保留。</p>
  {status?.pendingWrite&&<p>有资料更新等待同步，系统会继续重试。</p>}
  <button className="account-button account-button--secondary" type="button" disabled={busy} onClick={onReload}>重新读取共享资料</button>
 </section>;
}

import {api} from '../api';
export function SharedProfile({profile,local,busy,onSaved,onUse,run}:{profile:any;local:any;busy:boolean;onSaved:()=>Promise<void>;onUse:(values:Record<string,string>)=>void;run:(fn:()=>Promise<void>)=>Promise<void>}){
 const fields=[['name','real_name','姓名'],['email','email','邮箱'],['organization','organization','单位'],['department','department','院系或部门'],['majorCode','major_code','专业代码'],['major','major','专业'],['researchInterest','research_interest','研究兴趣'],['researchDirection','research_direction','研究方向'],['jobPosition','job_position','职务'],['identityDescription','identity_description','身份说明'],['personalIntroduction','personal_introduction','个人介绍']] as const;
 const changes=Object.fromEntries(fields.filter(([key,remote])=>local[key]?.trim()&&local[key]!==profile[remote]).map(([key,remote])=>[remote,local[key]]));
 const different=Object.keys(changes).length>0;
 return <details className="account-notice"><summary>他山账号通用资料{different?' · 与本次填写不同':''}</summary>
 <p>原报名、投稿和历史版本保持保留。仅在核对并保存后，将本次填写的通用资料同步到他山账号，供其他网站使用；空值不会覆盖已有资料。</p>
 <table><thead><tr><th>字段</th><th>他山账号</th><th>本次填写</th></tr></thead><tbody>{fields.map(([key,remote,label])=><tr key={key}><td>{label}</td><td>{profile[remote]||'未填写'}</td><td>{local[key]||'未填写'}</td></tr>)}</tbody></table>
 <button className="account-button account-button--secondary" disabled={busy} onClick={()=>{const values=Object.fromEntries(fields.filter(([,remote])=>profile[remote]).map(([key,remote])=>[key,profile[remote]]));onUse(values);}}>将他山资料填入当前表单（尚未提交）</button>
 <button className="account-button account-button--secondary" disabled={busy||!different} onClick={()=>void run(async()=>{await api('/api/forum/sso/profile',{expectedVersion:profile.version,idempotencyKey:crypto.randomUUID(),changes});await onSaved();})}>确认将本次通用资料同步到他山账号</button>
 </details>;
}

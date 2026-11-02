import {useState} from 'react';
import {CoreFields} from './CoreFields';
import {CampFields} from './CampFields';
import {emptyProfile} from './profile-prefill';
import directory from './directory.json';
import {siteContent} from '../site-content';
import {REGISTRATION_STUDENT_IDENTITIES} from './contracts';
export function CmsRegistrationPreview(){
 const [value,setValue]=useState<any>({...emptyProfile,customAnswers:{}});const attachment=siteContent.fields.find(q=>q.id==='attachmentIds');
 return <section><h2>在线报名 · 表单预览</h2><p>可试选身份、发票类型和选项；不会保存、上传或提交任何资料。</p><div className="account-profile-form"><CoreFields values={value} phone="登录后自动填入" directory={directory} onChange={(key,next)=>setValue((v:any)=>({...v,[key]:next}))} onMajorChange={(majorCode,major)=>setValue((v:any)=>({...v,majorCode,major}))}/>{attachment?.enabled&&REGISTRATION_STUDENT_IDENTITIES.has(value.identityType)&&<p>{attachment.label}（{attachment.required?'必填':'选填'}，最多5份，每份5MB；预览不上传）</p>}<CampFields value={value} onChange={(key,next)=>setValue((v:any)=>({...v,[key]:next}))}/><button type="button" className="account-button" disabled>预览不接受报名</button></div></section>;
}

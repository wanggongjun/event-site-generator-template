import {trackFor} from './event-policy.js';
import {createHash} from 'node:crypto';
import directory from './forum-directory.json' with {type:'json'};
import {feishuText} from './feishu-client.js';
export const identities=['本科生','硕士研究生','博士研究生','在站博士后','在职人员','其他'];
export const skills=['python','git','cli','curl','context-engineering','agent-skill','agent-harness','rag','cnn','transformer'];
export const flashTypes=['Skill 分享','工具或应用展示','AI 实践经验分享','其他'];
export const statusLabels={under_review:'待审核',reviewing:'审核中',needs_materials:'需补充材料',accepted:'已录用',rejected:'未录用',withdrawn:'已撤回'};
export const error=(status,message)=>{throw Object.assign(new Error(message),{status});};
export const text=(v,max=15000)=>{if(typeof v!=='string'||v.length>max||/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(v))error(400,'填写内容格式不正确');return v.trim();};
export const fingerprint=data=>createHash('sha256').update(JSON.stringify(data)).digest('hex');
export function profilePrefill(record){
 if(!record)return null;
 const keys=['name','email','identityType','organization','department','majorCode','major','researchInterest','researchDirection','jobPosition','identityDescription'];
 const data=Object.fromEntries(keys.flatMap(k=>typeof record.profile?.[k]==='string'&&record.profile[k].length<=(['researchInterest','researchDirection','identityDescription'].includes(k)?2000:300)?[[k,record.profile[k]]]:[]));
 if(data.name==='实训营学员')delete data.name;
 if(data.identityType&&!identities.includes(data.identityType))delete data.identityType;
 const answers=record.answers??{},mode=answers['71000000-0000-4000-8000-000000000017'],ratings=answers['71000000-0000-4000-8000-000000000011']?.ratings,intro=answers['71000000-0000-4000-8000-000000000014'];
 if(['none','chat','local-autonomous'].includes(mode))data.aiMode=mode;
 data.ratings=Object.fromEntries(skills.flatMap(k=>['unfamiliar','basic','proficient'].includes(ratings?.[k])?[[k,ratings[k]]]:[]));
 if(typeof intro==='string'&&intro.length<=5000)data.personalIntroduction=intro;
 return data;
}
export function profileData(body,phone,formal=false,cmsFields=null){
 const definition=id=>cmsFields?.find(q=>q.id===id);
 const enabled=id=>!cmsFields||definition(id)?.enabled===true;
 const mandatory=id=>!cmsFields||definition(id)?.required===true;
 const keys=['name','email','identityType','organization','department','majorCode','major','researchInterest','researchDirection','jobPosition','identityDescription','personalIntroduction','aiMode','paymentMethod','invoiceType','invoiceTitle','invoiceTaxId','invoiceAddress','invoicePhone','invoiceBank','invoiceAccount','dietaryNeeds','researchQuestions','termsAccepted'];
 const data=Object.fromEntries(keys.map(k=>[k,text(body[k]??'',['dietaryNeeds','researchQuestions'].includes(k)?2000:k==='personalIntroduction'?5000:['researchDirection','researchInterest','identityDescription'].includes(k)?2000:300)]));data.phone=phone;
 data.ratings=Object.fromEntries(skills.map(k=>[k,text(body.ratings?.[k]??'',50)]));data.attachmentIds=fileIds(body.attachmentIds);
 const required={本科生:['organization','department','majorCode','major'],硕士研究生:['organization','department','majorCode','major','researchDirection'],博士研究生:['organization','department','majorCode','major','researchDirection'],在站博士后:['organization','researchDirection'],在职人员:['organization','jobPosition'],其他:['identityDescription']};
 if(data.email&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email))error(400,'请输入有效电子邮箱');
 if(formal){if(!data.name||!data.email||!identities.includes(data.identityType)||(required[data.identityType]??[]).some(k=>!data[k]))error(400,'请完整填写基本信息');}
 if(formal&&['本科生','硕士研究生','博士研究生'].includes(data.identityType)){const programs=data.identityType==='本科生'?directory.undergraduateMajors:directory.graduatePrograms;if(!programs.some(p=>p.code===data.majorCode&&p.name===data.major))error(400,'请从对应专业名录选择有效代码和名称');}
 if(formal){
  if(enabled('paymentMethod')&&(mandatory('paymentMethod')||data.paymentMethod)&&!(definition('paymentMethod')?.options||['对公转账','现场缴费']).includes(data.paymentMethod))error(400,'请选择缴费方式');
  if(enabled('invoiceType')&&(mandatory('invoiceType')||data.invoiceType)&&!(definition('invoiceType')?.options||['电子普通发票','增值税专用发票','无需发票']).includes(data.invoiceType))error(400,'请选择发票类型');
  if(enabled('invoiceType')&&data.invoiceType&&data.invoiceType!=='无需发票'&&!data.invoiceTitle)error(400,'请填写发票抬头');
  if(enabled('invoiceType')&&data.invoiceType==='增值税专用发票'&&['invoiceTaxId','invoiceAddress','invoicePhone','invoiceBank','invoiceAccount'].some(k=>!data[k]))error(400,'请完整填写增值税专用发票信息');
  if(data.termsAccepted!=='2026-10-30')error(400,'请阅读并同意报名信息使用说明和收费规则');
  if(enabled('attachmentIds')&&mandatory('attachmentIds')&&!data.attachmentIds.length)error(400,'请上传学生证或在职证明');
 }
 for(const q of cmsFields||[])if(q.builtin&&!q.enabled&&q.id!=='core'&&q.id!=='attachmentIds')data[q.id]='';
 if(formal)for(const q of cmsFields||[])if(q.enabled&&q.required&&['dietaryNeeds','researchQuestions'].includes(q.id)&&!data[q.id])error(400,'请填写：'+q.label);
 if(!enabled('invoiceType')||!data.invoiceType||data.invoiceType==='无需发票')for(const k of ['invoiceTitle','invoiceTaxId','invoiceAddress','invoicePhone','invoiceBank','invoiceAccount'])data[k]='';
 const applicable=new Set(required[data.identityType]??[]);if(data.identityType==='本科生')applicable.add('researchInterest');if(data.identityType==='其他')applicable.add('organization');
 for(const key of new Set(Object.values(required).flat().concat('researchInterest')))if(!applicable.has(key))data[key]='';
 return data;
}
export function fileIds(value=[]){if(!Array.isArray(value)||value.length>5||value.some(x=>typeof x!=='string'||! /^[a-f0-9-]{36}$/.test(x)))error(400,'附件列表格式不正确');return [...new Set(value)];}
export function paperData(body,formal=false,tracks=[{key:'academic',title:'学术报告',form:'academic'},{key:'flash',title:'实践分享',form:'practice',subtypes:flashTypes}]){
 const data={};for(const key of ['track','title','category','authors','authorOrganizations','presenter','presenterOrganization','keywords','abstract','references','funding','otherNotes','description','links','accessNote'])data[key]=text(body[key]??'',key==='title'?250:['abstract','description'].includes(key)?20000:15000);
 const track=trackFor(tracks,data.track);const academic=track.form==='academic';data.attachmentIds=fileIds(body.attachmentIds);
 // Leave the field absent in old snapshots so retries retain their original digest.
 if(!academic&&body.flashType!==undefined){data.flashType=text(body.flashType,100);if(data.flashType&&!(track.subtypes||[]).includes(data.flashType))error(400,'请选择有效的分享类型');}
 const links=data.links.split(/\n/).map(x=>x.trim()).filter(Boolean);for(const link of links){try{const u=new URL(link);if(!['http:','https:'].includes(u.protocol)||u.username||u.password)throw new Error();}catch{error(400,'作品链接须为有效的 HTTP/HTTPS 地址');}}
 if(!academic)for(const key of ['category','authors','authorOrganizations','presenter','presenterOrganization','keywords','abstract','references','funding','otherNotes'])data[key]='';else for(const key of ['description','links','accessNote'])data[key]='';
 if(formal){if(!data.title)error(400,'请填写题目');if(academic){if(!['原创研究','学术综述'].includes(data.category)||['authors','presenter','presenterOrganization','keywords','abstract'].some(k=>!data[k])||data.attachmentIds.length!==1)error(400,'请完整填写报告信息并上传一份 Word 摘要');}else {if(track.subtypes?.length&&!(track.subtypes||[]).includes(data.flashType))error(400,'请选择分享类型');if(track.evidenceRequired&&!links.length&&!data.attachmentIds.length)error(400,'请提供相关链接或附件');if(!data.description)error(400,'请填写简要介绍');}}
 return data;
}
export function reviewHistory(record){
 const value=feishuText(record.remote?.fields?.['审核历史']);if(!value)return[];
 let rows;try{rows=JSON.parse(value);}catch{error(503,'审核历史格式需由会务人员核对');}
 if(!Array.isArray(rows))error(503,'审核历史格式需由会务人员核对');
 return rows.map(row=>{const status=Object.keys(statusLabels).includes(row.status)?row.status:Object.entries(statusLabels).find(([,label])=>label===row.status)?.[0];if(!Number.isInteger(row.version)||row.version<1||!status)error(503,'审核历史版本或状态无效');return{version:row.version,status,feedback:text(row.feedback??'',15000),processedAt:text(row.processedAt??'',100)};});
}
export function currentReview(record){if(record.withdrawn)return{status:'withdrawn',feedback:''};const f=record.remote?.fields??{};if(Number(feishuText(f['审核对应版本']))!==record.version)return{status:'under_review',feedback:''};const labels=record.kind==='registration'?{...statusLabels,accepted:'已通过',rejected:'未通过'}:statusLabels;const status=Object.entries(labels).find(([,v])=>v===feishuText(f['当前状态']))?.[0]??'under_review';return{status,feedback:text(feishuText(f['公开意见']))};}

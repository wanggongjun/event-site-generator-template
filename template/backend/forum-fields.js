import directory from './forum-directory.json' with {type:'json'};
import {skills} from './forum-domain.js';
export const skillNames=['Python','Git','CLI','curl','Context Engineering','Agent Skill','Agent Harness','RAG','CNN','Transformer'];
export const registrationColumns=['学校名称','手填学校','院系/培养单位','专业代码','专业名称','研究方向','研究兴趣','职务/职称','身份说明','AI主要使用方式',...skillNames.map(name=>name+'熟悉度'),'个人介绍','首次注册时间','最近提交时间','最近提交标识','资料快照附件','历史个人材料'];
export const submissionColumns=['分论坛ID','首次提交时间','最近提交时间','正式提交标识','作者单位','参考文献','基金项目','其他说明','分享人','分享人单位','分享类型','处理时间','撤回时间','操作历史','历史附件','文字快照附件'];
export function extraRegistrationFields(record,requestId){const d=record.data;return{
 '学校名称':['本科生','硕士研究生','博士研究生'].includes(d.identityType)?d.organization:'','手填学校':['本科生','硕士研究生','博士研究生'].includes(d.identityType)&&!directory.universities.some(s=>s.name===d.organization)?d.organization:'',
 '院系/培养单位':d.department,'专业代码':d.majorCode,'专业名称':d.major,'研究方向':d.researchDirection,'研究兴趣':d.researchInterest,'职务/职称':d.jobPosition,'身份说明':d.identityDescription,
 'AI主要使用方式':{'none':'基本不使用人工智能','chat':'主要通过对话方式使用人工智能','local-autonomous':'使用人工智能在本地环境中自主完成任务'}[d.aiMode]??'',
 ...Object.fromEntries(skills.map((key,i)=>[skillNames[i]+'熟悉度',{'unfamiliar':'不了解','basic':'了解并会简单使用','proficient':'熟练使用并掌握相关原理'}[d.ratings[key]]??''])),
 '个人介绍':d.personalIntroduction,'首次注册时间':record.createdAt??record.updatedAt,'最近提交时间':record.updatedAt,'最近提交标识':requestId,
 '历史个人材料':historicalFiles(record)};}
export function historicalFiles(record){return [...new Set((record.history??[]).flatMap(version=>(version.files??[]).map(f=>f.file_token)))].map(file_token=>({file_token}));}
export function extraSubmissionFields(record,requestId){const d=record.data;return{
 '分论坛ID':d.track,'首次提交时间':record.createdAt??record.updatedAt,'最近提交时间':record.updatedAt,'正式提交标识':requestId,
 '作者单位':d.authorOrganizations??'','参考文献':d.references??'','基金项目':d.funding??'','其他说明':d.otherNotes??'',
 '分享人':record.presenterSnapshot?.name??'','分享人单位':record.presenterSnapshot?.organization??'',
 '分享类型':d.flashType??'',
 '处理时间':'','撤回时间':'','操作历史':JSON.stringify(record.actions??[]),
 '历史附件':historicalFiles(record)};}

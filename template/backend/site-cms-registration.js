import {error,text} from './forum-domain.js';
export function validateCmsAnswers(body,data,fields,formal,formRevision){
 const answers=body.customAnswers??{};if(!answers||Array.isArray(answers)||typeof answers!=='object')error(400,'报名补充信息格式错误');
 data.customAnswers={};data.customLabels={};data.formRevision=formRevision;
 for(const q of fields.filter(q=>q.enabled&&!q.builtin)){
  let value=answers[q.id]??(q.type==='多选'?[]:'');
  if(q.type==='多选'){if(!Array.isArray(value)||value.length>50||value.some(x=>typeof x!=='string'||!q.options.includes(x)))error(400,'请选择有效选项：'+q.label);value=[...new Set(value)];}
  else{value=text(value,q.type==='长文本'?5000:300);if(value&&q.type==='单选'&&!q.options.includes(value))error(400,'请选择有效选项：'+q.label);if(value&&q.type==='数字'&&!/^-?\d+(?:\.\d+)?$/.test(value))error(400,'请填写数字：'+q.label);if(value&&q.type==='日期'&&(!/^\d{4}-\d{2}-\d{2}$/.test(value)||!Number.isFinite(Date.parse(value))||new Date(value).toISOString().slice(0,10)!==value))error(400,'请填写有效日期：'+q.label);}
  if(formal&&q.required&&!value.length)error(400,'请填写：'+q.label);data.customAnswers[q.id]=value;data.customLabels[q.id]=q.label;
 }
 return data;
}

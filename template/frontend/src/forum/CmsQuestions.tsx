import {siteContent} from '../site-content';
export function CmsQuestions({value,onChange}:{value:any;onChange:(value:any)=>void}){
 const fields=siteContent.fields.filter(q=>!q.builtin&&q.enabled);
 return <>{fields.map(q=>{
 const current=value?.[q.id]??(q.type==='多选'?[]:'');const set=(next:any)=>onChange({...value,[q.id]:next});
 if(q.type==='多选')return <fieldset key={q.id} className="registration-question"><legend>{q.label}{q.required?'（必填）':'（选填）'}</legend>{q.options.map(option=><label className="registration-choice" key={option}><input type="checkbox" checked={Array.isArray(current)&&current.includes(option)} required={q.required&&!current.length&&option===q.options[0]} onChange={e=>set(e.target.checked?[...current,option]:current.filter((v:string)=>v!==option))}/>{option}</label>)}{q.help&&<p className="form-help">{q.help}</p>}</fieldset>;
 return <label key={q.id}><span>{q.label}{q.required?'（必填）':'（选填）'}</span>{q.type==='单选'?<select required={q.required} value={current} onChange={e=>set(e.target.value)}><option value="">请选择</option>{q.options.map(o=><option key={o}>{o}</option>)}</select>:q.type==='长文本'?<textarea required={q.required} maxLength={5000} rows={3} value={current} onChange={e=>set(e.target.value)}/>:<input type={q.type==='数字'?'number':q.type==='日期'?'date':'text'} step={q.type==='数字'?'any':undefined} required={q.required} maxLength={300} value={current} onChange={e=>set(e.target.value)}/ >}{q.help&&<small>{q.help}</small>}</label>;
 })}</>;
}

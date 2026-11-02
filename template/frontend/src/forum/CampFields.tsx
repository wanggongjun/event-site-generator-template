import {Link} from 'react-router-dom';
import config,{siteContent} from '../site-content';
import {CmsQuestions} from './CmsQuestions';
export function CampFields({value,onChange}:{value:any;onChange:(key:string,value:any)=>void}){
 const q=(id:string)=>siteContent.fields.find(q=>q.id===id);
 const enabled=(id:string)=>!siteContent.fields.length||q(id)?.enabled===true;
 const label=(id:string,fallback:string)=>q(id)?.label||fallback;
 const field=(key:string,name:string,required=false,area=false)=>enabled(key)?<label key={key}><span>{label(key,name)}{required?'（必填）':'（选填）'}</span>{area?<textarea required={required} maxLength={2000} rows={3} value={value[key]||''} onChange={e=>onChange(key,e.target.value)}/>:<input required={required} maxLength={300} value={value[key]||''} onChange={e=>onChange(key,e.target.value)}/>}</label>:null;
 const select=(id:string,title:string,options:string[])=>enabled(id)?<label><span>{label(id,title)}{q(id)?.required===true?'（必填）':'（选填）'}</span><select required={q(id)?.required===true} value={value[id]||''} onChange={e=>onChange(id,e.target.value)}><option value="">请选择</option>{(q(id)?.options||options).map(o=><option key={o}>{o}</option>)}</select></label>:null;
 return <section className="camp-fields"><h3>报名补充信息</h3><p>{config.notices?.find((x:any)=>x.title==='收费标准')?.body}<Link to="/fees" target="_blank">查看缴费方式、收款账户与收费规则</Link>。</p><p>网站开票信息选填，最终以缴费后扫码填写的信息为准。填写发票信息后，于培训结束后15个工作日内开具发票。</p><div className="camp-field-grid">
 {select('paymentMethod','缴费方式',['微信／支付宝扫码','银行转账','对公转账','现场缴费'])}{select('invoiceType','发票类型',['电子普通发票','增值税专用发票','无需发票'])}
 {enabled('invoiceType')&&value.invoiceType&&value.invoiceType!=='无需发票'&&<>{field('invoiceTitle','发票抬头',q('invoiceTitle')?.required===true)}{field('invoiceTaxId','纳税人识别号／统一社会信用代码',q('invoiceTaxId')?.required===true)}{value.invoiceType==='增值税专用发票'&&<>{field('invoiceAddress','注册地址',q('invoiceAddress')?.required===true)}{field('invoicePhone','注册电话',q('invoicePhone')?.required===true)}{field('invoiceBank','开户银行',q('invoiceBank')?.required===true)}{field('invoiceAccount','银行账号',q('invoiceAccount')?.required===true)}</>}</>}
 {[...['dietaryNeeds','researchQuestions']].sort((a,b)=>(q(a)?.order||0)-(q(b)?.order||0)).map(id=>field(id,id==='dietaryNeeds'?'饮食禁忌':'希望解决的实际问题（1—2个）',q(id)?.required===true,true))}
 <CmsQuestions value={value.customAnswers||{}} onChange={answers=>onChange('customAnswers',answers)}/>
 </div><label className="camp-consent"><input type="checkbox" required checked={value.termsAccepted==='2026-11-02'} onChange={e=>onChange('termsAccepted',e.target.checked?'2026-11-02':'')}/><span>我已阅读<Link to="/privacy" target="_blank">报名信息使用说明</Link>和<Link to="/fees" target="_blank">费用与退费规则</Link>，同意为本次培训处理报名信息。</span></label></section>;
}

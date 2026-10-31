import {createHash} from 'node:crypto';
import {feishuText} from './feishu-client.js';
export const hash=value=>createHash('sha256').update(typeof value==='string'||Buffer.isBuffer(value)?value:JSON.stringify(value)).digest('hex');
const field=(name,type=1,options)=>({field_name:name,type,...(options?{property:{options:options.map(name=>({name}))}}:{})});
const yes=name=>field(name,3,['是','否']);
export const cmsTables={
 settings:{name:'网站设置',fields:[field('设置标识'),field('名称'),field('内容'),field('图片',17),field('填写说明')]},
 pages:{name:'页面栏目',fields:[field('页面路径'),field('栏目名称'),field('正文'),field('图片',17),field('排序',2),yes('显示导航'),yes('启用'),field('填写说明')]},
 questions:{name:'报名字段',fields:[field('字段标识'),field('问题名称'),field('类型',3,['固定信息','短文本','长文本','单选','多选','数字','日期','证明材料']),field('选项（每行一个）'),yes('必填'),yes('启用'),field('排序',2),field('填写说明')]},
 control:{name:'网站发布',fields:[field('名称'),field('操作',3,['待命','生成预览','发布预览','回滚']),field('预览链接'),field('待发布版本'),field('当前版本'),field('回滚到版本'),field('处理结果'),field('更新时间'),field('使用说明')]},
 history:{name:'发布记录',fields:[field('版本'),field('发布时间'),field('操作'),field('内容摘要'),field('来源版本')]}
};
export const builtinQuestions=[
 {id:'core',label:'姓名、手机号、身份及对应单位专业信息',type:'固定信息',required:true,help:'统一账号与共享资料的固定信息，不可删除或停用。'},
 {id:'attachmentIds',label:'学生证或在职证明',type:'证明材料',required:true},
 {id:'paymentMethod',label:'缴费方式',type:'单选',required:true,options:['对公转账','现场缴费']},
 {id:'invoiceType',label:'发票类型',type:'单选',required:true,options:['电子普通发票','增值税专用发票','无需发票']},
 {id:'invoiceTitle',label:'发票抬头',type:'短文本',required:true,help:'选择需要发票时显示。'},
 {id:'invoiceTaxId',label:'纳税人识别号／统一社会信用代码',type:'短文本',required:false,help:'专用发票时必填。'},
 ...[['invoiceAddress','注册地址'],['invoicePhone','注册电话'],['invoiceBank','开户银行'],['invoiceAccount','银行账号']].map(([id,label])=>({id,label,type:'短文本',required:true,help:'仅专用发票时显示，且必填。'})),
 {id:'dietaryNeeds',label:'饮食禁忌',type:'长文本',required:false},
 {id:'researchQuestions',label:'希望解决的实际问题（1—2个）',type:'长文本',required:false},
];
export function seedCms(config){
 const n=title=>config.notices?.find(x=>x.title===title)?.body||'';
 const paras=values=>values.filter(Boolean).join('\n\n');
 const sections=rows=>paras(rows.map(([title,body])=>'## '+title+'\n\n'+body));
 const notices=titles=>paras(titles.map(title=>n(title)?'**'+title+'**：'+n(title):''));
 const contacts=sections(config.contacts.map(x=>[x.responsibility,paras([x.name,x.email?`[${x.email}](mailto:${x.email})`:'',x.phone,x.note])]));
 const organizations=[...new Set(config.home.organizers.map(x=>x.role))].map(role=>role+'：'+config.home.organizers.filter(x=>x.role===role).map(x=>x.name).join('\n')).join('\n\n');
 const agenda='| 日期 | 时间 | 内容 | 主讲人 | 地点 |\n| --- | --- | --- | --- | --- |\n'+config.agenda.map(x=>'| '+[x.date,x.time,x.title,x.speaker||'',x.location||''].map(s=>String(s).replaceAll('|','／').replaceAll('\n',' ')).join(' | ')+' |').join('\n');
 const courses=sections(config.notices.filter(x=>/^第\d+课/.test(x.title)).map(x=>[x.title,x.body]));
 const home=sections([
 ['一、培训介绍',paras(config.home.intro)],
 ['二、举办时间与地点',paras(['培训时间：{{培训日期}}','培训地点：{{活动地点}}','园区地址：{{园区地址}}','培训形式：'+n('会议形式'),'培训对象：'+config.home.target])],
 ['三、日程安排',paras([n('日程后续通知'),agenda])],['四、课程介绍',courses.replaceAll('## ','### ')],['五、组织单位',organizations],
 ['六、报名与报到',paras([notices(['收费标准','在线报名','现场报名','报到安排','结业证书']),'[在线报名](/register) · [查看缴费与发票说明](/fees)'])],
 ['七、食宿与交通',paras([...config.mealGuide.map(x=>x.title+'：'+x.body),'[查看交通路线与推荐住宿](/travel)'])],['八、联系方式',contacts.replaceAll('## ','### ')]
 ]);
 const privacy=paras(['主办单位：'+config.home.organizers.filter(x=>['主办单位','主办'].includes(x.role)).map(x=>x.name).join('、')+'。报名资料用于本次培训的身份核验、会务联络、签到、缴费核对、发票开具及证书办理。','姓名、手机号、邮箱、单位、身份、证明材料和开票资料仅提供给办理相关事务的授权工作人员。身份材料通过私有存储保存，不作为公开资料发布。','账号使用他山统一认证；姓名、单位、专业、研究方向、邮箱和院系等通用资料可从关联服务读取，并在提交报名后同步。发票、饮食、证明材料等本次活动专属资料不写入通用资料库。','饮食禁忌和希望解决的问题为选填，请勿填写与培训无关的敏感信息。需要更正或删除报名资料，请联系会务组；依法需要留存的财务记录按相关要求处理。']);
 const pages=[['/','首页',home],['/register','在线报名',''],['/fees','费用与发票',sections(['收费标准','对公转账','现场缴费','缴费确认','发票说明','退费与名额转让'].map(t=>[t,n(t)]))+'\n\n[在线报名](/register)'],['/travel','交通住宿',sections([['培训地点与报到',paras(['{{活动地点}}','{{园区地址}}',n('报到安排')])],...config.travel.directions.map(x=>[x.title,x.body]),['食宿指引',paras(config.mealGuide.map(x=>x.title+'：'+x.body))],['住宿信息',sections(config.hotels.map(x=>[x.name,paras([x.address,x.description])])).replaceAll('## ','### ')]])],['/contact','联系我们',contacts],['/faq','常见问题',sections(config.faqs.map(x=>[x.question,x.question==='费用是多少？'?n('收费标准'):x.answer]))],['/account','个人中心',''],['/privacy','报名信息使用说明','## 报名信息使用说明\n\n'+privacy],['/about','培训介绍',paras([...config.home.intro,config.home.target,organizations])],['/agenda','日程安排',agenda],['/courses','课程介绍',courses]];
 const specs=[
 ['title','活动名称',config.event.title],['shortTitle','活动简称',config.event.shortTitle],['subtitle','副标题',config.event.subtitle],['technicalSupport','页脚技术支持',config.branding.technicalSupport||''],
 ['startDate','开始日期',config.event.startDate,'YYYY-MM-DD'],['endDate','结束日期',config.event.endDate,'YYYY-MM-DD'],['location','活动地点',config.event.location],['address','园区地址',config.travel.address],
 ['closeAt','报名截止',config.attendance.closeAt,'北京时间，例如 2026-11-21 00:00'],['primaryColor','主题颜色',config.branding.primaryColor,'例如 #4CAF93'],
 ['banner','首页横幅',config.branding.backgroundImage,'直接向图片列上传 PNG/JPG/WebP；不要粘贴飞书临时下载链接。'],['logo','左上角标志',config.brandmarks?.[0]?.asset||'','图片列上传透明 PNG。'],
 ['organizers','页脚主办单位',config.home.organizers.filter(x=>['主办单位','主办'].includes(x.role)).map(x=>x.name).join('、')],['contacts','页脚联系咨询',config.contacts.map(x=>`${x.responsibility}：${x.name} ${x.email||x.phone||''}`).join('\n')],['feeNotice','报名页收费提示',n('收费标准')]
 ];
 return {settings:specs.map(([id,name,value,help])=>({'设置标识':id,'名称':name,'内容':value||'','填写说明':help||'修改后去“网站发布”生成预览，再发布。'})),pages:pages.map(([path,label,body],i)=>({'页面路径':path,'栏目名称':label,'正文':body,'排序':(i+1)*10,'显示导航':i<7?'是':'否','启用':'是','填写说明':['/register','/account'].includes(path)?'系统页面：可修改栏目名、导航顺序，报名问题在“报名字段”配置。':'正文支持 ## 标题、段落、列表、Markdown 表格及链接；不用填写 HTML。可新增 /p/英文名称 页面。'})),questions:builtinQuestions.map((q,i)=>({'字段标识':q.id,'问题名称':q.label,'类型':q.type,'选项（每行一个）':q.options?.join('\n')||'','必填':q.required?'是':'否','启用':'是','排序':(i+1)*10,'填写说明':q.help||'可修改名称、必填和启用；新增问题的字段标识留空，由系统按记录生成。'})),control:[{'名称':'昆明实训营网站发布','操作':'生成预览','处理结果':'内容已导入，正式站继续使用当前版本。','使用说明':'1. 修改设置、页面或报名字段。2. 操作选“生成预览”，约30秒后打开预览链接。3. 确认后选“发布预览”。预览后又修改内容，必须重新生成预览。回滚：填写发布记录中的版本号，再选“回滚”；留空回滚上一版。预览链接仅分享给会务人员，7天有效；预览不接受报名。不要删除本行。'}],history:[]};
}
const val=(r,k)=>typeof r.fields[k]==='number'?String(r.fields[k]):feishuText(r.fields[k]);
const fail=message=>{throw Object.assign(Error(message),{cmsValidation:true});};
const clean=(value,max,label)=>{if(typeof value!=='string'||value.length>max||/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(value))fail(label+'格式不正确');return value.trim();};
const bool=(r,k)=>{const s=val(r,k);if(!['是','否'].includes(s))fail(k+'请选择是或否');return s==='是';};
const order=r=>{const n=Number(val(r,'排序'));if(!Number.isFinite(n)||n<0||n>100000)fail('排序须为0—100000的数字');return n;};
export function compileCms(rows,base,priorFields=[]){
 const config=structuredClone(base),settings={};
 const allowed=new Set(seedCms(base).settings.map(r=>r['设置标识']));
 for(const r of rows.settings){const key=val(r,'设置标识');if(!allowed.has(key)||Object.hasOwn(settings,key))fail('网站设置标识无效或重复：'+key);settings[key]=clean(val(r,'内容'),10000,key);}
 if(!Object.hasOwn(settings,'technicalSupport'))settings.technicalSupport=config.branding.technicalSupport||'';
 for(const key of allowed)if(!Object.hasOwn(settings,key))fail('网站设置缺少：'+key);
 config.branding.technicalSupport=settings.technicalSupport;
 for(const key of ['title','shortTitle','location']){if(!settings[key])fail(key+'不能为空');config.event[key]=settings[key];}
 config.event.subtitle=settings.subtitle;config.travel.address=settings.address;
 for(const key of ['startDate','endDate']){if(!/^\d{4}-\d{2}-\d{2}$/.test(settings[key])||!Number.isFinite(Date.parse(settings[key]))||new Date(settings[key]).toISOString().slice(0,10)!==settings[key])fail('日期应为有效的 YYYY-MM-DD');config.event[key]=settings[key];}
 if(settings.endDate<settings.startDate)fail('结束日期不能早于开始日期');
 const deadline=settings.closeAt.replace(' ','T');const zoned=/[Zz]$|[+-]\d{2}:\d{2}$/.test(deadline)?deadline:deadline+(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(deadline)?':00':'')+'+08:00';
 if(!Number.isFinite(Date.parse(zoned)))fail('报名截止时间格式不正确');config.attendance.closeAt=zoned;config.attendance.autoClose=true;
 if(!/^#[a-fA-F0-9]{6}$/.test(settings.primaryColor))fail('主题颜色应为六位十六进制颜色');config.branding.primaryColor=settings.primaryColor;
 const localImage=value=>/^\/(?:assets|brand)\/[A-Za-z0-9_./-]+$/.test(value)||/^\/api\/site\/media\/[a-f0-9]{64}$/.test(value);
 if(!localImage(settings.banner)||settings.logo&&!localImage(settings.logo)||settings.banner.includes('..')||settings.logo.includes('..'))fail('图片请上传到图片列，不能使用临时链接');
 config.branding.backgroundImage=settings.banner;config.brandmarks=settings.logo?[{label:settings.organizers||config.event.shortTitle,asset:settings.logo}]:[];
 config.home.organizers=[{role:'主办单位',name:settings.organizers}];config.cmsFooterContacts=settings.contacts;
 config.notices=config.notices.map(n=>n.title==='收费标准'?{...n,body:settings.feeNotice}:n);
 const paths=new Set();const pages=rows.pages.map(r=>{
  const path=val(r,'页面路径'),enabled=bool(r,'启用');if(!['/','/register','/account','/fees','/travel','/contact','/faq','/privacy','/about','/agenda','/courses'].includes(path)&&!/^\/p\/[a-z][a-z0-9-]{0,60}$/.test(path))fail('页面路径不支持：'+path);if(paths.has(path))fail('页面路径重复：'+path);paths.add(path);
  const label=clean(val(r,'栏目名称'),40,'栏目名称');if(!label)fail('栏目名称不能为空');
  return{path,label,body:clean(val(r,'正文'),50000,'页面正文'),images:r.cmsImages||[],enabled,nav:bool(r,'显示导航'),order:order(r)};
 }).sort((a,b)=>a.order-b.order||a.path.localeCompare(b.path));
 for(const path of ['/','/register','/account','/privacy','/fees'])if(!pages.some(p=>p.path===path&&p.enabled))fail('必须保留并启用 '+path);
 if(pages.filter(p=>p.enabled&&p.nav).length>10)fail('导航最多显示10个栏目');if(pages.length>40)fail('页面最多40个');
 const fields=rows.questions.map(r=>{
  const explicit=val(r,'字段标识');const builtin=builtinQuestions.find(q=>q.id===explicit);if(explicit&&!builtin)fail('新增问题请将字段标识留空，现有系统标识请勿修改');
  const id=builtin?.id||'q_'+r.record_id,label=clean(val(r,'问题名称'),120,'问题名称'),type=val(r,'类型'),required=bool(r,'必填'),enabled=bool(r,'启用');
  if(!label)fail('问题名称不能为空');if(!builtin&&!['短文本','长文本','单选','多选','数字','日期'].includes(type))fail('新增问题类型不支持');if(builtin&&builtin.type!==type)fail('固定字段类型不能修改：'+label);
  const old=priorFields.find(q=>q.id===id);if(old&&old.type!==type)fail('已发布问题不能修改类型，请停用旧问题并新增');
  const options=val(r,'选项（每行一个）').split(/\r?\n/).map(x=>x.trim()).filter(Boolean);if(options.length>50||new Set(options).size!==options.length||options.some(x=>x.length>200))fail('选项不能重复，最多50项，每项200字');if(['单选','多选'].includes(type)&&!options.length)fail('选择题必须填写选项：'+label);
  if(builtin?.options&&options.some(x=>!builtin.options.includes(x)))fail('缴费和发票选项只能从原有选项中选择');
  return{id,label,type,required,enabled,options,builtin:Boolean(builtin),order:order(r),help:clean(val(r,'填写说明'),1000,'填写说明')};
 }).sort((a,b)=>a.order-b.order||a.id.localeCompare(b.id));
 if(new Set(fields.map(q=>q.id)).size!==fields.length)fail('字段标识重复');if(fields.length>60)fail('报名问题最多60项');
 for(const b of builtinQuestions)if(!fields.some(q=>q.id===b.id))fail('系统字段不要删除，请改为停用：'+b.label);
 if(!fields.find(q=>q.id==='core').enabled||!fields.find(q=>q.id==='core').required)fail('身份与共享资料字段必须保留');
 for(const id of ['invoiceTitle','invoiceAddress','invoicePhone','invoiceBank','invoiceAccount'])if(!fields.find(q=>q.id===id).required)fail('开票字段按发票类型必填，请保留必填设置');
 const invoice=fields.find(q=>q.id==='invoiceType');if(invoice.enabled)for(const id of ['invoiceTitle','invoiceTaxId','invoiceAddress','invoicePhone','invoiceBank','invoiceAccount'])if(!fields.find(q=>q.id===id).enabled)fail('启用发票时，请保留全部开票字段；系统按发票类型显示');
 return {config,pages,fields,formRevision:hash(fields),settings};
}

import {siteContent} from './site-content';
import {SitePage} from './SitePage';
import {CmsRegistrationPreview} from './forum/CmsRegistrationPreview';
import {useEffect,useState,lazy,Suspense,type CSSProperties} from 'react';
import {Link,Route,Routes,useLocation,useHref} from 'react-router-dom';
import sourceConfig from './site-content';
import {type Config,type PersonContact,eventDates,formatDate} from './types';
import {api} from './api';
import {EventBanner} from './components/EventBanner';
import {EventNavigation} from './components/EventNavigation';
import {InfoCard} from './components/InfoCard';
import {ContentSection} from './components/ContentSection';
import {AgendaTables} from './components/AgendaTables';
import {MobileServiceDock} from './features/learner/MobileServiceDock';
import './styles/camp.css';

const Account=lazy(()=>import('./Account').then(m=>({default:m.Account})));
const config=sourceConfig as Config;
const defaultNavigation=[
 {label:'首页',to:'/'},{label:'在线报名',to:'/register'},
 {label:'费用与发票',to:'/fees'},{label:'交通住宿',to:'/travel'},
 {label:'联系我们',to:'/contact'},{label:'常见问题',to:'/faq'},
 {label:'个人中心',to:'/account'},
];
const navigation=siteContent.pages.length?siteContent.pages.filter(p=>p.enabled&&p.nav).map(p=>({label:p.label,to:p.path})):defaultNavigation;
const notice=(title:string)=>config.notices?.find(item=>item.title===title)?.body;
const registrationTitles=['收费标准','在线报名','现场报名','报到安排','结业证书'];
const feeTitles=['收费标准','对公转账','现场缴费','缴费确认','发票说明','退费与名额转让'];

function NoticeParagraphs({titles}:{titles:string[]}){
 return <>{titles.map(title=>notice(title)&&<p key={title}>{title}：{notice(title)}</p>)}</>;
}
function ContactList({contacts=config.contacts}:{contacts?:PersonContact[]}){
 return <div className="contact-list">{[...new Set(contacts.map(x=>x.responsibility))].map(group=>
  <section className="contact-group" key={group}><h3>{group}</h3><ul>
   {contacts.filter(x=>x.responsibility===group).map(p=><li key={p.name}>
    <strong>{p.name}</strong>{p.email&&<span><a href={`mailto:${p.email}`}>{p.email}</a></span>}
    {p.phone&&<span><a href={`tel:${p.phone}`}>{p.phone}</a></span>}{p.note&&<small>{p.note}</small>}
   </li>)}
  </ul></section>)}</div>;
}
function Organizations(){
 return <>{[...new Set(config.home.organizers.map(x=>x.role))].map(role=>
  <p key={role}>{role}：{config.home.organizers.filter(x=>x.role===role).map(x=>x.name).join('、')}</p>)}</>;
}
function Courses(){
 return <>{config.notices?.filter(x=>/^第\d+课/.test(x.title)).map(x=>
  <section className="camp-course-description" key={x.title}><h3>{x.title}</h3><p>{x.body}</p></section>)}</>;
}
function Home(){
 return <div className="home-page forum-notice">
  <ContentSection title="一、培训介绍">{config.home.intro.map((text,i)=><p key={i}>{text}</p>)}</ContentSection>
  <ContentSection title="二、举办时间与地点">
   <p>培训时间：{eventDates(config)}</p><p>培训地点：{config.event.location}</p>
   <p>园区地址：{config.travel.address}</p>
   {notice('会议形式')&&<p>培训形式：{notice('会议形式')}</p>}
   {config.home.target&&<p>培训对象：{config.home.target}</p>}
  </ContentSection>
  <ContentSection title="三、日程安排"><p>{notice('日程后续通知')}</p><AgendaTables agenda={config.agenda}/></ContentSection>
  <ContentSection title="四、课程介绍"><Courses/></ContentSection>
  <ContentSection title="五、组织单位"><Organizations/></ContentSection>
  <ContentSection title="六、报名与报到">
   <NoticeParagraphs titles={registrationTitles}/>
   <p><Link to="/register">在线报名</Link> · <Link to="/fees">查看缴费与发票说明</Link></p>
  </ContentSection>
  <ContentSection title="七、食宿与交通">
   {config.mealGuide?.map(x=><p key={x.title}>{x.title}：{x.body}</p>)}
   <p><Link to="/travel">查看交通路线与推荐住宿</Link></p>
  </ContentSection>
  <ContentSection title="八、联系方式"><ContactList/></ContentSection>
 </div>;
}
function Travel(){
 return <section className="public-page__section" aria-label="交通住宿"><div className="travel-sections">
  <article className="travel-section"><h3>培训地点与报到</h3><div className="travel-section__body">
   <p>培训地点：{config.event.location}</p><p>{config.travel.address}</p><p>{notice('报到安排')}</p>
  </div></article>
  {config.travel.directions.map(x=><article className="travel-section" key={x.title}><h3>{x.title}</h3><div className="travel-section__body"><p>{x.body}</p></div></article>)}
  <article className="travel-section"><h3>食宿指引</h3>{config.mealGuide?.map(x=><div className="hotel-info" key={x.title}><h4>{x.title}</h4><p>{x.body}</p></div>)}</article>
  <article className="travel-section"><h3>住宿信息</h3>{config.hotels.map(x=><div className="hotel-info" key={x.name}><h4>{x.name}</h4><p>{x.address}</p><p>{x.description}</p></div>)}</article>
 </div></section>;
}
function Fees(){
 return <section className="public-page__section forum-notice" aria-label="费用与发票">
  {feeTitles.map(title=><ContentSection key={title} title={title}><p>{notice(title)}</p></ContentSection>)}
  <p className="registration-cta-wrap"><Link className="registration-cta" to="/register">在线报名</Link></p>
 </section>;
}
function Faq(){
 return <section className="faq-page"><header className="faq-page__header"><div><h2>常见问题</h2><p>报名、缴费与会务事项说明</p></div></header>
  <div className="faq-article">{config.faqs.map((x,i)=><article key={x.question}><h3>{i+1}. {x.question}</h3><p>{x.question==='费用是多少？'?notice('收费标准'):x.answer}</p></article>)}</div>
 </section>;
}
function Privacy(){
 const organizers=config.home.organizers.filter(x=>['主办单位','主办'].includes(x.role)).map(x=>x.name).join('、');
 return <section className="public-page__section forum-notice"><ContentSection title="报名信息使用说明">
  <p>主办单位：{organizers}。报名资料用于本次培训的身份核验、会务联络、签到、缴费核对、发票开具及证书办理。</p>
  <p>姓名、手机号、邮箱、单位、身份、证明材料和开票资料仅提供给办理相关事务的授权工作人员。身份材料通过私有存储保存，不作为公开资料发布。</p>
  <p>账号使用他山统一认证；姓名、单位、专业、研究方向、邮箱和院系等通用资料可从关联服务读取，并在提交报名后同步。发票、饮食、证明材料等本次活动专属资料不写入通用资料库。</p>
  <p>饮食禁忌和希望解决的问题为选填，请勿填写与培训无关的敏感信息。需要更正或删除报名资料，请联系会务组；依法需要留存的财务记录按相关要求处理。</p>
 </ContentSection><ContactList/></section>;
}
export function App({preview=false}:{preview?:boolean}={}){
 const homeHref=useHref('/');const location=useLocation();const [authenticated,setAuthenticated]=useState(false);
 const accountRoute=['/account','/register'].includes(location.pathname);
 useEffect(()=>{document.title=`${config.event.shortTitle} · ${navigation.find(x=>x.to===location.pathname)?.label||'培训服务'}`;window.scrollTo(0,0)},[location.pathname]);
 useEffect(()=>{if(preview||accountRoute)return;let active=true;api('/api/v1/me/profile').then(()=>{if(active)setAuthenticated(true)}).catch(()=>{if(active)setAuthenticated(false)});return()=>{active=false}},[preview,location.pathname]);
 const entry={label:authenticated?'个人中心':'登录／注册',to:'/account?mode=login'};
 const datesCard=<InfoCard title="重要日期" mobileGlass><dl className="date-list">
  {sourceConfig.cmsSchedule?.earlyBirdDate&&<div><dt>培训早鸟报名截止</dt><dd>{formatDate(sourceConfig.cmsSchedule.earlyBirdDate,config.event.timezone)}</dd></div>}
  {config.attendance.closeAt&&<div><dt>培训报名截止</dt><dd>{formatDate(config.attendance.closeAt.slice(0,10),config.event.timezone)}</dd></div>}
  {sourceConfig.cmsSchedule?.reportStartDate&&<div><dt>现场报到</dt><dd>{[...new Set([sourceConfig.cmsSchedule.reportStartDate,sourceConfig.cmsSchedule.reportEndDate].filter(Boolean))].map(value=>formatDate(value,config.event.timezone)).join('—')}</dd></div>}
  <div><dt>培训日期</dt><dd>{eventDates(config)}</dd></div>
 </dl></InfoCard>;
 const brandStyle=config.branding.primaryColor?({'--panshi-color-primary':config.branding.primaryColor,'--panshi-gradient-primary':`linear-gradient(135deg, ${config.branding.primaryColor} 0%, color-mix(in srgb, ${config.branding.primaryColor}, white 68%) 100%)`} as CSSProperties):undefined;
 const organizers=config.home.organizers.filter(x=>['主办单位','主办'].includes(x.role));
 return <div className="public-shell public-shell--forum" style={brandStyle}>
  {preview&&<div className="cms-preview-banner" role="status">会务预览 · 尚未发布 · 此处不能登录或提交报名。确认后请回飞书选择“发布预览”。</div>}
  <a className="skip-link" href="#main-content">跳到主要内容</a>
  <EventBanner title={config.event.title} titleHref={homeHref} dates={eventDates(config)} venue={config.event.location}
   seriesText={config.branding.seriesText} brandmarks={config.brandmarks}
   backgroundImage={config.branding.backgroundImage||'/brand/banner-background.png'}/>
  <EventNavigation items={navigation}/>
  <div className="event-container public-layout" data-testid="desktop-content-sidebar">
   <main id="main-content" tabIndex={-1}><Suspense fallback={<p role="status">正在加载…</p>}><Routes>
    {siteContent.pages.length?siteContent.pages.filter(p=>p.enabled&&!['/register','/account'].includes(p.path)).map(p=><Route key={p.path} path={p.path} element={<SitePage page={p}/>}/>):<>
    <Route path="/" element={<Home/>}/><Route path="/travel" element={<Travel/>}/>
    <Route path="/fees" element={<Fees/>}/><Route path="/contact" element={<section className="public-page__section" aria-label="联系我们"><ContactList/></section>}/>
    <Route path="/faq" element={<Faq/>}/><Route path="/privacy" element={<Privacy/>}/>
    <Route path="/about" element={<div className="forum-notice"><ContentSection title="培训介绍">{config.home.intro.map((p,i)=><p key={i}>{p}</p>)}<p>{config.home.target}</p><Organizations/></ContentSection></div>}/>
    <Route path="/agenda" element={<ContentSection title="日程安排"><p>{notice('日程后续通知')}</p><AgendaTables agenda={config.agenda}/></ContentSection>}/>
    <Route path="/courses" element={<ContentSection title="课程介绍"><Courses/></ContentSection>}/>
    </>}
    <Route path="/register" element={preview?<CmsRegistrationPreview/>:<Account config={config} onSessionChange={setAuthenticated}/>}/>
    <Route path="/account" element={preview?<p>个人中心使用正式账号，预览中不开放登录。</p>:<Account config={config} onSessionChange={setAuthenticated}/>}/>
    <Route path="*" element={<section className="placeholder-page"><h2>页面不存在</h2><Link to="/">返回首页</Link></section>}/>
   </Routes></Suspense></main>
   <aside className="public-sidebar" aria-label="活动补充信息">{!accountRoute&&<Link className="registration-cta sidebar-cta" to={entry.to}>{entry.label}</Link>}{datesCard}</aside>
  </div>
  <MobileServiceDock entry={entry}>{datesCard}</MobileServiceDock>
  <footer className="event-footer"><div className="event-container event-footer__grid">
   <section><h2>{config.event.shortTitle}</h2><p>主办单位：{organizers.map(x=>x.name).join('、')}</p>{config.branding.technicalSupport&&<p>技术支持：{config.branding.technicalSupport}</p>}<p>{config.event.subtitle}</p></section>
   <section><h2>联系咨询</h2>{sourceConfig.cmsFooterContacts!==undefined?<p style={{whiteSpace:'pre-line'}}>{sourceConfig.cmsFooterContacts}</p>:[...new Set(config.contacts.map(x=>x.responsibility))].map(group=><div className="event-footer__contact" key={group}><strong>{group}</strong>{config.contacts.filter(x=>x.responsibility===group).map(x=><span key={x.name}>{x.name} {x.email||x.phone}</span>)}</div>)}</section>
   <nav aria-label="页脚导航"><h2>快速入口</h2><Link to="/">活动首页</Link><Link to="/register">在线报名</Link><Link to="/fees">费用与发票</Link><Link to="/account">个人中心</Link><Link to="/privacy">报名信息使用说明</Link></nav>
  </div><div className="event-container event-footer__legal"><span>© {config.event.startDate.slice(0,4)} {config.event.shortTitle}会务组</span></div></footer>
 </div>;
}

import {Link} from 'react-router-dom';
import {AgendaTables} from '../components/AgendaTables';
import {ContentSection} from '../components/ContentSection';
import {eventDates,type Config} from '../types';

// Render the conference notice in its original order; content stays in the workbook.
export function ForumHome({config}:{config:Config}){
 const notice=(title:string)=>config.notices?.find(item=>item.title===title)?.body;
 const registration=(config.notices||[]).filter(x=>!['会议时间','会议地点','会议形式','日程后续通知'].includes(x.title));
 const roles=[...new Set(config.home.organizers.map(item=>item.role))];
 return <div className="home-page forum-notice">
  <ContentSection title="一、会议介绍">
   {config.home.intro.map((text,index)=><p key={index}>{text}</p>)}
  </ContentSection>
  <ContentSection title="二、举办时间与地点">
   {(notice('会议时间')||eventDates(config))&&<p>会议时间：{notice('会议时间')||eventDates(config)}</p>}
   {config.event.location&&<p>会议地点：{notice('会议地点')||config.event.location}</p>}
   {notice('会议形式')&&<p>会议形式：{notice('会议形式')}</p>}
   {config.home.target&&<p>参会对象：{config.home.target}</p>}
  </ContentSection>
  <ContentSection title="三、日程安排">
   <AgendaTables agenda={config.agenda}/>
   {notice('日程后续通知')&&<p>{notice('日程后续通知')}</p>}
  </ContentSection>
  <ContentSection title="四、组织单位">
   {roles.map(role=><p key={role}>{role}：{config.home.organizers.filter(item=>item.role===role).map(item=>item.name).join('、')}</p>)}
  </ContentSection>
  <ContentSection title="五、注册方式">
   {registration.map(item=><p key={item.title}>{item.title}：{item.body}</p>)}
  </ContentSection>
  <ContentSection title="六、食宿与交通">
   {config.mealGuide?.map((item,index)=><p key={'meal'+index}>{item.title}：{item.body}</p>)}
   {config.travel.directions.map((item,index)=><p key={'travel'+index}>{item.title}：{item.body}</p>)}
   {config.hotels.map((hotel,index)=><div className="forum-notice__hotel" key={index}>
    <p>推荐住宿：{hotel.name}</p><p>地址：{hotel.address}</p>
    {hotel.description.split(/\r?\n/).filter(Boolean).map((text,line)=><p key={line}>{text}</p>)}
   </div>)}
   <p><Link to="/travel">查看交通住宿详情</Link></p>
  </ContentSection>
  <ContentSection title="七、会务联系方式">
   {config.contacts.map((contact,index)=><div key={index}>
    <p>会务联系人：{contact.name}</p>
    {contact.phone&&<p>联系电话：<a href={'tel:'+contact.phone}>{contact.phone}</a></p>}
    {contact.email&&<p>电子邮箱：<a href={'mailto:'+contact.email}>{contact.email}</a></p>}
    {contact.note&&<div className="event-signature">{contact.note.split(/\r?\n/).map((text,line)=><p key={line}>{text}</p>)}</div>}
   </div>)}
  </ContentSection>
 </div>;
}

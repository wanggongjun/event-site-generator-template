import {Fragment,type ReactNode} from 'react';
import {Link} from 'react-router-dom';
import {ContentSection} from './components/ContentSection';
import config,{type SitePage as Page} from './site-content';
import {eventDates} from './types';
// React renders plain text by default: no raw HTML, script, iframe or arbitrary styles.
function inline(text:string):ReactNode[]{
 return text.split(/(\*\*[^*\n]+\*\*|\[[^\]\n]+\]\([^\s)]+\))/g).map((part,i)=>{
  if(part.startsWith('**')&&part.endsWith('**'))return <strong key={i}>{part.slice(2,-2)}</strong>;
  const link=part.match(/^\[([^\]]+)\]\(([^)]+)\)$/);if(!link)return part;
  const [,label,url]=link;if(/^\/(?!\/)[A-Za-z0-9_/?=&.#%-]*$/.test(url))return <Link key={i} to={url}>{label}</Link>;
  if(/^(https:\/\/|mailto:|tel:)/i.test(url)){try{const u=new URL(url);if(u.username||u.password)return label;return <a key={i} href={url} rel="noopener noreferrer">{label}</a>;}catch{return label;}}
  return label;
 });
}
function Blocks({text}:{text:string}){
 const lines=text.split('\n'),out:ReactNode[]=[];let i=0;
 while(i<lines.length){const line=lines[i];if(!line.trim()){i++;continue;}
  if(/^###? /.test(line)){out.push(<h3 key={i}>{inline(line.replace(/^#+ /,''))}</h3>);i++;continue;}
  if(line.trim().startsWith('|')&&/^\s*\|?\s*:?-{3}/.test(lines[i+1]||'')){
   const cells=(s:string)=>s.trim().replace(/^\||\|$/g,'').split('|').map(x=>x.trim());const heads=cells(line),rows:string[][]=[];const key=i;i+=2;while(i<lines.length&&lines[i].trim().startsWith('|'))rows.push(cells(lines[i++]));
   out.push(<div className="cms-table-wrap" key={key}><table><thead><tr>{heads.map((h,j)=><th key={j}>{inline(h)}</th>)}</tr></thead><tbody>{rows.map((r,k)=><tr key={k}>{r.map((c,j)=><td key={j}>{inline(c)}</td>)}</tr>)}</tbody></table></div>);continue;
  }
  if(/^[-*] /.test(line)){const key=i,items=[];while(i<lines.length&&/^[-*] /.test(lines[i]))items.push(lines[i++].slice(2));out.push(<ul key={key}>{items.map((t,j)=><li key={j}>{inline(t)}</li>)}</ul>);continue;}
  const key=i,parts=[];while(i<lines.length&&lines[i].trim()&&!/^#{2,3} |^[-*] |^\|/.test(lines[i]))parts.push(lines[i++]);if(!parts.length)parts.push(lines[i++]);out.push(<p key={key}>{parts.map((t,j)=><Fragment key={j}>{j>0&&<br/>}{inline(t)}</Fragment>)}</p>);
 }
 return <>{out}</>;
}
export function SitePage({page}:{page:Page}){
 const body=page.body.replaceAll('{{培训日期}}',eventDates(config)).replaceAll('{{活动地点}}',config.event.location).replaceAll('{{园区地址}}',config.travel.address);
 const parts=body.split(/^## /m);return <div className="forum-notice cms-page" aria-label={page.label}>{page.images?.map((url,i)=><img className="cms-page-image" key={url} src={url} alt={page.label+'图片'+(i+1)}/>)}{parts.map((text,i)=>{if(!text.trim())return null;if(i===0)return <Blocks key={i} text={text}/>;const end=text.indexOf('\n'),title=end<0?text:text.slice(0,end);return <ContentSection key={i} title={title}><Blocks text={end<0?'':text.slice(end+1)}/></ContentSection>;})}</div>;
}

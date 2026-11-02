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
function Blocks({text,images=[]}:{text:string;images?:string[]}){
 const lines=text.split('\n'),out:ReactNode[]=[];let i=0;
 while(i<lines.length){const line=lines[i];if(!line.trim()){i++;continue;}
  const imageSlot=line.trim().match(/^\{\{图片([1-6])\}\}$/);
  if(imageSlot){const url=images[Number(imageSlot[1])-1];if(url)out.push(<img className="cms-page-image cms-inline-image" key={i} src={url} alt={'页面图片'+imageSlot[1]}/>);i++;continue;}
  if(/^###? /.test(line)){out.push(<h3 key={i}>{inline(line.replace(/^#+ /,''))}</h3>);i++;continue;}
  if(line.trim().startsWith('|')&&/^\s*\|?\s*:?-{3}/.test(lines[i+1]||'')){
   const cells=(s:string)=>s.trim().replace(/^\||\|$/g,'').split('|').map(x=>x.trim());const heads=cells(line),rows:string[][]=[];const key=i;i+=2;while(i<lines.length&&lines[i].trim().startsWith('|'))rows.push(cells(lines[i++]));
   out.push(<div className="cms-table-wrap" key={key}><table className={heads[0]==='单位类型'&&heads[1]==='人员类别'?'cms-pricing-table':undefined}><thead><tr>{heads.map((h,j)=><th key={j}>{inline(h)}</th>)}</tr></thead><tbody>{rows.map((r,k)=><tr key={k}>{r.map((c,j)=><td key={j}>{inline(c)}</td>)}</tr>)}</tbody></table></div>);continue;
  }
  if(/^[-*] /.test(line)){const key=i,items=[];while(i<lines.length&&/^[-*] /.test(lines[i]))items.push(lines[i++].slice(2));out.push(<ul key={key}>{items.map((t,j)=><li key={j}>{inline(t)}</li>)}</ul>);continue;}
  const key=i,parts=[];while(i<lines.length&&lines[i].trim()&&!/^#{2,3} |^[-*] |^\||^\s*\{\{图片[1-6]\}\}\s*$/.test(lines[i]))parts.push(lines[i++]);if(!parts.length)parts.push(lines[i++]);out.push(<p key={key}>{parts.map((t,j)=><Fragment key={j}>{j>0&&<br/>}{inline(t)}</Fragment>)}</p>);
 }
 return <>{out}</>;
}
function ContactBlocks({text,images}:{text:string;images?:string[]}){
 return <div className="cms-contact-grid">{text.split(/^### /m).filter(part=>part.trim()).map((part,index)=>{
  const end=part.indexOf('\n');
  return <article className="cms-contact-card" key={index}><h3>{end<0?part:part.slice(0,end)}</h3><Blocks text={end<0?'':part.slice(end+1)} images={images}/></article>;
 })}</div>;
}
export function SitePage({page}:{page:Page}){
 const body=page.body.replaceAll('{{培训日期}}',eventDates(config)).replaceAll('{{活动地点}}',config.event.location).replaceAll('{{园区地址}}',config.travel.address);
 const usedImages=new Set([...body.matchAll(/^\s*\{\{图片([1-6])\}\}\s*$/gm)].map(match=>Number(match[1])-1));
 const parts=body.split(/^## /m);return <div className="forum-notice cms-page" aria-label={page.label}>{page.images?.map((url,i)=>usedImages.has(i)?null:<img className="cms-page-image" key={url} src={url} alt={page.label+'图片'+(i+1)}/>)}{parts.map((text,i)=>{if(!text.trim())return null;if(i===0)return <Blocks key={i} text={text} images={page.images}/>;const end=text.indexOf('\n'),title=end<0?text:text.slice(0,end),content=end<0?'':text.slice(end+1);return <ContentSection key={i} title={title}>{(page.path==='/contact'||title.includes('联系方式'))&&/^### /m.test(content)?<ContactBlocks text={content} images={page.images}/>:<Blocks text={content} images={page.images}/>}</ContentSection>;})}</div>;
}

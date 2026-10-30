export const defaultTracks=[{key:'academic',title:'学术报告',form:'academic',subtypes:[],evidenceRequired:false}];
export function configuredTracks(config){
 if(config.submission?.perTrackLimit!==undefined&&config.submission.perTrackLimit!==1)throw Error('This template supports one submission per category');
 const tracks=config.tracks??defaultTracks;
 if(!Array.isArray(tracks)||!tracks.length||new Set(tracks.map(t=>t.key)).size!==tracks.length||tracks.some(t=>!t.key||!t.title||!['academic','practice'].includes(t.form)))throw Error('Invalid submission tracks');
 return tracks;
}
export function trackFor(tracks,key){
 const track=tracks.find(t=>t.key===key);
 if(!track)throw Object.assign(Error('请选择有效投稿类别'),{status:400});
 return track;
}
export function checkWindow(config,kind,now=Date.now()){
 const policy=config[kind==='registration'?'attendance':'submission']||{};
 if(!policy.autoClose)return;
 if(!policy.closeAt||!Number.isFinite(Date.parse(policy.closeAt)))throw Error('Automatic closing requires a valid deadline');
 if(policy.openAt&&now<Date.parse(policy.openAt))throw Object.assign(Error('尚未开放提交'),{status:409});
 if(now>=Date.parse(policy.closeAt))throw Object.assign(Error('提交已截止'),{status:409});
}

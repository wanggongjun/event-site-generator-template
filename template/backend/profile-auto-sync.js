const mapping={name:'real_name',organization:'organization',major:'major',researchDirection:'research_direction',email:'email',department:'department'};
export function createAutomaticProfiles({db,hub}){
 db.exec('CREATE TABLE IF NOT EXISTS profile_sync_jobs(id TEXT PRIMARY KEY,owner TEXT NOT NULL,payload TEXT NOT NULL)');
 let pending=Promise.resolve();
 const enqueue=fn=>{const job=pending.then(fn);pending=job.catch(()=>{});return job;};
 const payload=owner=>({phone:owner.phone,...(owner.subject?{subject:owner.subject}:{})});
 const form=answer=>Object.fromEntries(Object.entries(mapping).filter(([,field])=>(answer.profile?.[field]||field==='department'&&answer.profile?.[field]==='')).map(([key,field])=>[key,answer.profile[field]]));
 function apply(owner,answer){
  if(owner.tashan&&owner.profile&&Number.isInteger(answer.version)&&answer.version>=owner.profile.version){
   owner.profile={...owner.profile,...answer.profile,version:answer.version};
  }
  return form(answer);
 }
 async function flush(owner){
  if(!hub)return;
  for(const row of db.prepare('SELECT id,payload FROM profile_sync_jobs WHERE owner=? ORDER BY rowid').all(owner.id)){
   await hub.sync({...JSON.parse(row.payload),...payload(owner)});
   db.prepare('DELETE FROM profile_sync_jobs WHERE id=?').run(row.id);
  }
 }
 async function read(owner){
   if(!hub)return {profile:null,status:{enabled:false,available:false}};
   return enqueue(async()=>{
    try{
     let pendingWrite=false;
     try{await flush(owner);}catch{pendingWrite=true;}
     // Other sites can update the hub between two requests from the same session.
     const answer=await hub.sync(payload(owner));
     return {profile:apply(owner,answer),status:{enabled:true,available:true,pendingWrite}};
    }catch(e){
     console.warn('Profile hub read failed:',Number.isInteger(e.status)?e.status:503);
     return {profile:null,status:{enabled:true,available:false}};
    } // Profile availability must never decide login/registration success.
   });
 }
 return {
  read,
  async load(owner){return (await read(owner)).profile;},
  submitted(owner,record){
   if(!hub||record.kind!=='registration')return;
   const changes=Object.fromEntries(Object.entries(mapping).filter(([key])=>typeof record.data[key]==='string'&&record.data[key].trim()).map(([key,field])=>[field,record.data[key].trim()]));
   if(!Object.keys(changes).length)return;
   const id=`registration:${record.id}:${record.version}`;
   db.prepare('INSERT OR IGNORE INTO profile_sync_jobs VALUES(?,?,?)').run(id,owner.id,JSON.stringify({...payload(owner),changes,event_id:id,source_updated_at:record.updatedAt}));
   void enqueue(()=>flush(owner)).catch(()=>{});
  },
  async close(){await pending;}
 };
}

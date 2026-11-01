export const emptyProfile={paymentMethod:'',invoiceType:'',invoiceTitle:'',invoiceTaxId:'',invoiceAddress:'',invoicePhone:'',invoiceBank:'',invoiceAccount:'',dietaryNeeds:'',researchQuestions:'',termsAccepted:'',name:'',email:'',identityType:'',organization:'',department:'',majorCode:'',major:'',researchInterest:'',researchDirection:'',jobPosition:'',identityDescription:'',personalIntroduction:'',aiMode:'',ratings:{},attachmentIds:[]};

// Camp professions are entered directly. Only the camp-specific hub column supplies its category.
export function applyHubProfile(current:any,patch:Record<string,string>,directory:any,overwrite=false){
 const accepted=Object.fromEntries(Object.entries(patch).filter(([key])=>key!=='identityType'&&key!=='majorCode'&&(overwrite||!String(current[key]??'').trim())));
 if(Object.hasOwn(accepted,'major'))accepted.majorCode='';
 return {...current,...accepted};
}

// Use current central fields while retaining meeting-only data and unsaved edits.
export function registrationProfile(registration:any,prefill:any,cached:any,commonProfile:any=null){
 const profile=localRegistrationProfile(registration,prefill,cached);
 if(registration?.version)return profile;
 // The hub has already resolved source timestamps. Meeting snapshots are not current profiles.
 const usableCache=cached?.hydrated&&(!registration?.version||cached.baseVersion===registration.version);
 for(const key of ['name','organization','major','researchDirection','email','department','identityType']){
  const value=commonProfile?.[key];
  if(typeof value!=='string'||(!value.trim()&&key!=='department'))continue;
  // Preserve an in-progress edit only while its central baseline is still current.
  if(usableCache&&cached.commonProfile?.[key]===value&&Object.hasOwn(cached.data||{},key)&&
     (key!=='department'||cached.commonProfile?.organization===commonProfile?.organization))continue;
  if(profile[key]!==value){
   if(key==='organization')profile.department='';
   if(key==='major')profile.majorCode='';
   profile[key]=value;
  }
 }
 return profile;
}

function localRegistrationProfile(registration:any,prefill:any,cached:any){
 const current=registration?.draft?.data||registration?.data;
 const base={...emptyProfile,...(current||prefill||{})};
 if(!cached?.data)return base;
 // A draft from an earlier submitted version must not hide newer server data.
 if(registration?.version && cached.baseVersion!==registration.version)return base;
 if(cached.hydrated)return {...base,...cached.data};
 // Older clients cached an entirely blank initial form; those blanks are not edits.
 const meaningful=Object.fromEntries(Object.entries(cached.data).filter(([,v])=>typeof v==='string'?v.trim()!=='':Array.isArray(v)?v.length>0:v&&typeof v==='object'?Object.keys(v).length>0:false));
 return {...base,...meaningful};
}

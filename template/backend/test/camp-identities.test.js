import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import campIdentities from '../camp-identities.json' with {type:'json'};
import {profileData} from '../forum-domain.js';
import {builtinQuestions} from '../site-cms-model.js';
import {extraRegistrationFields} from '../forum-fields.js';
import {createAutomaticProfiles} from '../profile-auto-sync.js';
import {profilePrefill} from '../forum-sso.js';

const sample={name:'校验人员',email:'check@example.invalid',organization:'示例单位',department:'示例院系',major:'跨学科自填专业',jobPosition:'研究人员',researchDirection:'示例方向',paymentMethod:'现场缴费',invoiceType:'无需发票',termsAccepted:'2026-11-02',attachmentIds:['00000000-0000-4000-8000-000000000000']};

test('student proof remains mandatory while staff and optional invoice fields do not block registration',()=>{
  const fields=builtinQuestions.map(field=>({...field,enabled:true,builtin:true}));
  for(const category of campIdentities){
    const input={...sample,identityType:category.label,paymentMethod:'',invoiceType:'增值税专用发票',attachmentIds:[]};
    if(category.student){
      assert.throws(()=>profileData(input,'13800000000',true,fields),/学生证或在读证明/);
      input.attachmentIds=sample.attachmentIds;
    }
    assert.doesNotThrow(()=>profileData(input,'13800000000',true,fields));
    for(const paymentMethod of ['微信／支付宝扫码','银行转账','对公转账','现场缴费']){
      assert.doesNotThrow(()=>profileData({...input,paymentMethod},'13800000000',true,fields));
    }
    assert.throws(()=>profileData({...input,termsAccepted:'2026-10-30'},'13800000000',true,fields),/收费规则/);
    assert.doesNotThrow(()=>profileData({...input,termsAccepted:'2026-10-30'},'13800000000',true,fields,{allowLegacyIdentity:true}));
  }
  const requiredFields=fields.map(field=>field.id==='invoiceTitle'?{...field,required:true}:field);
  assert.throws(()=>profileData({...sample,identityType:campIdentities[1].label,invoiceType:'电子普通发票'},'13800000000',true,requiredFields),/发票抬头/);
});

test('all four camp categories validate and free-text majors reach the registration table',()=>{
  assert.equal(campIdentities.length,4);
  for(const category of campIdentities){
    const data=profileData({...sample,identityType:category.label},'13800000000',true);
    assert.equal(data.identityType,category.label);
    assert.equal(data.majorCode,'');
    if(category.student){
      assert.equal(data.major,sample.major);
      const columns=extraRegistrationFields({data,history:[],updatedAt:'2026-11-01T00:00:00Z'},'request');
      assert.equal(columns['专业名称'],sample.major);
      assert.equal(columns['学校名称'],sample.organization);
    }
  }
  assert.throws(()=>profileData({...sample,identityType:'在职人员'},'13800000000',true),/人员类别/);
  assert.doesNotThrow(()=>profileData({...sample,identityType:'在职人员'},'13800000000',true,null,{allowLegacyIdentity:true}));
});

test('camp categories share a dedicated column while central identities remain separate',async()=>{
  const db=new DatabaseSync(':memory:');
  const requests=[];
  const sync=createAutomaticProfiles({db,hub:{sync:async payload=>{requests.push(payload);return{profile:{}};}}});
  try{
    for(const [index,category] of campIdentities.entries())sync.submitted({id:'owner',phone:'13800000000'},{id:'reg',version:index+1,kind:'registration',updatedAt:'2026-11-01T00:00:00Z',data:{...sample,identityType:category.label}});
    await sync.close();
    assert.equal(requests.length,4);
    for(const [index,request] of requests.entries()){
      assert.equal(Object.hasOwn(request.changes,'identities'),false);
      assert.equal(Object.hasOwn(request.changes,'identityType'),false);
      assert.equal(request.changes.kiz_personnel_category,campIdentities[index].label);
    }
    assert.equal(profilePrefill({identities:['博士研究生']}).identityType,undefined);
    assert.equal(profilePrefill({identities:campIdentities.map(item=>item.label)}).identityType,undefined);
  }finally{await sync.close();db.close();}
});

test('only valid camp categories prefill and historical generic identities are not sent to the new column',async()=>{
  const db=new DatabaseSync(':memory:');
  const requests=[];
  let category=campIdentities[0].label;
  const sync=createAutomaticProfiles({db,hub:{sync:async payload=>{requests.push(payload);return{profile:{kiz_personnel_category:category}};}}});
  const owner={id:'owner',phone:'13800000000'};
  try{
    assert.equal((await sync.load(owner)).identityType,category);
    category='博士研究生';
    assert.equal((await sync.load(owner)).identityType,undefined);
    sync.submitted(owner,{id:'old',version:1,kind:'registration',updatedAt:'2026-11-01T00:00:00Z',data:{...sample,identityType:'在职人员'}});
    await sync.close();
    assert.equal(Object.hasOwn(requests.at(-1).changes,'kiz_personnel_category'),false);
  }finally{await sync.close();db.close();}
});

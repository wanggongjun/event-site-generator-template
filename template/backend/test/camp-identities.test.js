import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import campIdentities from '../camp-identities.json' with {type:'json'};
import {profileData} from '../forum-domain.js';
import {extraRegistrationFields} from '../forum-fields.js';
import {createAutomaticProfiles} from '../profile-auto-sync.js';
import {profilePrefill} from '../forum-sso.js';

const sample={name:'校验人员',email:'check@example.invalid',organization:'示例单位',department:'示例院系',major:'跨学科自填专业',jobPosition:'研究人员',researchDirection:'示例方向',paymentMethod:'现场缴费',invoiceType:'无需发票',termsAccepted:'2026-10-30',attachmentIds:['00000000-0000-4000-8000-000000000000']};

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

test('camp categories are excluded from automatic profile writeback and central prefill',async()=>{
  const db=new DatabaseSync(':memory:');
  const requests=[];
  const sync=createAutomaticProfiles({db,hub:{sync:async payload=>{requests.push(payload);return{profile:{}};}}});
  try{
    for(const [index,category] of campIdentities.entries())sync.submitted({id:'owner',phone:'13800000000'},{id:'reg',version:index+1,kind:'registration',updatedAt:'2026-11-01T00:00:00Z',data:{...sample,identityType:category.label}});
    await sync.close();
    assert.equal(requests.length,4);
    for(const request of requests){
      assert.equal(Object.hasOwn(request.changes,'identities'),false);
      assert.equal(Object.hasOwn(request.changes,'identityType'),false);
      for(const category of campIdentities)assert.equal(JSON.stringify(request).includes(category.label),false);
    }
    assert.equal(profilePrefill({identities:['博士研究生']}).identityType,undefined);
    assert.equal(profilePrefill({identities:campIdentities.map(item=>item.label)}).identityType,undefined);
  }finally{await sync.close();db.close();}
});

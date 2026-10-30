import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {createAutomaticProfiles} from '../profile-auto-sync.js';
test('a new community update is read immediately even for the same forum session',async()=>{
 const db=new DatabaseSync(':memory:');let organization='旧单位';let calls=0;
 const sync=createAutomaticProfiles({db,hub:{sync:async()=>{calls++;return {profile:{organization}};}}});
 try{
  const owner={id:'owner',phone:'13900000000'};
  assert.equal((await sync.load(owner)).organization,'旧单位');
  organization='中国科学院大学';
  assert.equal((await sync.load(owner)).organization,'中国科学院大学');
  assert.equal(calls,2);
 }finally{await sync.close();db.close();}
});
test('partial automatic profile is available without a confirmation; identity comes from the session',async()=>{
 const db=new DatabaseSync(':memory:');let request;const sync=createAutomaticProfiles({db,hub:{sync:async p=>{request=p;return {profile:{real_name:'Name',organization:'Institute'}};}}});
 try{assert.deepEqual(await sync.load({id:'forum-owner',phone:'13900000000',subject:'topiclab:12'}),{name:'Name',organization:'Institute'});assert.equal(request.subject,'topiclab:12');assert.equal(request.phone,'13900000000');}finally{await sync.close();db.close();}
});
test('registration writeback is durable, retries after outage, and omits empty/non-shared fields',async()=>{
 const db=new DatabaseSync(':memory:');let failed=true;const requests=[];const hub={sync:async p=>{if(failed)throw Error('unavailable');requests.push(p);return{profile:{real_name:'Name'}};}};
 const owner={id:'owner',phone:'13900000000'};let sync=createAutomaticProfiles({db,hub});
 try{
  sync.submitted(owner,{id:'registration-id',kind:'registration',version:1,updatedAt:'2026-10-19T00:00:00Z',data:{name:'Name',organization:'',major:'Physics',email:'private@example.org',department:'Department'}});
  await sync.close();assert.equal(db.prepare('SELECT count(*) n FROM profile_sync_jobs').get().n,1);
  sync=createAutomaticProfiles({db,hub});assert.equal(await sync.load(owner),null);
  failed=false;await sync.load(owner);assert.equal(db.prepare('SELECT count(*) n FROM profile_sync_jobs').get().n,0);
  assert.deepEqual(requests[0].changes,{real_name:'Name',major:'Physics',email:'private@example.org',department:'Department'});assert.equal(requests[0].source_updated_at,'2026-10-19T00:00:00Z');
 }finally{await sync.close();db.close();}
});

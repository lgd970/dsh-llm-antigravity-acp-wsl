import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const quotaSource=readFileSync(new URL('../lib/quota.js',import.meta.url),'utf8');
const resolveModelQuota=vm.runInNewContext('(()=>{'+quotaSource.slice(quotaSource.indexOf('export function quotaFamilyFor('),quotaSource.indexOf('export class QuotaReader')).replaceAll('export function ','function ')+';return resolveModelQuota})()');
const text=readFileSync(new URL('../lib/runtime.js',import.meta.url),'utf8');
const method=text.slice(text.indexOf('    async quotaFor('),text.indexOf('\n    /**',text.indexOf('    async quotaFor(')));
const quotaFor=vm.runInNewContext('( { '+method+' } ).quotaFor',{SYSTEM_ACCOUNT_ID:'default',process:{platform:'win32'},Date,resolveModelQuota});
function runtime(){return {binary:'configured',slots:new Map([['a',{layout:{id:'a',system:false},env:{}}],['b',{layout:{id:'b',system:false},env:{}}]]),quota:{read:()=>{throw new Error('must not fall back to another account')},readFor:async id=>({status:'ok',groups:[{kind:'gemini',name:'Gemini',buckets:[]}],subscriptionTier:'PRO'})},applyQuotaToSlot(){},withSlotEntitlements:(id,s)=>s,accountLabel:l=>l.id+'@example.com'};}
test('explicit account echoes attribution and current model focus',async()=>{const r=runtime();const s=await quotaFor.call(r,'b',false,'gemini-3.8-flash');assert.equal(s.accountId,'b');assert.equal(s.accountLabel,'b@example.com');assert.equal(s.model,'gemini-3.8-flash');assert.equal(s.focus.model,'gemini-3.8-flash');});
test('removed explicit account errors rather than returning another account quota',async()=>{const s=await quotaFor.call(runtime(),'removed',false,'gemini-3.8-flash');assert.equal(s.status,'error');assert.equal(s.accountId,'removed');assert.equal(s.groups.length,0);});
test('remote forwards both account and model',()=>{const r=readFileSync(new URL('../lib/remote.js',import.meta.url),'utf8');assert.match(r,/quotaFor\(request.accountId, force, request.model\)/);});

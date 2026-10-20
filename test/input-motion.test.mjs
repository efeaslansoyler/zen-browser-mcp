import test from 'node:test';
import assert from 'node:assert/strict';
import { mousePath, typingPlan } from '../browser/InputMotion.sys.mjs';
import { ScreenshotCache } from '../browser/ScreenshotCache.sys.mjs';

test('seeded human mouse paths preserve endpoints and requested total duration', () => {
  const options = { movement:'human',duration_ms:321,steps:24,seed:42 };
  const path=mousePath([10,20],[300,200],options);
  assert.deepEqual(path,mousePath([10,20],[300,200],options));
  assert.deepEqual([path.at(-1).x,path.at(-1).y],[300,200]);
  assert.equal(path.reduce((n,p)=>n+p.delay,0),321);
  assert.notDeepEqual(path,mousePath([10,20],[300,200],{...options,seed:99}));
});
test('human typing preserves Unicode and uses character delays rather than rewriting text', () => {
  const input='Hello 世界 👩‍💻!\n';
  const plan=typingPlan(input,{typing:'human',delay_ms:80,seed:12});
  assert.equal(plan.map(p=>p.text).join(''),input);
  assert(plan.every(p=>[...p.text].length===1));
  assert(new Set(plan.map(p=>p.delay)).size>1);
  assert.throws(()=>mousePath([0,0],[2,3],{movement:'human',duration_ms:6000}));
  assert.throws(()=>typingPlan('x',{typing:'human',delay_ms:-1}));
});
test('screenshot cache isolates contexts and is bounded', () => {
  const cache=new ScreenshotCache(8),doc={};
  assert(!cache.unchanged('A:1',[doc,1], 'abcd'));
  assert(cache.unchanged('A:1',[doc,1], 'abcd'));
  assert(!cache.unchanged('B:1',[doc,1], 'abcd'));
  assert(!cache.unchanged('A:1',[{},1], 'abcd'));
  assert(!cache.unchanged('A:1',[doc,2], 'abcd'));
  cache.unchanged('large',[doc],'x'.repeat(20));assert(cache.bytes<=8);
});

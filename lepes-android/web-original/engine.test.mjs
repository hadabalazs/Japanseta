import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTrack, phaseAt, validateDurations, SAMPLE_RATE, formatTime } from './src/engine.js';
test('unequal phases, exact boundaries, and loop reconciliation', () => {
  assert.deepEqual(phaseAt(0,180,120),{phase:'fast',remaining:180,progress:0});
  assert.equal(phaseAt(179.5,180,120).remaining,1);
  assert.deepEqual(phaseAt(180,180,120),{phase:'slow',remaining:120,progress:0});
  assert.deepEqual(phaseAt(300,180,120),{phase:'fast',remaining:180,progress:0});
  assert.equal(phaseAt(300 * 9 + 200,180,120).remaining,100);
  assert.equal(formatTime(180),'03:00');
});
test('invalid duration rejected before allocation', () => {
  for (const n of [0,9,-1,901,Infinity,NaN,10.5]) assert.throws(()=>validateDurations(n,60));
});
test('WAV has correct duration, two short cues, one long cue, and silence between', () => {
  const buffer=createTrack(180,120),v=new DataView(buffer);
  assert.equal(buffer.byteLength,44+300*SAMPLE_RATE*2);
  assert.equal(v.getUint32(24,true),SAMPLE_RATE);
  const energy=(a,b)=>{let sum=0;for(let i=Math.floor(a*SAMPLE_RATE);i<Math.floor(b*SAMPLE_RATE);i++)sum+=Math.abs(v.getInt16(44+i*2,true));return sum;};
  assert.ok(energy(.02,.2)>0);assert.ok(energy(.4,.58)>0);
  assert.equal(energy(.23,.37),0);assert.equal(energy(1,179),0);
  assert.ok(energy(180.02,180.8)>0);assert.equal(energy(181,300),0);
});
test('maximum duration remains one bounded cycle', () => {
  assert.equal(createTrack(900,900).byteLength,57600044);
  assert.equal(createTrack(0,0,true).byteLength,128044);
});

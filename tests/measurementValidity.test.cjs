const assert=require('node:assert/strict');
const fs=require('node:fs');const ts=require('typescript');
const compiled=ts.transpileModule(fs.readFileSync('src/lib/measurementValidity.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const mod={exports:{}};new Function('exports','module',compiled)(mod.exports,mod);
const {contactCandidate,pulseCandidate}=mod.exports;
const image=(fn)=>Uint8ClampedArray.from(Array.from({length:32*24},(_,i)=>[...fn(i),255]).flat());
for(const rgb of [[110,110,110],[0,0,0],[255,255,255],[40,130,30],[40,65,180]])assert.equal(contactCandidate(image(()=>rgb)),false,`Non-contact RGB ${rgb}`);
assert.equal(contactCandidate(image(i=>i%2?[190,185,180]:[70,72,74])),false,'Textured neutral floor');
assert.equal(contactCandidate(image(()=>[180,60,50])),true,'Red candidate is only a candidate, not proof of tissue');
assert.equal(pulseCandidate(Array(300).fill(200),30),false,'Uniform red object: no pulse');
assert.equal(pulseCandidate(Array.from({length:300},(_,i)=>150+i*.2),30),false,'Exposure ramp');
let seed=42;const noise=Array.from({length:600},()=>{seed=(seed*1664525+1013904223)>>>0;return 200+(seed/4294967296-.5)*10});
assert.equal(pulseCandidate(noise,30),false,'Nonperiodic camera noise');
assert.equal(pulseCandidate(Array.from({length:300},(_,i)=>200+2*Math.sin(i/30*2*Math.PI*1.2)),30),true,'Synthetic periodic signal');
assert.equal(pulseCandidate(Array(30).fill(1),30),false,'Insufficient window');
console.log('Validity checks passed: non-contact surfaces, darkness, saturation, flat red object, exposure drift, random noise, short window and synthetic pulse.');
for(const bpm of [60,75,90,120]){
 const weak=Array.from({length:300},(_,i)=>Math.round((200+.05*Math.sin(i/30*2*Math.PI*bpm/60)+i*.003)*1280)/1280);
 assert.equal(pulseCandidate(weak,30),true,`Weak spatially averaged pulse ${bpm} BPM with exposure drift`);
}
const recovery=Array.from({length:900},(_,i)=>i<660?noise[i%noise.length]:200+.05*Math.sin(i/30*2*Math.PI*1.2));
assert.equal(pulseCandidate(recovery,30),true,'Recent valid window recovers after older motion noise');
// Exercise the real valley/interval implementation against known synthetic timestamps.
const source=fs.readFileSync('src/hooks/heartlens/usePPGProcessing.ts','utf8');
const begin=source.indexOf('  const detectValleys =');const end=source.indexOf('\n  return {\n    ppgData',begin);
const detector=ts.transpileModule(source.slice(begin,end),{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
const times=Array.from({length:600},(_,i)=>Date.UTC(2026,10,25)+i*1000/30);
const functions=new Function('detrendPulse','sampleTimes','fpsRef',detector+'; return {detectValleys,calculateHeartRate,calculateHRV};')(mod.exports.detrendPulse,{current:times},{current:30});
for(const bpm of [60,75,90,120]){
 const signal=Array.from({length:600},(_,i)=>200+.05*Math.sin(i/30*2*Math.PI*bpm/60));
 const valleys=functions.detectValleys(signal);const hr=functions.calculateHeartRate(valleys);
 assert.ok(Math.abs(hr.bpm-bpm)<=3,`Expected ${bpm} BPM, got ${hr.bpm}`);
 assert.ok(Number.isFinite(functions.calculateHRV(valleys).sdnn),'Finite SDNN');
}
console.log('Weak-pulse recovery and 60/75/90/120 BPM timestamp-based detection checks passed.');

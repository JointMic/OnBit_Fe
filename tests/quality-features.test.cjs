const fs=require('node:fs'),ts=require('typescript'),assert=require('node:assert/strict');
const source=ts.transpileModule(fs.readFileSync('src/lib/ppgQualityFeatures.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const out={};new Function('exports',source)(out);
const fixtures=JSON.parse(fs.readFileSync('tests/fixtures/quality-features.json','utf8'));
for(const {name,signal,expected} of fixtures){
 const actual=out.calculateQualityFeatures(signal);assert.equal(actual.length,19);
 actual.forEach((v,i)=>{assert.ok(Number.isFinite(v),`${name} ${i}: finite`);const tolerance=1e-7*Math.max(1,Math.abs(expected[i]));assert.ok(Math.abs(v-expected[i])<=tolerance,`${name} feature ${i}: ${v} vs numpy ${expected[i]}`)});
}
assert.throws(()=>out.calculateQualityFeatures([1,NaN]));
console.log(`All 19 quality features match NumPy for ${fixtures.length} cases (100/128/257/301-point, flat/weak/noisy/negative signals).`);

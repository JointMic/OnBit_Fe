const fs=require('node:fs'),ts=require('typescript'),assert=require('node:assert/strict');
let cursor=0,cells=[],pending=[],formats=0;
const same=(a,b)=>a&&b&&a.length===b.length&&a.every((x,i)=>Object.is(x,b[i]));
const react={
 useState(initial){const i=cursor++;if(!cells[i])cells[i]={value:typeof initial==='function'?initial():initial};return [cells[i].value,v=>cells[i].value=typeof v==='function'?v(cells[i].value):v]},
 useRef(initial){const i=cursor++;return cells[i]??(cells[i]={current:initial})},
 useMemo(fn,deps){const i=cursor++;if(!cells[i]||!same(cells[i].deps,deps))cells[i]={value:fn(),deps};return cells[i].value},
 useEffect(fn,deps){const i=cursor++;if(!cells[i]||!same(cells[i].deps,deps)){const old=cells[i];cells[i]={deps};pending.push(()=>{old?.cleanup?.();cells[i].cleanup=fn()})}},
};
const NativeFormatter=Intl.DateTimeFormat;
const fakeIntl={DateTimeFormat:function(...args){const f=new NativeFormatter(...args);return {format:d=>{formats++;return f.format(d)}}}};
const compiled=ts.transpileModule(fs.readFileSync('src/hooks/useDailyArchive.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const out={};new Function('require','exports','localStorage','Intl','setTimeout','clearTimeout',compiled)(()=>react,out,{getItem:()=>null,setItem:()=>{}},fakeIntl,()=>1,()=>{});
const base=Date.parse('2026-11-26T00:00:00Z');
const row=i=>({code:'camera',valid:true,heartRate:70,sdnn:40,recording:true,quality:'excellent',updatedAt:new Date(base+i*125).toISOString()});
function render(rows){cursor=0;const value=out.useDailyArchive('camera',rows);const effects=pending;pending=[];effects.forEach(f=>f());return value}
const rows=Array.from({length:1500},(_,i)=>row(i));render(rows);render(rows);
const before=formats;render([...rows,row(1500)]);
assert.equal(formats-before,1,'An appended reading must format only its own date, not 1500 old readings');
const after=formats;render([...rows,row(1500)]);assert.equal(formats,after,'Duplicate snapshots must not reprocess old data');
assert.equal(out.dayKey('2026-11-25T15:00:00Z'),'2026-11-26','Seoul date boundary');
console.log('Archive regression checks passed: incremental processing, duplicate snapshots, Seoul day boundary');

import {useEffect,useRef,useState} from 'react'
import type {Reading} from './useLive'
export const dayKey=(date:Date|string=new Date())=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(date));
type Archive=Record<string,Reading[]>;
function demoDays(code:string):Archive {
 const result:Archive={};
 for(const [day,count,base] of [[20,10,71],[22,36,76],[23,90,68]]) {
  const key=`2026-11-${day}`;
  const start=Date.parse(`${key}T14:30:00+09:00`);
  result[key]=Array.from({length:count},(_,i)=>({code,recording:false,isMock:true,heartRate:Math.round(base+Math.sin(i*.35)*5+Math.sin(i*.83)*2),sdnn:Math.round(40+Math.sin(i*.25)*7),quality:'excellent',updatedAt:new Date(start+i*1000).toISOString()}));
 }
 return result;
}

export function useDailyArchive(code:string,series:Reading[]){const [archive,setArchive]=useState<Archive>({});const [error,setError]=useState(false);const ref=useRef<Archive>({});
useEffect(()=>{let value:Archive={};try{const parsed=JSON.parse(localStorage.getItem('onbit-days-'+code)||'{}');for(const [key,rows] of Object.entries(parsed)){if(Array.isArray(rows))value[key]=rows.filter(v=>v.code===code&&Number.isFinite(Date.parse(v.updatedAt)))}}catch{}ref.current=value;setArchive(value);setError(false)},[code]);
useEffect(()=>{if(!code||!series.length)return;let changed=false;const next={...ref.current};for(const row of series){if(row.code!==code||(row.heartRate===null&&row.sdnn===null))continue;const day=dayKey(row.updatedAt);const rows=next[day]||[];const last=rows.at(-1);if(last&&Date.parse(row.updatedAt)-Date.parse(last.updatedAt)<5000)continue;next[day]=[...rows.slice(-1499),row];changed=true}if(!changed)return;const retained=Object.fromEntries(Object.keys(next).sort().slice(-14).map(k=>[k,next[k]]));ref.current=retained;setArchive(retained);try{localStorage.setItem('onbit-days-'+code,JSON.stringify(retained));setError(false)}catch{setError(true)}},[code,series]);return {archive:{...demoDays(code),...archive},error}}

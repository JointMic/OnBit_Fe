import {useEffect,useMemo,useRef,useState} from 'react'
import type {Reading} from './useLive'
const dayFormatter=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'});
export const dayKey=(date:Date|string=new Date())=>dayFormatter.format(new Date(date));
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

export function useDailyArchive(code:string,series:Reading[]){const [archive,setArchive]=useState<Archive>({});const [error,setError]=useState(false);const ref=useRef<Archive>({});const processed=useRef('');const demo=useMemo(()=>demoDays(code),[code]);
useEffect(()=>{processed.current='';let value:Archive={};try{const parsed=JSON.parse(localStorage.getItem('onbit-days-'+code)||'{}');for(const [key,rows] of Object.entries(parsed)){if(Array.isArray(rows))value[key]=rows.filter(v=>v.code===code&&Number.isFinite(Date.parse(v.updatedAt))&&(code!=='camera'||v.valid===true))}}catch{}ref.current=value;setArchive(value);setError(false)},[code]);
useEffect(()=>{if(!code||!series.length)return;let changed=false;const fresh=series.filter(row=>row.updatedAt>processed.current);if(!fresh.length)return;processed.current=fresh[fresh.length-1].updatedAt;const next={...ref.current};for(const row of fresh){if(row.code!==code||(row.heartRate===null&&row.sdnn===null&&row.glucose==null))continue;const day=dayKey(row.updatedAt);const rows=next[day]||[];const last=rows.at(-1);const newGlucose=row.glucose!=null&&row.glucoseAt&&row.glucoseAt!==last?.glucoseAt;if(last&&!newGlucose&&Date.parse(row.updatedAt)-Date.parse(last.updatedAt)<5000)continue;next[day]=[...rows.slice(-1499),row];changed=true}if(!changed)return;const retained=Object.fromEntries(Object.keys(next).sort().slice(-14).map(k=>[k,next[k]]));ref.current=retained;setArchive(retained);},[code,series]);useEffect(()=>{if(!Object.keys(archive).length)return;const timer=setTimeout(()=>{try{localStorage.setItem('onbit-days-'+code,JSON.stringify(archive));setError(false)}catch{setError(true)}},100);return()=>clearTimeout(timer)},[archive,code]);
const merged=useMemo(()=>({...demo,...archive}),[demo,archive]);return {archive:merged,error}}

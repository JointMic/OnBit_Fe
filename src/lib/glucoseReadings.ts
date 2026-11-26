import type {Reading} from '../hooks/useLive'
export interface GlucosePoint {time:string;value:number}
/** Count each accepted estimate once, never repeated dashboard snapshots. */
export function glucosePoints(rows:Reading[],since=-Infinity):GlucosePoint[]{
 const unique=new Map<string,GlucosePoint>();
 for(const row of rows){
  const time=row.glucoseAt,stamp=Date.parse(time||'');
  if(row.glucose==null||!Number.isFinite(row.glucose)||!time||!Number.isFinite(stamp)||stamp<since)continue;
  unique.set(time,{time,value:row.glucose});
 }
 return [...unique.values()].sort((a,b)=>Date.parse(a.time)-Date.parse(b.time));
}

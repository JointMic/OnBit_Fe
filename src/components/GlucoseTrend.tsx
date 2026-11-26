import {Droplets} from 'lucide-react'
import {glucoseStatus} from '../hooks/useGlucoseInference'
import {glucosePoints,type GlucosePoint} from '../lib/glucoseReadings'
import type {Reading} from '../hooks/useLive'
const timeLabel=(time:string)=>new Date(time).toLocaleTimeString('ko-KR',{hour:'2-digit',minute:'2-digit',second:'2-digit'});
export function GlucoseHistory({series,since=-Infinity}:{series:Reading[];since?:number}){
 const points=glucosePoints(series,since).slice(-30).reverse();
 return <><div className="card-top"><span>혈당 추정 기록</span><span className="muted">mg/dL</span></div>{points.map(p=><div className="record glucose-record" key={p.time}><span>{timeLabel(p.time)}</span><strong>{p.value.toFixed(1)}</strong></div>)}{!points.length&&<p className="sub">추정 결과 대기</p>}</>;
}
export function GlucoseTrend({data,series,detail=false,since=-Infinity}:{data?:Reading|null;series:Reading[];detail?:boolean;since?:number}){
 const points=glucosePoints(series,since);
 const values=points.map(p=>p.value);
 const display=data?.glucose!=null&&Number.isFinite(data.glucose)?data.glucose:null;
 const last=points.at(-1);
 const value=display??last?.value;
 const min=values.length?Math.min(...values):0,max=values.length?Math.max(...values):0;
 const pad=Math.max(5,(max-min)*.2),bottom=min-pad,top=max+pad;
 const start=points.length?Date.parse(points[0].time):0,end=last?Date.parse(last.time):0;
 const x=(p:GlucosePoint)=>points.length===1?300:48+(Date.parse(p.time)-start)/(end-start||1)*536;
 const y=(v:number)=>180-(v-bottom)/(top-bottom)*150;
 const path=points.map((p,i)=>`${i?'L':'M'} ${x(p)} ${y(p.value)}`).join(' ');
 return <div className={`glucose-trend ${detail?'glucose-detail':''}`}>
  <div className="card-top"><span><Droplets size={16}/> 혈당 추정</span><span className="tag">실험 모델</span></div>
  <div className="metric">{value!=null?value.toFixed(1):'—'} <small>mg/dL</small></div>
  <p className="sub glucose-state">{glucoseStatus(data?.glucoseStatus)}{data?.glucoseAt&&value!=null&&<span> · 마지막 추정 {timeLabel(data.glucoseAt)}</span>}</p>
  <div className="glucose-chart"><svg viewBox="0 0 600 210" preserveAspectRatio="none" role="img" aria-label="실제 추정 시각 기준 혈당 추이">
  {[0,.5,1].map(t=>{const v=bottom+(top-bottom)*t;return <g key={t}><line x1="48" x2="584" y1={y(v)} y2={y(v)} stroke="#ffffff0c"/>{points.length>0&&<text x="0" y={y(v)+4} fill="#998675" fontSize="11">{v.toFixed(0)}</text>}</g>})}
  {points.length>1&&<path d={path} fill="none" stroke="#ff862b" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke"/>}
  {points.map(p=><circle key={p.time} cx={x(p)} cy={y(p.value)} r={points.length>80?1.5:3} fill="#ff862b"><title>{timeLabel(p.time)} · {p.value.toFixed(1)} mg/dL</title></circle>)}
  </svg>{!points.length&&<span className="glucose-chart-empty">추정 결과 대기</span>}</div>
  <div className="axis"><span>{points[0]?timeLabel(points[0].time):'—'}</span><span>{last?timeLabel(last.time):'—'}</span></div>
  {detail&&<><dl className="detail-stats">{[['최소',values.length?min:null],['평균',values.length?values.reduce((a,b)=>a+b,0)/values.length:null],['최대',values.length?max:null]].map(([label,v])=><div key={label}><dt>{label}</dt><dd>{typeof v==='number'?v.toFixed(1):'—'}</dd></div>)}</dl><details className="glucose-analysis"><summary>분석 정보</summary><dl><div><dt>파형 유사도</dt><dd>{data?.glucoseSimilarity!=null?`${(data.glucoseSimilarity*100).toFixed(1)}%`:'—'}</dd></div><div><dt>서버 처리</dt><dd>{data?.glucoseServerMs!=null?`${data.glucoseServerMs.toFixed(1)} ms`:'—'}</dd></div></dl></details><div className="detail-table"><GlucoseHistory series={series} since={since}/></div></>}
  <p className="glucose-experimental">실험 추정값 · 측정 정확도 미검증</p>
 </div>;
}

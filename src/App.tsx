import {CameraWidget} from './components/CameraWidget'
import {useCameraMeasurement} from './hooks/useCameraMeasurement'
import {DateCalendar} from './components/DateCalendar'
import {useDailyArchive,dayKey} from './hooks/useDailyArchive'
import {GlucosePanel, TrendTabs} from './components/HealthSections'
import {Profile, Avatar, loadProfile} from './components/Profile'
import {Journal, MetricGuide, SessionSummary} from './components/PageSections'
import {type Reading} from './hooks/useLive'
import { useState, useEffect, useRef } from 'react'
import { Activity, Heart, LayoutDashboard, Radio, Grip, Watch, House, ChartNoAxesCombined, UserRound, NotebookPen, X } from 'lucide-react'
import { DraggableWidgetGrid, type WidgetItem } from './components/ui/draggable-widget-grid'
const defaults: WidgetItem[] = [
 {id:'camera',size:'lg',label:'카메라 측정'},
 {id:'heart',size:'sm',label:'심박수'}, {id:'hrv',size:'sm',label:'심박 변이도'},
 {id:'glucose',size:'sm',label:'혈당 추정'}, {id:'weekly',size:'sm',label:'신호 품질'},
 {id:'connection',size:'sm',label:'기기 연결 상태'},
 {id:'records',size:'wide',label:'최근 수신'},
]
function load():WidgetItem[]{try{const x=JSON.parse(localStorage.getItem('onbit-layout')||'null');if(Array.isArray(x)&&x.length===defaults.length&&new Set(x.map(v=>v.id)).size===defaults.length&&x.every(v=>defaults.some(d=>d.id===v.id&&d.size===v.size)))return x}catch{}return defaults}
function Spark({values,purple=false}:{values:(number|null)[];purple?:boolean}){
const count=160;
const valid=values.filter((v):v is number=>v!==null);
const max=Math.max(purple?250:200,...valid);
const ys=values.map(v=>v===null?124:115-v/max*95);
// Fixed-size geometry allows smooth transitions even when new samples arrive.
const target=Array.from({length:count},(_,i)=>{
 if(!ys.length)return 124;
 const at=i/(count-1)*(ys.length-1),left=Math.floor(at),right=Math.min(ys.length-1,left+1);
 const t=at-left;
 return ys[left]+(ys[right]-ys[left])*t;
});
const targetKey=target.join(',');
const current=useRef<number[]>(target);
const [display,setDisplay]=useState<number[]>(target);
useEffect(()=>{
 const destination=targetKey.split(',').map(Number);
 if(window.matchMedia('(prefers-reduced-motion: reduce)').matches){current.current=destination;setDisplay(destination);return;}
 const from=[...current.current];const start=performance.now();let frame=0;
 const animate=(now:number)=>{const t=Math.min(1,(now-start)/240);const ease=t*t*(3-2*t);const next=destination.map((y,i)=>from[i]+(y-from[i])*ease);current.current=next;setDisplay(next);if(t<1)frame=requestAnimationFrame(animate)};
 frame=requestAnimationFrame(animate);return()=>cancelAnimationFrame(frame);
},[targetKey]);
const coordinates=display.map((y,i)=>({x:i/(count-1)*592,y}));
let path=`M 0 ${coordinates[0].y}`;
// Quadratic joins round corners without overshooting the samples.
for(let i=1;i<coordinates.length-1;i++){
 const p=coordinates[i],next=coordinates[i+1];
 path+=` Q ${p.x} ${p.y} ${(p.x+next.x)/2} ${(p.y+next.y)/2}`;
}
const last=coordinates[coordinates.length-1];path+=` L ${last.x} ${last.y}`;
return <svg className="spark" viewBox="0 0 592 130" preserveAspectRatio="none" role="img" aria-label="실측 데이터 표시 보간 그래프" ><title>실제 측정값의 표시를 부드럽게 보간한 그래프. 하단 기준선은 데이터 없음.</title>{[35,75,115].map(y=><line key={y} x1="0" x2="592" y1={y} y2={y} stroke="#ffffff0d"/>)}<path d={path} fill="none" stroke={purple?'#b6a2f6':'#c0f66b'} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke"/></svg>
}

function metricReading(data:Reading|null,series:Reading[],key:'heartRate'|'sdnn') {
 if(data?.valid===false)return {value:null,time:data.updatedAt,previous:false};
 const latest=data?.[key];
 if(latest!=null)return {value:latest,time:data!.updatedAt,previous:false};
 const previous=[...series].reverse().find(v=>v[key]!=null);
 return {value:previous?.[key]??null,time:previous?.updatedAt,previous:!!previous};
}
function ReadingNote({reading,status}:{reading:ReturnType<typeof metricReading>;status:string}){
 return <p className="sub reading-note">{reading.value==null?'유효한 맥박 검출 대기':reading.previous||status!=='측정 중'?`마지막 유효값 · ${new Date(reading.time!).toLocaleTimeString('ko-KR')}`:'현재 추정값'}</p>
}
function Content({id,data,series,status,showGraph=false}:{id:string;data:Reading|null;series:Reading[];status:string;showGraph?:boolean}){const active=status==='측정 중';const hrReading=metricReading(data,series,'heartRate');const sdnnReading=metricReading(data,series,'sdnn');const hr=hrReading.value;const sdnn=sdnnReading.value;
if(id==='glucose')return <><div className="card-top"><span>혈당 추정</span></div><div className="metric">— <small>mg/dL</small></div><p className="sub">모델 연동 대기</p><div className="glucose-baseline"/></>;
if(id==='heart'||id==='hrv'){const h=id==='heart';return <><div className="card-top"><span>{h?<Heart size={16}/>:<Activity size={16}/>} {h?'심박수':'HRV'}</span><span className="tag">{status}</span></div><div className="metric">{(h?hr:sdnn)??'—'} <small>{h?'BPM':'ms'}</small></div>{data?.valid===false?<p className="sub reading-note">{data.invalidReason}</p>:!h&&data?.hrvReason?<p className="sub reading-note">{data.hrvReason}</p>:<ReadingNote reading={h?hrReading:sdnnReading} status={status}/>}{!h&&<span className="muted">SDNN</span>}<>{showGraph&&<><Spark values={series.map(v=>h?v.heartRate:v.sdnn)} purple={!h}/><div className="axis"><span>{series[0]?new Date(series[0].updatedAt).toLocaleTimeString('ko-KR'):''}</span><span>{series.at(-1)?new Date(series.at(-1)!.updatedAt).toLocaleTimeString('ko-KR'):''}</span></div></>}</></>}
if(id==='connection')return <><div className="card-top"><span><Watch size={16}/> 측정 연결</span></div><div className="device-icon"><Radio size={32}/></div><h3>{status}</h3><p className="sub">기기 카메라</p></>
if(id==='weekly'&&showGraph)return <><div className="card-top"><span>신호 품질</span></div><div className="quality-timeline" role="img" aria-label="시간별 신호 품질">{series.map(v=><i key={v.updatedAt} title={`${new Date(v.updatedAt).toLocaleTimeString('ko-KR')} · ${v.quality||'분석 중'}`} style={{background:v.quality==='excellent'?'#c0f66b':v.quality==='acceptable'?'#e6be66':v.quality==='bad'?'#d47777':'#47513f'}}/>)}</div><div className="axis"><span>{series[0]?new Date(series[0].updatedAt).toLocaleTimeString('ko-KR'):''}</span><span>{series.at(-1)?new Date(series.at(-1)!.updatedAt).toLocaleTimeString('ko-KR'):''}</span></div></>;
if(id==='weekly')return <><div className="card-top"><span>신호 품질</span><span className="tag">실측</span></div><div className="quality-value">{active?({bad:'불량',acceptable:'보통',excellent:'좋음'}[data?.quality||'']||'분석 중'):'—'}</div><p className="sub">PPG 신호 품질</p></>
return <><div className="card-top"><span>최근 수신</span></div>{series.slice(-3).reverse().map(v=><div className="record" key={v.updatedAt}><span>{new Date(v.updatedAt).toLocaleTimeString('ko-KR')}</span><strong>{v.heartRate??'—'} BPM</strong><span>{v.sdnn??'—'} ms</span></div>)}{!series.length&&<p className="sub">수신 데이터 없음</p>}</>
}
export default function App(){const [profile,setProfile]=useState(loadProfile);const [items,setItems]=useState(load);const [tab,setTab]=useState('home');const [trendMetric,setTrendMetric]=useState('heart');const [trendRange,setTrendRange]=useState(15);const [detail,setDetail]=useState<string|null>(null);const code='camera';const camera=useCameraMeasurement();const live=camera;const {archive,error:archiveError}=useDailyArchive(code,live.series);const [selectedDay,setSelectedDay]=useState(dayKey);const historical=selectedDay!==dayKey();const series=historical?(archive[selectedDay]||[]):live.series;const data=historical?series.at(-1)||null:live.data;const status=historical?(series.length?(series[0]?.isMock?'데모 기록':'저장 기록'):'기록 없음'):live.status
function change(next:WidgetItem[]){setItems(next);try{localStorage.setItem('onbit-layout',JSON.stringify(next))}catch{}}

const tabs=[{id:'home',label:'홈',icon:House},{id:'trends',label:'추이',icon:ChartNoAxesCombined},{id:'journal',label:'생활 기록',icon:NotebookPen},{id:'device',label:'기기',icon:Watch}]
const endTime=historical&&series.length?Date.parse(series[series.length-1].updatedAt):Date.now();
const trendSeries=trendRange===0?series:series.filter(v=>endTime-Date.parse(v.updatedAt)<=trendRange*1000);
const trendValues=trendSeries.map(v=>trendMetric==='hrv'?v.sdnn:v.heartRate).filter((v):v is number=>v!==null);
const visible=items.filter(item=>tab==='home'||(tab==='trends'&&(item.id===trendMetric||item.id==='records'))||(tab==='history'&&item.id==='records')||(tab==='device'&&['camera','connection','weekly'].includes(item.id)))
return <div className="app"><video ref={camera.videoRef} autoPlay playsInline muted aria-hidden="true" tabIndex={-1} className="camera-engine"/><canvas ref={camera.canvasRef} width={320} height={240} aria-hidden="true" className="camera-engine"/><main><header className="app-header"><button className="header-avatar" aria-label="내 프로필 열기" onClick={()=>setTab('my')}><Avatar photo={profile.photo}/></button><DateCalendar selected={selectedDay} onSelect={setSelectedDay} counts={Object.fromEntries(Object.entries(archive).map(([day,rows])=>[day,rows.length]))}/><span className="demo"><span/> {status}</span></header>{archiveError&&<p className="sub">브라우저 저장 공간이 부족해 기록을 저장하지 못했어요.</p>}{tab!=='my'&&tab!=='home'&&<div className="toolbar"><h1>{tabs.find(t=>t.id===tab)?.label==='홈'?'내 건강':tabs.find(t=>t.id===tab)?.label}</h1></div>}{tab==='trends'&&<><TrendTabs metric={trendMetric} setMetric={setTrendMetric}/><div className="trend-window" aria-label="차트 시간 범위">{[{value:15,label:'실시간'},{value:30,label:'30초'},{value:60,label:'1분'},{value:300,label:'5분'},{value:0,label:'전체'}].map(r=><button key={r.value} aria-pressed={trendRange===r.value} className={trendRange===r.value?'selected':''} onClick={()=>setTrendRange(r.value)}>{r.label}</button>)}</div><div className="trend-stream-meta"><span className={status==='측정 중'?'stream-live':''}>{historical?'기록 재생':status}</span><span>{trendMetric==='weekly'?'PPG 신호 품질':trendMetric==='hrv'?'SDNN · ms':'Heart rate · BPM'}</span></div>{trendMetric!=='weekly'&&<div className="trend-statistics">{[['현재',historical?trendValues.at(-1)??'—':data?.[trendMetric==='hrv'?'sdnn':'heartRate']??'—'],['평균',trendValues.length?Math.round(trendValues.reduce((a,b)=>a+b,0)/trendValues.length):'—'],['최저',trendValues.length?Math.min(...trendValues):'—'],['최고',trendValues.length?Math.max(...trendValues):'—']].map(([label,value])=><div key={label}><span>{label}</span><strong>{value}</strong></div>)}</div>}</>}{tab==='device'&&<section className="device-banner page-section"><Radio size={24}/><div><h2>기기 카메라</h2><p>이 기기의 카메라로 직접 측정합니다.</p></div><span>{camera.recording?'LIVE':'대기'}</span></section>}{tab==='journal'?<Journal/>:tab==='my'?<><Profile profile={profile} onChange={setProfile} code={code} status={status}/><MetricGuide/></>:<div className={tab==='trends'?'board trend-board':'board'}>{tab==='trends'?<div className="trend-panels"><section className={`health-card trend-primary ${trendMetric}`}><Content id={trendMetric} data={data} series={trendSeries} status={status} showGraph/></section><section className="health-card trend-receipts"><Content id="records" data={data} series={trendSeries} status={status}/></section></div>:<DraggableWidgetGrid key={`${tab}-${trendMetric}`} items={tab==='trends'?visible.map(item=>({...item,size:'wide' as const})):visible} editable cellSize={245} maxColumns={tab==='device'||tab==='trends'?2:4} gap={16} radius={26} onChange={next=>change([...next.map(n=>({...n,size:defaults.find(d=>d.id===n.id)!.size})),...items.filter(item=>!next.some(n=>n.id===item.id))])} renderItem={item=>item.id==='camera'?<CameraWidget camera={{...camera,start:(id?:string)=>{setSelectedDay(dayKey());return camera.start(id)}}}/>:<section className={`health-card ${item.id}`} onClick={()=>{if(tab==='home'&&['heart','hrv'].includes(item.id)){setTrendMetric(item.id);setTab('trends')}else setDetail(item.id)}} role="button" tabIndex={0} aria-label={`${item.label} 상세 보기`} onKeyDown={e=>{if(!e.altKey&&(e.key==='Enter'||e.key===' ')){e.preventDefault();if(tab==='home'&&['heart','hrv'].includes(item.id)){setTrendMetric(item.id);setTab('trends')}else setDetail(item.id)}}}><Content id={item.id} data={data} series={tab==='trends'?trendSeries:series} status={status} showGraph={tab==='trends'}/><span className="grid-handle" data-drag-handle aria-label="카드 이동"><Grip size={18}/></span></section>}/>}</div>}</main><nav className="bottom-nav" aria-label="주 메뉴">{tabs.map(({id,label,icon:Icon})=><button key={id} className={tab===id?'nav-item selected':'nav-item'} aria-current={tab===id?'page':undefined} onClick={()=>setTab(id)}><span className="nav-icon"><Icon size={22} strokeWidth={tab===id?2:1.7}/></span><span>{label}</span></button>)}</nav>{detail&&<Detail id={detail} data={data} series={series} status={status} close={()=>setDetail(null)}/>}</div>}

function Detail({id,data,series,status,close}:{id:string;data:Reading|null;series:Reading[];status:string;close:()=>void}) {
const [range,setRange]=useState(120);
const dialogRef=useRef<HTMLElement>(null);
const closeRef=useRef(close);closeRef.current=close;
useEffect(()=>{const prior=document.activeElement as HTMLElement|null;const old=document.body.style.overflow;document.body.style.overflow='hidden';const key=(e:KeyboardEvent)=>{if(e.key==='Escape'){e.preventDefault();closeRef.current()}if(e.key==='Tab'){const nodes=dialogRef.current?.querySelectorAll<HTMLElement>('button, input, [tabindex="0"]');if(!nodes?.length)return;const first=nodes[0],last=nodes[nodes.length-1];if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus()}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus()}}};document.addEventListener('keydown',key);return()=>{document.body.style.overflow=old;document.removeEventListener('keydown',key);prior?.focus()}},[]);

const windowEnd=(status==='저장 기록'||status==='데모 기록')&&series.length?Date.parse(series[series.length-1].updatedAt):Date.now();
const filtered=series.filter(v=>windowEnd-Date.parse(v.updatedAt)<range*1000);
const metric=id==='hrv'?'sdnn':'heartRate';
const reading=metricReading(data,series,metric);
const vals=filtered.map(v=>v[metric]).filter((v):v is number=>v!==null);
const title={heart:'심박수',hrv:'심박 변이도',weekly:'신호 품질',records:'수신 기록',connection:'측정 연결',glucose:'혈당 추정'}[id];
return <div className="detail-backdrop" onClick={e=>{if(e.target===e.currentTarget)close()}}><section ref={dialogRef} className="detail-panel" role="dialog" aria-modal="true" aria-label={`${title} 상세`} onKeyDown={e=>{if(e.key==='Escape')close()}}><header><div><p className="detail-eyebrow">{status} · 기기 카메라</p><h2>{title}</h2></div><button autoFocus onClick={close} className="detail-close" aria-label="상세 닫기"><X size={22}/></button></header><div className="range-picker">{[30,60,120].map(n=><button key={n} className={range===n?'chosen':''} onClick={()=>setRange(n)}>{n===120?'2분':`${n}초`}</button>)}</div>{id==='glucose'?<GlucosePanel/>:['heart','hrv'].includes(id)?<><div className="detail-number">{reading.value??'—'} <small>{id==='hrv'?'ms · SDNN':'BPM'}</small></div><>{data?.valid===false?<p className="sub reading-note">{data.invalidReason}</p>:<ReadingNote reading={reading} status={status}/>}</><div className="detail-chart"><Spark values={filtered.map(v=>v[metric])} purple={id==='hrv'}/></div><div className="axis"><span>{filtered[0]?new Date(filtered[0].updatedAt).toLocaleTimeString('ko-KR'):''}</span><span>{filtered.at(-1)?new Date(filtered.at(-1)!.updatedAt).toLocaleTimeString('ko-KR'):''}</span></div><dl className="detail-stats">{[['최소',vals.length?Math.min(...vals):'—'],['평균',vals.length?Math.round(vals.reduce((a,b)=>a+b,0)/vals.length):'—'],['최대',vals.length?Math.max(...vals):'—']].map(([k,v])=><div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl><p className="sub">현재 화면에서 수신한 값 · 하단 기준선은 데이터 없음(0 아님)</p></>:id==='weekly'?<><h3 className="quality-value">{status==='측정 중'?({bad:'불량',acceptable:'보통',excellent:'좋음'}[data?.quality||'']||'분석 중'):'—'}</h3><div className="quality-timeline" role="img" aria-label="시간 순서별 신호 품질">{filtered.map(v=><i key={v.updatedAt} title={`${new Date(v.updatedAt).toLocaleTimeString()} · ${v.quality||'분석 중'}`} style={{background:v.quality==='excellent'?'#c0f66b':v.quality==='acceptable'?'#e6be66':v.quality==='bad'?'#d47777':'#47513f'}}/>)}</div><p className="sub">좋음 · 라임 / 보통 · 노랑 / 불량 · 빨강</p></>:id==='connection'?<dl className="connection-details"><div><dt>입력 장치</dt><dd>기기 카메라</dd></div><div><dt>상태</dt><dd>{status}</dd></div><div><dt>마지막 수신</dt><dd>{data?new Date(data.updatedAt).toLocaleTimeString('ko-KR'):'—'}</dd></div><div><dt>데이터 소스</dt><dd>기기 카메라 PPG</dd></div></dl>:null}{id!=='connection'&&id!=='glucose'&&<div className="detail-table"><div className="record"><span>수신 시각</span><span>심박수</span><span>SDNN</span></div>{filtered.slice(-30).reverse().map(v=><div className="record" key={v.updatedAt}><span>{new Date(v.updatedAt).toLocaleTimeString('ko-KR')}</span><span>{v.heartRate??'—'} BPM</span><span>{v.sdnn??'—'} ms</span></div>)}{!filtered.length&&<p className="sub">수신 데이터 없음</p>}</div>}</section></div>
}

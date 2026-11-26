import {useEffect,useRef} from 'react'
export type GlucoseResult={status:string;estimate?:number;similarity?:number;crest?:number;updatedAt?:string;buffer_s?:number;reason?:string;server_ms?:number}
// Independent adapter: original HeartLens processing hooks are not changed.
export function useGlucoseInference(recording:boolean){
 const result=useRef<GlucoseResult>({status:import.meta.env.DEV?'idle':'local_only'});
 const accepted=useRef<{estimate:number;updatedAt:string}|null>(null);
 const samples=useRef<number[][]>([]),scratch=useRef<HTMLCanvasElement|null>(null);
 const lastFrame=useRef(-1),epoch=useRef<number|null>(null),previous=useRef<number|undefined>();
 const busy=useRef(false),lastRequest=useRef(0),session=useRef(0),controller=useRef<AbortController|null>(null);
 useEffect(()=>{session.current++;controller.current?.abort();busy.current=false;samples.current=[];epoch.current=null;lastFrame.current=-1;previous.current=undefined;accepted.current=null;lastRequest.current=0;result.current={status:import.meta.env.DEV?(recording?'buffering':'idle'):'local_only'};return()=>{session.current++;controller.current?.abort()}},[recording]);
 function capture(video:HTMLVideoElement){
  if(!import.meta.env.DEV||!recording||video.readyState<2||video.currentTime===lastFrame.current)return;
  lastFrame.current=video.currentTime;if(epoch.current===null)epoch.current=video.currentTime;
  const time=video.currentTime-epoch.current;
  if(!scratch.current){scratch.current=document.createElement('canvas');scratch.current.width=640;scratch.current.height=480}
  const ctx=scratch.current.getContext('2d',{willReadFrequently:true});if(!ctx)return;
  ctx.drawImage(video,0,0,640,480);
  let value=0;for(const [x,y] of [[.2,.2],[.8,.2],[.5,.5],[.2,.8],[.8,.8]]){const p=ctx.getImageData(Math.floor(x*640),Math.floor(y*480),1,1).data;value+=2*p[0]-p[1]-p[2]}
  samples.current=[...samples.current.filter(s=>time-s[0]<=8),[time,value/5]];
  if(time<4||busy.current||performance.now()-lastRequest.current<500)return;
  const id=session.current;busy.current=true;lastRequest.current=performance.now();const abort=new AbortController();controller.current=abort;
  const timeout=setTimeout(()=>abort.abort(),6000);
  fetch('/api/glucose/infer',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({samples:samples.current,previous:previous.current}),signal:abort.signal})
   .then(async r=>{if(!r.ok)throw Error();return await r.json() as GlucoseResult})
   .then(r=>{if(id!==session.current)return;if(r.crest!==undefined)previous.current=r.crest;const updatedAt=new Date().toISOString();if(r.status==='inferred'&&r.estimate!==undefined)accepted.current={estimate:r.estimate,updatedAt};result.current={...result.current,...r,updatedAt}})
   .catch(()=>{if(id===session.current)result.current={status:'unavailable'}})
   .finally(()=>{clearTimeout(timeout);if(id===session.current)busy.current=false});
 }
 return {capture,result,accepted};
}
export function glucoseStatus(status?:string){return ({idle:'측정 대기',buffering:'신호 수집 중',waiting:'피크 검출 대기',gap:'신호 끊김',rejected:'파형 검사 미통과',inferred:'실험 모델 추정',unavailable:'로컬 모델 연결 안 됨',local_only:'로컬 데모에서 사용'} as Record<string,string>)[status||'']||'측정 대기'}

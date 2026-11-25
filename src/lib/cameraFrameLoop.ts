export interface FrameInfo {id:number;mediaTime:number}
/** Sample decoded frames; fall back if native callbacks stall on hidden video. */
export function startCameraFrameLoop(video:HTMLVideoElement,onFrame:(now:number,frame:FrameInfo)=>void):()=>void{
 let stopped=false,nativeHandle=0,rafHandle=0,previous=-1,lastNative=performance.now();
 let native=typeof video.requestVideoFrameCallback==='function';
 const nativeTick:VideoFrameRequestCallback=(now,metadata)=>{
  if(stopped||!native)return;
  lastNative=performance.now();
  onFrame(now,{id:metadata.presentedFrames,mediaTime:metadata.mediaTime});
  nativeHandle=video.requestVideoFrameCallback(nativeTick);
 };
 if(native)nativeHandle=video.requestVideoFrameCallback(nativeTick);
 const tick=(now:number)=>{
  if(stopped)return;
  if(native&&performance.now()-lastNative>1000){native=false;video.cancelVideoFrameCallback?.(nativeHandle)}
  if(!native){
   const counter=video.getVideoPlaybackQuality?.().totalVideoFrames;
   const id=counter&&counter>0?counter:video.currentTime;
   if(video.readyState>=2&&id!==previous){previous=id;onFrame(now,{id,mediaTime:video.currentTime})}
  }
  rafHandle=requestAnimationFrame(tick);
 };
 rafHandle=requestAnimationFrame(tick);
 return()=>{stopped=true;video.cancelVideoFrameCallback?.(nativeHandle);cancelAnimationFrame(rafHandle)};
}
/** Effective sampled FPS; never substitute requested camera FPS. */
export function sampledFrameRate(times:number[]):number{
 if(times.length<3)return 0;const span=times[times.length-1]-times[0];return span>0?(times.length-1)*1000/span:0;
}

import {useEffect,useRef,useState} from 'react'
// Backpressure: one inference in flight; never queue camera frames on the main thread.
export default function useBackgroundSignalQuality(ppgData:number[],recording:boolean){
 const worker=useRef<Worker|null>(null),busy=useRef(false),ready=useRef(false);
 const [quality,setQuality]=useState({signalQuality:'--',qualityConfidence:0});
 useEffect(()=>{
  if(!recording)return;
  const w=new Worker(new URL('../workers/quality.worker.ts',import.meta.url),{type:'module'});
  worker.current=w;ready.current=false;busy.current=false;setQuality({signalQuality:'--',qualityConfidence:0});
  w.onmessage=event=>{if(event.data.type==='ready')ready.current=true;
   if(event.data.type==='result'){busy.current=false;setQuality({signalQuality:event.data.signalQuality,qualityConfidence:event.data.qualityConfidence})}
   if(event.data.type==='error'){busy.current=false;console.error('Background PPG quality:',event.data.message)}
  };
  w.onerror=()=>{busy.current=false;ready.current=false};
  w.postMessage({type:'init'});
  return()=>{w.terminate();worker.current=null;ready.current=false;busy.current=false};
 },[recording]);
 useEffect(()=>{if(!recording||!ready.current||busy.current||ppgData.length<100)return;busy.current=true;worker.current?.postMessage({type:'assess',signal:ppgData})},[ppgData,recording]);
 return quality;
}

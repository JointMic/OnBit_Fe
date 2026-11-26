import type {MutableRefObject,RefObject} from 'react'
import usePPGProcessing from '../hooks/heartlens/usePPGProcessing'
import useSignalQuality from '../hooks/useBackgroundSignalQuality'
export interface ProcessingSnapshot {
 processor:ReturnType<typeof usePPGProcessing>;
 quality:ReturnType<typeof useSignalQuality>;
}
// Keep original per-frame React processing state below the app/dashboard tree.
export function HeartLensEngine({videoRef,canvasRef,snapshot}:{videoRef:RefObject<HTMLVideoElement>;canvasRef:RefObject<HTMLCanvasElement>;snapshot:MutableRefObject<ProcessingSnapshot|null>}){
 const processor=usePPGProcessing(true,'default',videoRef,canvasRef);
 const quality=useSignalQuality(processor.ppgData,true);
 snapshot.current={processor,quality};
 return null;
}

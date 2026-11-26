"""Deployment adapter: identical PPG preprocessing and accepted-window flow; ONNX runtime."""
import json
import threading
import time
from pathlib import Path
import numpy as np
import onnxruntime as ort
from . import preprocessing as p
ROOT=Path(__file__).resolve().parent

class Engine:
    def __init__(self):
        self.settings=json.loads((ROOT/'assets/protocol.json').read_text())['domains']['physiocgm']
        self.template=np.asarray(self.settings['template'],dtype='f4')
        if self.template.shape!=(100,) or not np.isfinite(self.template).all():raise ValueError('Invalid template')
        options=ort.SessionOptions();options.intra_op_num_threads=1;options.inter_op_num_threads=1
        self.model=ort.InferenceSession(str(ROOT/'assets/model.onnx'),sess_options=options,providers=['CPUExecutionProvider'])
        self.lock=threading.Lock()

    def infer(self,packet):
            samples=np.asarray(packet['samples'],dtype='f8')
            if samples.ndim!=2 or samples.shape[1]!=2 or not 0<len(samples)<=2000 or not np.isfinite(samples).all():
                raise ValueError('Expected finite [seconds, PPG] samples')
            times,values=samples.T
            if times[0]<0 or np.any(np.diff(times)<=0):
                raise ValueError('Timestamps must strictly increase')
            previous=packet.get('previous')
            if previous is not None and not np.isfinite(float(previous)):
                raise ValueError('Invalid previous crest')
            # Camera adapter only: real media timestamps -> uniform 64 Hz expected by supplied demo.
            start=max(float(times[0]),float(times[-1])-8)
            keep=times>=start
            times,values=times[keep],values[keep]
            if len(times)<2 or times[-1]-times[0]<4:
                return {'status':'buffering'}
            # Do not keep rejecting an old gap for the full eight-second context.
            # Restart the model buffer at the most recent discontinuity.
            gaps=np.flatnonzero(np.diff(times)>.25)
            if len(gaps):
                times,values=times[gaps[-1]+1:],values[gaps[-1]+1:]
                if len(times)<2 or times[-1]-times[0]<4:
                    return {'status':'buffering','reason':'gap_recovery','buffer_s':float(times[-1]-times[0])}
    
            grid=times[0]+np.arange(int(np.floor((times[-1]-times[0])*64))+1)/64
            volts=np.interp(grid,times,values)
            cleaned=p.clean(volts,64)
            candidates=p.detect(cleaned,'physiocgm',self.settings['fraction'],self.settings['spacing_s'])
            waves,centers,_,_,_=p.window_data(cleaned,candidates,'physiocgm',int(round(grid[0]*p.NS)))
            c=centers/p.NS
            threshold=float(previous)+.25 if previous is not None else -1.
            eligible=np.flatnonzero((c>threshold)&(c+1.25<=grid[-1]))
            if not len(eligible):
                return {'status':'waiting'}
            index=int(eligible[-1]);wave=waves[index:index+1]
            similarity=float(p.morphology(wave,self.template)[0])
            result={'crest':float(c[index]),'start':float(c[index]-.5),'end':float(c[index]+.49),
                    'similarity':similarity,'status':'rejected','input_fps':float(1/np.median(np.diff(times)))}
            if similarity<self.settings['cosine_cutoff']:
                return result
            with self.lock:
                start=time.perf_counter()
                estimate=float(self.model.run(None,{'ppg':wave[:,None,:].astype('f4')})[0].reshape(-1)[0])
            if not np.isfinite(estimate):
                raise ValueError('Nonfinite model output')
            return {**result,'status':'inferred','estimate':float(estimate),'model_ms':(time.perf_counter()-start)*1000}

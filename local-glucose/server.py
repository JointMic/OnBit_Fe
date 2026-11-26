"""Local camera adapter for the supplied PhysioCGM demo. No replay database required."""
import argparse
import json
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import numpy as np
import torch
import preprocessing as p
from model import ResNet34

ROOT=Path(__file__).resolve().parent

class Engine:
    def __init__(self):
        protocol=json.loads((ROOT/'assets/protocol.json').read_text())
        self.settings=protocol['domains']['physiocgm']
        self.template=np.asarray(self.settings['template'],dtype='f4')
        if self.template.shape!=(100,) or not np.isfinite(self.template).all():
            raise ValueError('Invalid template')
        checkpoint=torch.load(ROOT/'assets/best.pt',map_location='cpu',weights_only=True)
        self.model=ResNet34(123.)
        self.model.load_state_dict(checkpoint['model'],strict=True)
        self.model.eval()
        self.epoch=checkpoint['epoch']
        self.lock=threading.Lock()
        torch.set_num_threads(1)

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
        if np.diff(times).max()>.25:
            return {'status':'gap'}
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
        with self.lock,torch.inference_mode():
            start=time.perf_counter()
            estimate=self.model(torch.from_numpy(wave[:,None,:])).item()
        if not np.isfinite(estimate):
            raise ValueError('Nonfinite model output')
        return {**result,'status':'inferred','estimate':float(estimate),'model_ms':(time.perf_counter()-start)*1000}

class Handler(BaseHTTPRequestHandler):
    def reply(self,body,code=200):
        data=json.dumps(body,allow_nan=False).encode()
        self.send_response(code);self.send_header('Content-Type','application/json');self.send_header('Content-Length',str(len(data)));self.end_headers();self.wfile.write(data)
    def do_GET(self):
        if self.path!='/api/glucose/health':return self.reply({'error':'Not found'},404)
        self.reply({'status':'ready','epoch':self.server.engine.epoch,'cutoff':self.server.engine.settings['cosine_cutoff'],'input':'camera-adapter','experimental':True})
    def do_POST(self):
        if self.path!='/api/glucose/infer':return self.reply({'error':'Not found'},404)
        try:
            length=int(self.headers.get('Content-Length',0))
            if not 0<length<=150000:raise ValueError('Invalid request size')
            packet=json.loads(self.rfile.read(length))
            result=self.server.engine.infer(packet)
            self.reply(result)
        except (ValueError,TypeError,KeyError,OverflowError) as e:self.reply({'error':str(e)},400)
    def log_message(self,*args):pass

def main():
    parser=argparse.ArgumentParser();parser.add_argument('--port',type=int,default=8073);args=parser.parse_args()
    server=ThreadingHTTPServer(('127.0.0.1',args.port),Handler);server.engine=Engine()
    print(f'Local glucose model ready at http://127.0.0.1:{args.port}',flush=True);server.serve_forever()
if __name__=='__main__':main()

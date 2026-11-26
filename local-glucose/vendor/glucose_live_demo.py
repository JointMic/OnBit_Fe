"""Serve recorded raw wrist PPG with live, buffered Arm B model inference."""

import argparse
from contextlib import closing
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import time

import numpy as np
import torch

import step1_prepare as p
from glucose_stream_demo import EXPERIMENT, SUBJECT, EVENT_IDS
from step1_smoke import ResNet34
from step1_train import checked_load

CONTEXT = 8
CREST_DELAY = 1.25
MIN_SAMPLES = 4 * 64
MAX_REQUEST = 70_000


class Demo:
    def __init__(self):
        arm = EXPERIMENT/"B"
        record = p.read(arm/"training_complete.json")
        best = record["best"]
        checkpoint = checked_load(arm/best["path"], best["sha256"])
        if checkpoint["epoch"] != best["epoch"]:
            raise ValueError("Checkpoint epoch differs from the training record")
        torch.set_num_threads(1)
        self.model = ResNet34(123.)
        self.model.load_state_dict(checkpoint["model"])
        self.model.eval()
        self.epoch = best["epoch"]
        self.settings = p.read(p.OUT/"protocol.json")["domains"]["physiocgm"]
        self.template = np.asarray(self.settings["template"], dtype="f4")
        self.page = (p.ROOT/"glucose_live_demo.html").read_bytes()
        self.clip_index = self.load_clips()

    def load_clips(self):
        target = p.EXP/"PhysioCGM_ppg"/SUBJECT/"ppg_cgm.sqlite"
        with closing(p.connect_read(target)) as raw:
            clips = []
            for event_id in EVENT_IDS:
                name = f"{event_id-1}.pkl"
                row = raw.execute(
                    """SELECT cgm_time_ns,glucose_mg_dl,ppg_time_deltas_zlib,ppg_f64_zlib
                       FROM clips WHERE member=?""",(name,)
                ).fetchone()
                if row is None:
                    raise ValueError(f"Replay source is missing {name}")
                stamp,_,dt,bvp = row
                times = p.unpack(dt,"<i8").cumsum()
                samples = p.unpack(bvp,"<f8")
                start = int(times[0])
                relative = (times-start)/p.NS
                cgm_time = (stamp-start)/p.NS
                last_before = raw.execute(
                    """SELECT max(cgm_time_ns) FROM clips
                       WHERE cgm_time_ns < ? AND glucose_mg_dl > 0""",(start,)
                ).fetchone()[0]
                readings = raw.execute(
                    """SELECT DISTINCT cgm_time_ns,glucose_mg_dl FROM clips
                       WHERE cgm_time_ns BETWEEN ? AND ? AND glucose_mg_dl > 0
                       ORDER BY cgm_time_ns""",(last_before if last_before is not None else start,stamp)
                ).fetchall()
                clips.append({"source":name,"subject":SUBJECT,"duration":max(cgm_time,float(relative[-1])),
                    "readings":[{"time":(t-start)/p.NS,"value":v,"utc_ms":t//1_000_000} for t,v in readings],
                    "samples":[[float(t),float(v) if np.isfinite(v) else None] for t,v in zip(relative,samples)]})
        return {"clips":clips,"epoch":self.epoch,"cutoff":self.settings["cosine_cutoff"],
                "context_s":CONTEXT,"crest_delay_s":CREST_DELAY}

    def infer(self, packet):
        clock = float(packet["clock"])
        previous = packet.get("previous")
        threshold = float(previous)+.25 if previous is not None else -1.
        samples = np.asarray(packet["samples"],dtype="f8")
        if (not np.isfinite(clock) or not np.isfinite(threshold) or samples.ndim!=2 or
                samples.shape[1]!=2 or len(samples)>CONTEXT*64+4 or len(samples)==0):
            raise ValueError("Expected recent timestamp and PPG sample pairs")
        times = samples[:,0]
        volts = samples[:,1]
        if not np.isfinite(times).all() or times[0]<0 or np.any(np.diff(times)<=0) or times[-1]>clock+1e-8:
            raise ValueError("Sample times must be ordered and precede the playhead")
        if not np.isfinite(volts[-1]) or clock-times[-1]>.06:
            return {"status":"gap"}
        grid = np.rint(times*p.NS).astype("i8")
        runs = p.finite_runs(volts,grid)
        a,b = runs[-1]
        if b-a<MIN_SAMPLES:
            return {"status":"buffering"}
        cleaned = p.clean(volts[a:b],64)
        candidates = p.detect(cleaned,"physiocgm",self.settings["fraction"],self.settings["spacing_s"])
        waves,centers,_,_,_ = p.window_data(cleaned,candidates,"physiocgm",int(grid[a]))
        c = centers/p.NS
        eligible = np.flatnonzero((c>threshold)&(c+CREST_DELAY<=times[-1]))
        if not len(eligible):
            return {"status":"waiting"}
        index = int(eligible[-1])
        wave = waves[index:index+1]
        similarity = float(p.morphology(wave,self.template)[0])
        result = {"crest":float(c[index]),"start":float(c[index]-.50),"end":float(c[index]+.49),
                  "similarity":similarity,"status":"rejected"}
        if similarity<self.settings["cosine_cutoff"]:
            return result
        x = torch.from_numpy(wave[:,None,:])
        start = time.perf_counter()
        with torch.inference_mode():
            estimate = self.model(x).item()
        runtime = (time.perf_counter()-start)*1000
        if not np.isfinite(estimate):
            raise ValueError("Model produced a nonfinite estimate")
        return {**result,"status":"inferred","estimate":estimate,"model_ms":runtime}


class Handler(BaseHTTPRequestHandler):
    def respond(self, code, data, type_):
        self.send_response(code)
        self.send_header("Content-Type",type_)
        self.send_header("Content-Length",str(len(data)))
        self.send_header("Cache-Control","no-store")
        self.send_header("X-Content-Type-Options","nosniff")
        self.end_headers()
        self.wfile.write(data)

    def json(self, result, code=200):
        self.respond(code,json.dumps(result,allow_nan=False,separators=(",",":")).encode(),
                     "application/json; charset=utf-8")

    def do_GET(self):
        if self.path=="/":
            self.respond(200,self.server.demo.page,"text/html; charset=utf-8")
        elif self.path=="/api/clips":
            self.json(self.server.demo.clip_index)
        else:
            self.send_error(404)

    def do_POST(self):
        if self.path!="/api/infer":
            self.send_error(404)
            return
        origin = self.headers.get("Origin")
        if origin and origin!=f"http://{self.headers.get('Host')}":
            self.send_error(403)
            return
        try:
            length = int(self.headers.get("Content-Length","0"))
            if not 0<length<=MAX_REQUEST:
                raise ValueError("Invalid replay packet length")
            start = time.perf_counter()
            packet = json.loads(self.rfile.read(length))
            result = self.server.demo.infer(packet)
            result["server_ms"] = (time.perf_counter()-start)*1000
        except (ValueError,TypeError,KeyError,OverflowError) as exc:
            self.json({"error":str(exc)},400)
            return
        self.json(result)

    def log_message(self, format, *args):
        if len(args)>1 and str(args[1]) in ("200","304"):
            return
        super().log_message(format,*args)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port",type=int,default=8073)
    args = parser.parse_args()
    with ThreadingHTTPServer(("127.0.0.1",args.port),Handler) as http:
        http.demo = Demo()
        print(f"Live Arm B replay ready at http://127.0.0.1:{args.port}/",flush=True)
        http.serve_forever()


if __name__ == "__main__":
    main()

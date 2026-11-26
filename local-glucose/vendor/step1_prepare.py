"""Freeze and apply matched offline one-second PPG preparation without touching the reproduction baseline."""

import argparse
import hashlib
import json
import sqlite3
import tempfile
import time
import zlib
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
from functools import lru_cache
from pathlib import Path

import numpy as np
from scipy.signal import butter, find_peaks, resample_poly, sosfiltfilt

from vitaldb_acquisition import distribution, write_json
from vitaldb_pilot import API, download, ppgtimes, resample, runs, sha256

ROOT = Path(__file__).resolve().parent
EXP = ROOT / "Glucose_experiment"
OUT = EXP / "Step1_matched"
NS = 1_000_000_000
SAMPLE_NS = NS // 100
RATE = {"vitaldb": 100, "physiocgm": 64}
WINDOW = np.arange(-50, 50)
STALE = 0x40000000


def read(path):
    return json.loads(path.read_text())


def require_local(path):
    if path.stat().st_flags & STALE:
        raise RuntimeError(f"macOS has offloaded {path}. Restore it locally before reading.")
    return path


def pack(x, dtype):
    return zlib.compress(np.asarray(x, dtype=dtype).tobytes(), 3)


def unpack(blob, dtype):
    return np.frombuffer(zlib.decompress(blob), dtype=dtype)


def connect_read(path):
    require_local(path)
    return sqlite3.connect(path.resolve().as_uri() + "?mode=ro", uri=True)


@lru_cache
def bands(fs):
    return [butter(order, (.5, 8), btype="bandpass", fs=fs, output="sos") for order in (3, 2)]


def clean(x, fs):
    for band in bands(fs):
        x = sosfiltfilt(band, x)
    return x


def local_range(x, fs):
    # One robust scale per two-second block, using the preceding block when available.
    width = 2 * fs
    full=(len(x)//width)*width
    blocks=x[:full].reshape(-1,width) if full else x[None,:]
    low,high=np.quantile(blocks,[.1,.9],axis=1)
    ranges=high-low
    scale = np.repeat(np.r_[ranges[0],ranges],width)[:len(x)]
    return np.maximum(scale, np.finfo(float).eps)


def detect(x, domain, fraction, spacing, scale=None):
    fs = RATE[domain]
    if scale is None:
        scale = local_range(x, fs)
    distance = int(np.ceil(spacing*fs))
    if domain == "vitaldb":
        return find_peaks(x, prominence=fraction*scale, distance=distance)[0]

    # Find a strong short rise, then the first well-developed systolic crest
    # that follows. Shoulder-only rises are excluded by the local rise threshold.
    delay = round(.08*fs)
    rise = np.r_[np.zeros(delay), x[delay:]-x[:-delay]]
    anchors = find_peaks(rise, height=fraction*scale, distance=distance)[0]
    local = find_peaks(x)[0]
    out = []
    starts = np.searchsorted(local,anchors)
    ends = np.searchsorted(local,anchors+round(.23*fs),side="right")
    for anchor,start,end in zip(anchors,starts,ends):
        peaks = local[start:end]
        if peaks.size:
            amplitude = x[peaks] - x[max(0, anchor-delay)]
            if amplitude.max() <= 0:
                continue
            crest = peaks[np.flatnonzero(amplitude>=.85*amplitude.max())[0]]
            if not out or crest-out[-1]>=distance:
                out.append(crest)
    return np.asarray(out, dtype=int)


def window_data(cleaned, peaks, domain, start_ns):
    fs = RATE[domain]
    if fs == 64:
        # Truncate the interpolation grid at the last observed source sample.
        converted = resample_poly(cleaned, 25, 16, padtype="edge")
        converted = converted[:(len(cleaned)-1)*100//64+1]
    else:
        converted = cleaned
    mapped = np.rint(peaks*100/fs).astype(int)
    valid = (mapped >= 50) & (mapped+50 <= len(converted))
    mapped = mapped[valid]
    waves = converted[mapped[:, None]+WINDOW].astype("<f4")
    lowest = waves.min(axis=1)
    spread = np.ptp(waves, axis=1)
    nonflat = spread > 0
    waves = waves[nonflat]
    lows, ranges = lowest[nonflat], spread[nonflat]
    mapped, native = mapped[nonflat], peaks[valid][nonflat]
    normalized = 2*((waves-lows[:,None])/ranges[:,None])-1
    return (normalized, start_ns+mapped*SAMPLE_NS, start_ns+native*(NS//fs), lows, ranges)


def finite_runs(x, times=None):
    if times is None:
        return runs(np.isfinite(x))
    usable = np.isfinite(x) & (times!=np.iinfo("i8").min)
    edges = (np.diff(times)==NS//64) & usable[:-1] & usable[1:]
    ends = np.r_[0,np.flatnonzero(~edges)+1,len(x)]
    return [(a,b) for a,b in zip(ends[:-1],ends[1:]) if a<b and usable[a]]


def morphology(windows, template):
    centered = windows - windows.mean(axis=1, keepdims=True)
    norms = np.sqrt((centered**2).sum(axis=1))*np.linalg.norm(template)
    return np.divide((centered*template).sum(axis=1),norms,out=np.full(len(windows),-1,dtype="f4"),where=norms>0)


def prepare_event(event, domain, settings, template):
    source,tstamp,glucose,x,start,times=event
    waveforms, grids, rawpeaks, minima, amplitudes = [],[],[],[],[]
    detections = 0
    if x is None:
        return source,tstamp,glucose,"outside_recording",0,0,0,None,None,None,None,None,None
    for a,b in finite_runs(x,times):
        if b-a < RATE[domain]:
            continue
        first = int(times[a]) if times is not None else start + int(a)*SAMPLE_NS
        y = clean(x[a:b],RATE[domain])
        peaks = detect(y,domain,settings["fraction"],settings["spacing_s"])
        detections += len(peaks)
        w,g,p,l,h = window_data(y,peaks,domain,first)
        waveforms.append(w)
        grids.append(g)
        rawpeaks.append(p)
        minima.append(l)
        amplitudes.append(h)
    if not waveforms:
        return source,tstamp,glucose,"no_complete_coverage",detections,0,0,None,None,None,None,None,None
    w,g,p,l,h=(np.concatenate(v) for v in (waveforms,grids,rawpeaks,minima,amplitudes))
    scores=morphology(w,template)
    good=scores>=settings["cosine_cutoff"]
    # Every complete candidate is retained even if it does not pass morphology.
    if w.shape != (len(g),100) or (len(w) and (
        not np.isfinite(w).all() or np.any(abs(g-p)>SAMPLE_NS//2) or
        not np.allclose(w.min(axis=1),-1) or not np.allclose(w.max(axis=1),1)
    )):
        raise ValueError(f"Invalid one-second arrays or timestamps for {source}")
    return (source,tstamp,glucose,"covered",detections,len(w),int(good.sum()),
            pack(w,"<f4"),pack(g,"<i8"),pack(p,"<i8"),pack(scores,"<f4"),pack(l,"<f4"),pack(h,"<f4"))


def physio_events(path):
    with connect_read(path) as db:
        query = """SELECT member,cgm_time_ns,glucose_mg_dl,ppg_time_deltas_zlib,ppg_f64_zlib
                   FROM clips ORDER BY cgm_time_ns,member"""
        for member,tstamp,glucose,tbytes,pbytes in db.execute(query):
            if tstamp is None or glucose is None or not np.isfinite(glucose) or glucose<=0:
                continue
            yield member,tstamp,glucose,unpack(pbytes,"<f8"),None,unpack(tbytes,"<i8").cumsum()


def vital_events(track,row):
    raw,origin,_,_=ppgtimes(track)
    x=resample(raw)
    # The approved alternative uses the same case-relative crop as the paper.
    start_origin=round(origin*NS)
    for i,lab in enumerate(row["labs"]):
        stamp=round(lab["dt"]*NS)
        left=stamp-480*NS
        first=(left-start_origin+SAMPLE_NS-1)//SAMPLE_NS
        stop=first+96000
        values=x[first:stop] if left>=start_origin and stamp+480*NS<=start_origin+(len(raw)*NS//500) and stop<=len(x) else None
        yield f"{row['case_id']}:{i+1}",stamp,lab["result"],values,start_origin+first*SAMPLE_NS,None


CREATE = """CREATE TABLE events (
    id INTEGER PRIMARY KEY, source_id TEXT UNIQUE NOT NULL, glucose_ns INTEGER NOT NULL,
    glucose_mg_dl REAL NOT NULL, status TEXT NOT NULL, peaks INTEGER NOT NULL,
    candidates INTEGER NOT NULL, accepted INTEGER NOT NULL, waves BLOB, grid_peaks BLOB,
    native_peaks BLOB, cosine BLOB, minimum BLOB, amplitude BLOB)"""


def export_database(path, events, domain, settings, template, metadata, workers=1):
    stats=Counter()
    indexed=[]
    retained=[]
    event_index=[]
    with sqlite3.connect(path) as db, ThreadPoolExecutor(max_workers=workers) as pool:
        db.execute(CREATE)
        db.execute("CREATE TABLE provenance(key TEXT PRIMARY KEY,value TEXT NOT NULL)")
        db.executemany("INSERT INTO provenance VALUES (?,?)",((k,json.dumps(v)) for k,v in metadata.items()))
        def batches():
            batch=[]
            for event in events:
                batch.append(event)
                if len(batch)==16:
                    yield batch
                    batch=[]
            if batch:
                yield batch
        for batch in batches():
            rows=list(pool.map(lambda e:prepare_event(e,domain,settings,template),batch))
            db.executemany("INSERT INTO events VALUES(NULL,?,?,?,?,?,?,?,?,?,?,?,?,?)",rows)
            for row in rows:
                source,tstamp,glucose,status,peaks,candidates,accepted,*_=row
                indexed.append(glucose)
                event_index.append([len(indexed),source,tstamp,glucose,status,candidates,accepted])
                stats["detected_peaks"]+=peaks
                stats["candidate_windows"]+=candidates
                stats["accepted_windows"]+=accepted
                stats[status]+=1
                if accepted:
                    retained.append(glucose)
            db.commit()
        if db.execute("PRAGMA integrity_check").fetchone()[0]!="ok":
            raise RuntimeError(f"SQLite verification failed for {path}")
        check=db.execute("SELECT count(*),coalesce(sum(candidates),0),coalesce(sum(accepted),0) FROM events").fetchone()
        if check!=(len(indexed),stats["candidate_windows"],stats["accepted_windows"]):
            raise RuntimeError("Export event/window totals do not match.")
    return {**metadata,"counts":dict(stats),"events":distribution(indexed),
            "events_with_accepted_windows":distribution(retained),"bytes":path.stat().st_size,
            "windows_sha256":sha256(path),"event_index":event_index}


def matched_cases():
    # The acquisition step made a verified metadata snapshot before waveform
    # retrieval. A local duplicate of that snapshot is usable during offload.
    snapshot=EXP/"eligible_cases.json"
    if snapshot.stat().st_flags & STALE:
        duplicate=Path("/tmp/medilux-vitaldb-batch/verify/eligible_cases.json")
        if duplicate.is_file() and duplicate.stat().st_size==snapshot.stat().st_size:
            snapshot=duplicate
    records=read(require_local(snapshot))
    frozen=read(require_local(EXP/"experiment_split.json"))["vitaldb"]
    by_case={record["case_id"]:record for record in records}
    by_subject={}
    for record in sorted(records,key=lambda r:(-r["centered_event_count"],r["case_id"])):
        if record["centered_event_count"]:
            by_subject.setdefault(record["subject_id"],record)
    def train(records):
        for row in records:
            record=by_case[row["case_id"]]
            assert row["subject_id"]==record["subject_id"]
            yield {**record,"split":"training"}
    ordered=list(train(frozen["training_case_order"][:100]))
    for role in ("validation","test"):
        ordered.extend({**by_subject[pid],"split":role} for pid in sorted(frozen[f"{role}_subject_ids"]))
    ordered.extend(train(frozen["training_case_order"][100:850]))
    assert len(ordered)==len({row["subject_id"] for row in ordered})==1000
    original=EXP/"VitalDB_step1/acquisition_order.json"
    if not original.stat().st_flags & STALE:
        assert read(original)==[{k:r[k] for k in ("case_id","subject_id","split")} for r in ordered]
    return ordered


def participants(domain):
    if domain=="vitaldb":
        return [{"id":f"case-{r['case_id']}","subject_id":r["subject_id"],"split":r["split"],"case":r} for r in matched_cases()]
    frozen=read(EXP/"experiment_split.json")["physiocgm"]
    result=[{"id":pid,"subject_id":pid,"split":split} for split in ("training","validation","test")
            for pid in frozen[f"{split}_subject_ids"]]
    if len({e["id"] for e in result})!=10:
        raise ValueError("PhysioCGM split is not unique.")
    return sorted(result,key=lambda r:r["id"])


def protocol_digest():
    return sha256(require_local(OUT/"protocol.json"))


def run_domain(domain):
    protocol=read(require_local(OUT/"protocol.json"))
    digest=protocol_digest()
    if protocol["prepare_sha256"]!=sha256(Path(__file__)):
        raise ValueError("Preprocessing code does not match the frozen protocol.")
    rows=participants(domain)
    settings=protocol["domains"][domain]
    assert set(settings["calibration_participants"]+settings["qa_participants"]) <= {
        row["subject_id"] for row in rows if row["split"]=="training"}
    template=np.asarray(settings["template"],dtype="f4")
    output=OUT/domain
    output.mkdir(exist_ok=True)
    for i,row in enumerate(rows,1):
        final=output/row["id"]
        if final.exists():
            current=read(require_local(final/"summary.json"))
            if current["protocol_sha256"]!=digest or current["split"]!=row["split"] or current["subject_id"]!=row["subject_id"]:
                raise ValueError(f"Incompatible completed output at {final}")
            continue
        started=time.monotonic()
        info={"domain":domain, **{k:v for k,v in row.items() if k!="case"}, "protocol_sha256":digest}
        with tempfile.TemporaryDirectory(prefix=f".{row['id']}-",dir=output) as tmp:
            folder=Path(tmp)
            result=folder/"result"
            result.mkdir()
            if domain=="vitaldb":
                raw=folder/"track.gz"
                info["source"]=API+row["case"]["track_id"]
                download(info["source"],raw)
                info["source_sha256"]=sha256(raw)
                info["download_bytes"]=raw.stat().st_size
                events=vital_events(raw,row["case"])
            else:
                source=EXP/"PhysioCGM_ppg"/row["id"]/"ppg_cgm.sqlite"
                with connect_read(source) as db:
                    info["source"]=dict((name,json.loads(value)) for name,value in db.execute("SELECT key,value FROM provenance"))
                events=physio_events(source)
            summary=export_database(result/"windows.sqlite",events,domain,settings,template,info,
                                    workers=4 if domain=="physiocgm" else 1)
            summary["elapsed_seconds"]=time.monotonic()-started
            write_json(result/"summary.json",summary)
            result.rename(final)
        print(f"{domain} {i}/{len(rows)} {row['id']}: {summary['counts'].get('accepted_windows',0)} accepted",flush=True)


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("domain",choices=RATE)
    args=parser.parse_args()
    run_domain(args.domain)


if __name__=="__main__":
    main()

# Functions copied verbatim from shared step1_prepare.py; imports/constants isolated for inference.
from functools import lru_cache
import numpy as np
from scipy.signal import butter, find_peaks, resample_poly, sosfiltfilt
NS=1_000_000_000
SAMPLE_NS=NS//100
RATE={"vitaldb":100,"physiocgm":64}
WINDOW=np.arange(-50,50)
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

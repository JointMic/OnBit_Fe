"""NumPy reference matching the shared Colab extract_ppg_features formulas."""
import json
from pathlib import Path
import numpy as np

def features(signal):
    signal=np.asarray(signal,dtype=float)
    if len(signal)==0:return np.zeros(19).tolist()
    mean=np.mean(signal);std=np.std(signal);variance=np.var(signal)
    rms=np.sqrt(np.mean(np.square(signal)));lo=np.min(signal);hi=np.max(signal)
    diff=signal-mean;q1,q2,q3=np.percentile(signal,[25,50,75])
    magnitude=np.abs(np.fft.fft(signal))
    skewness=np.mean(np.power(diff,3))/(np.power(std,3)+1e-7)
    kurtosis=np.mean(np.power(diff,4))/(np.power(std,4)+1e-7)
    perfusion=(hi-lo)/(np.abs(mean)+1e-7)*100
    squared=np.array(signal)**2
    entropy=-np.sum(squared*np.log(squared+1e-10))/len(signal)
    negative=np.sum(np.array(signal)<0)/len(signal)
    snr=np.var(signal)/(np.var(np.abs(signal))+1e-7)
    return np.array([np.sum(magnitude**2),np.var(magnitude),np.sum(magnitude),mean,q1,q2,q3,lo,hi,std,hi-lo,variance,rms,perfusion,skewness,kurtosis,entropy,negative,snr]).tolist()

rng=np.random.default_rng(42)
cases={'empty':[],'zero':[0.]*100,'constant':[200.]*301,
 'negative':[-3.,-2.,-1.,1.,2.]*20,
 'pulse':(200+2*np.sin(np.arange(301)/30*2*np.pi*1.2)).tolist(),
 'noise':rng.normal(0,3,257).tolist(),
 'weak_pulse':(200+.0001*np.sin(np.arange(128)/30*2*np.pi)).tolist()}
p=Path(__file__).parent/'fixtures/quality-features.json'
p.write_text(json.dumps([{'name':name,'signal':signal,'expected':features(signal)} for name,signal in cases.items()],allow_nan=False))

/** Feature order and formulas match extract_ppg_features in BIOF3003_Backend.ipynb.
 * Despite its name, training's zero_crossing_rate is the fraction of negative samples.
 * The full, unpadded N-point spectrum is required: padding changes the trained features.
 */
export function calculateQualityFeatures(signal:number[]):number[]{
 const n=signal.length;
 if(!n)return new Array(19).fill(0);
 if(signal.some(v=>!Number.isFinite(v)))throw Error('Nonfinite PPG input');
 const mean=signal.reduce((s,v)=>s+v,0)/n;
 const diff=signal.map(v=>v-mean);
 const variance=diff.reduce((s,v)=>s+v*v,0)/n;
 const std=Math.sqrt(variance);
 const squared=signal.map(v=>v*v);
 const rms=Math.sqrt(squared.reduce((s,v)=>s+v,0)/n);
 const sorted=[...signal].sort((a,b)=>a-b);
 const percentile=(p:number)=>{const at=(n-1)*p,lo=Math.floor(at),hi=Math.ceil(at);return sorted[lo]+(sorted[hi]-sorted[lo])*(at-lo)};
 const min=sorted[0],max=sorted[n-1],range=max-min;
 // Unnormalized N-point DFT magnitudes (same convention as np.fft.fft).
 // Recurrent rotations avoid evaluating trigonometric functions for each sample.
 const magnitudes:number[]=[];
 for(let k=0;k<n;k++){
  const angle=-2*Math.PI*k/n,c=Math.cos(angle),s=Math.sin(angle);
  let real=0,imag=0,wr=1,wi=0;
  for(const value of signal){real+=value*wr;imag+=value*wi;const next=wr*c-wi*s;wi=wr*s+wi*c;wr=next}
  magnitudes.push(Math.hypot(real,imag));
 }
 const fftSum=magnitudes.reduce((s,v)=>s+v,0),fftMean=fftSum/n;
 const fftEnergy=magnitudes.reduce((s,v)=>s+v*v,0);
 const fftVariance=magnitudes.reduce((s,v)=>s+(v-fftMean)**2,0)/n;
 const skewness=diff.reduce((s,v)=>s+v**3,0)/n/(std**3+1e-7);
 const kurtosis=diff.reduce((s,v)=>s+v**4,0)/n/(std**4+1e-7);
 const perfusion=range/(Math.abs(mean)+1e-7)*100;
 const entropy=-squared.reduce((s,v)=>s+v*Math.log(v+1e-10),0)/n;
 const negativeFraction=signal.filter(v=>v<0).length/n;
 const abs=signal.map(Math.abs),absMean=abs.reduce((s,v)=>s+v,0)/n;
 const absVariance=abs.reduce((s,v)=>s+(v-absMean)**2,0)/n;
 const snr=variance/(absVariance+1e-7);
 return [fftEnergy,fftVariance,fftSum,mean,percentile(.25),percentile(.5),percentile(.75),min,max,std,range,variance,rms,perfusion,skewness,kurtosis,entropy,negativeFraction,snr];
}

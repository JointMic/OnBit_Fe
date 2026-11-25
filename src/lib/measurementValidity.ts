/** Conservative contact candidates, not a validated tissue/liveness classifier. */
export function contactCandidate(pixels:ArrayLike<number>):boolean {
 let red=0,total=0,sumR=0,sumG=0,sumB=0,sumY=0,sumY2=0;
 for(let i=0;i+3<pixels.length;i+=4){const r=pixels[i],g=pixels[i+1],b=pixels[i+2];const y=(r+g+b)/3;total++;sumR+=r;sumG+=g;sumB+=b;sumY+=y;sumY2+=y*y;if(r>65&&r>g*1.35&&r>b*1.3&&r-g>25)red++}
 if(!total)return false;
 const mean=sumY/total,variance=Math.max(0,sumY2/total-mean*mean);
 return red/total>=.85&&sumR/total>70&&sumG/total>3&&sumB/total>2&&mean>25&&mean<220&&Math.sqrt(variance)/mean<.22;
}
/** Reject flat signals, large drift/movement and nonrepeating noise. */
export function pulseCandidate(signal:number[],fps:number):boolean{
 if(!Number.isFinite(fps)||fps<10||fps>90||signal.length<fps*5||signal.some(v=>!Number.isFinite(v)))return false;
 const n=signal.length,mean=signal.reduce((a,b)=>a+b,0)/n;
 const spread=Math.max(...signal)-Math.min(...signal);
 if(spread<.6)return false;
 // Remove linear exposure drift before checking periodicity.
 const centre=(n-1)/2;let numerator=0,denominator=0;
 for(let i=0;i<n;i++){numerator+=(i-centre)*(signal[i]-mean);denominator+=(i-centre)**2}
 const slope=numerator/denominator;const x=signal.map((v,i)=>v-mean-slope*(i-centre));
 const energy=x.reduce((a,b)=>a+b*b,0)/n;
 if(energy<.02||Math.sqrt(energy)/Math.max(1,Math.abs(mean))>.15)return false;
 let best=0;
 for(let lag=Math.max(1,Math.round(fps*.4));lag<=Math.min(Math.round(fps*1.5),Math.floor(n/4));lag++){
  let dot=0,a=0,b=0;for(let i=lag;i<n;i++){dot+=x[i]*x[i-lag];a+=x[i]**2;b+=x[i-lag]**2}
  const correlation=dot/Math.sqrt(a*b||1);best=Math.max(best,correlation);
 }
 return best>=.7;
}

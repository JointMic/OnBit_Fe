/** Conservative contact candidates, not a validated tissue/liveness classifier. */
export function contactCandidate(pixels:ArrayLike<number>):boolean {
 let red=0,total=0,sumR=0,sumG=0,sumB=0,sumY=0,sumY2=0;
 for(let i=0;i+3<pixels.length;i+=4){const r=pixels[i],g=pixels[i+1],b=pixels[i+2];const y=(r+g+b)/3;total++;sumR+=r;sumG+=g;sumB+=b;sumY+=y;sumY2+=y*y;if(r>65&&r>g*1.35&&r>b*1.3&&r-g>25)red++}
 if(!total)return false;
 const mean=sumY/total,variance=Math.max(0,sumY2/total-mean*mean);
 return red/total>=.85&&sumR/total>70&&sumG/total>3&&sumB/total>2&&mean>25&&mean<220&&Math.sqrt(variance)/mean<.22;
}
export function pulseAssessment(input:number[],fps:number){
 const signal=input.slice(-Math.round(fps*8));
 if(!Number.isFinite(fps)||fps<10||fps>90)return {ok:false,reason:'프레임 속도 부족',correlation:0,amplitude:0};
 if(signal.length<fps*5)return {ok:false,reason:'맥파 수집 중',correlation:0,amplitude:0};
 if(signal.some(v=>!Number.isFinite(v)))return {ok:false,reason:'신호 오류',correlation:0,amplitude:0};
 const n=signal.length,mean=signal.reduce((a,b)=>a+b,0)/n,centre=(n-1)/2;
 let numerator=0,denominator=0;for(let i=0;i<n;i++){numerator+=(i-centre)*(signal[i]-mean);denominator+=(i-centre)**2}
 const slope=numerator/denominator;
 const detrended=signal.map((v,i)=>v-mean-slope*(i-centre));
 const amplitude=Math.max(...detrended)-Math.min(...detrended);
 const energy=detrended.reduce((a,b)=>a+b*b,0)/n;
 // Spatial averaging has sub-pixel intensity resolution; a 0.6-level cutoff from
 // single-pixel sampling discarded weak pulses before periodicity was evaluated.
 if(amplitude<.02||energy<.00001)return {ok:false,reason:'광학 신호 변화 부족',correlation:0,amplitude};
 if(Math.sqrt(energy)/Math.max(1,Math.abs(mean))>.15)return {ok:false,reason:'움직임 또는 노출 변화',correlation:0,amplitude};
 let best=0;
 for(let lag=Math.max(1,Math.round(fps*.4));lag<=Math.min(Math.round(fps*1.5),Math.floor(n/4));lag++){
  let dot=0,a=0,b=0;for(let i=lag;i<n;i++){dot+=detrended[i]*detrended[i-lag];a+=detrended[i]**2;b+=detrended[i-lag]**2}
  best=Math.max(best,dot/Math.sqrt(a*b||1));
 }
 return {ok:best>=.7,reason:best>=.7?'':'반복 맥파 검출 대기',correlation:best,amplitude};
}
export function pulseCandidate(signal:number[],fps:number):boolean{return pulseAssessment(signal,fps).ok}

/** Remove slow exposure drift for pulse-location detection, not quality-model input. */
export function detrendPulse(signal:number[],fps:number):number[]{
 const radius=Math.max(1,Math.round(fps*.75));
 const prefix=[0];for(const value of signal)prefix.push(prefix[prefix.length-1]+value);
 return signal.map((v,i)=>{const a=Math.max(0,i-radius),b=Math.min(signal.length,i+radius+1);return v-(prefix[b]-prefix[a])/(b-a)});
}

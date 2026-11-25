// HeartLens feature extraction and pretrained quality model, executed locally.
import {useEffect,useRef,useState} from 'react'
import type * as TF from '@tensorflow/tfjs'
export default function useSignalQuality(ppgData:number[],enabled=true){
 const model=useRef<TF.LayersModel|null>(null);const tf=useRef<typeof TF|null>(null);const last=useRef(0);
 const [signalQuality,setQuality]=useState('--');const [qualityConfidence,setConfidence]=useState(0);const [modelStatus,setStatus]=useState('대기');
 useEffect(()=>{if(!enabled)return;let cancelled=false;setStatus('로딩 중');
 (async()=>{try{const runtime=await import('@tensorflow/tfjs');await runtime.ready();const loaded=await runtime.loadLayersModel('/tfjs_model/model.json');if(cancelled){loaded.dispose();return}tf.current=runtime;model.current=loaded;setStatus('준비')}catch{if(!cancelled)setStatus('모델 로드 실패')}})();
 return()=>{cancelled=true;model.current?.dispose();model.current=null;tf.current=null;setQuality('--');setConfidence(0)}
 },[enabled]);
 useEffect(()=>{if(!enabled||ppgData.length<100||!model.current||!tf.current||performance.now()-last.current<500)return;last.current=performance.now();const features=calculateFeatures(ppgData);if(features.some(v=>!Number.isFinite(v)))return;
 try{const runtime=tf.current;const probabilities=runtime.tidy(()=>{const prediction=model.current!.predict(runtime.tensor2d([features])) as TF.Tensor;return Array.from(prediction.dataSync())});const index=probabilities.indexOf(Math.max(...probabilities));setQuality(['bad','acceptable','excellent'][index]);setConfidence(probabilities[index]*100)}catch{setStatus('분석 실패')}
 },[ppgData,enabled]);
 return {signalQuality,qualityConfidence,modelStatus};
}

function calculateFeatures(signal:number[]):number[] {
    if (!signal.length) return new Array(19).fill(0);
  
    // Basic statistics
    const mean = signal.reduce((sum, val) => sum + val, 0) / signal.length;
    const std = Math.sqrt(signal.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / signal.length);
    const variance = signal.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / signal.length;
    const rms = Math.sqrt(signal.reduce((sum, val) => sum + val * val, 0) / signal.length);
    const signalMin = Math.min(...signal);
    const signalMax = Math.max(...signal);
    const signalRange = signalMax - signalMin;
  
    // Quartiles (Q1, Q2=median, Q3)
    const q1 = percentile(signal, 25);
    const q2 = percentile(signal, 50); // Median
    const q3 = percentile(signal, 75);
  
    // Higher-order statistics
    const diff = signal.map(val => val - mean);
    const skewness = diff.reduce((sum, val) => sum + Math.pow(val, 3), 0) / signal.length / Math.pow(std || 1e-7, 3);
    const kurtosis = diff.reduce((sum, val) => sum + Math.pow(val, 4), 0) / signal.length / Math.pow(std || 1e-7, 4);
  
    // Perfusion (approximation)
    const perfusion = (signalMax - signalMin) / (Math.abs(mean) + 1e-7) * 100;
  
    // Entropy (approximation)
    const squaredSignal = signal.map(val => val * val);
    const epsilon = 1e-10;
    const entropy = -squaredSignal.reduce((sum, val) => sum + val * Math.log(val + epsilon), 0) / signal.length;
  
    // Zero crossing rate
    let zeroCrossings = 0;
    for (let i = 1; i < signal.length; i++) {
      if ((signal[i] >= 0 && signal[i - 1] < 0) || (signal[i] < 0 && signal[i - 1] >= 0)) {
        zeroCrossings++;
      }
    }
    const zeroCrossingRate = zeroCrossings / signal.length;
  
      // SNR Ratio (approximation)
      const absSignal = signal.map(val => Math.abs(val));
      const snrRatio = variance / (absSignal.reduce((sum, val) => sum + val * val, 0) / signal.length + 1e-7);
  
    // FFT Features (Simplified - requires a separate FFT library for accurate calculation)
    // In this example, we are just adding placeholders.  For real FFT features, you'd need to use a library.
    const fftEnergy = 0; // Placeholder
    const fftVariance = 0; // Placeholder
    const fftSum = 0; // Placeholder
  
    return [
      fftEnergy,
      fftVariance,
      fftSum,
      mean,
      q1,
      q2,
      q3,
      signalMin,
      signalMax,
      std,
      signalRange,
      variance,
      rms,
      perfusion,
      skewness,
      kurtosis,
      entropy,
      zeroCrossingRate,
      snrRatio
    ];
  };
  
  // Helper function to calculate percentile
  function percentile(arr: number[], p: number): number {
    const sorted = [...arr].sort((a, b) => a - b);
    const index = (p / 100) * (sorted.length - 1);
    const lower = Math.floor(index);
    const upper = Math.ceil(index);
    const fraction = index - lower;
    return sorted[lower] * (1 - fraction) + sorted[upper] * fraction;
  }
  

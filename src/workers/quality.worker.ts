// Original HeartLens features/model, executed off the UI thread.
import * as tf from '@tensorflow/tfjs'
let model:tf.LayersModel|null=null;
let busy=false;
self.onmessage=async(event:MessageEvent<{type:string;signal?:number[]}>)=>{
 if(event.data.type==='init'){
  try{await tf.setBackend('cpu');await tf.ready();model=await tf.loadLayersModel('/tfjs_model/model.json');self.postMessage({type:'ready'})}
  catch(error){self.postMessage({type:'error',message:String(error)})}
  return;
 }
 if(event.data.type!=='assess'||!model||busy)return;
 busy=true;
 try{
  const features=calculateFeatures(event.data.signal||[]);
  const probabilities=tf.tidy(()=>{const prediction=model!.predict(tf.tensor2d([features])) as tf.Tensor;return Array.from(prediction.dataSync())});
  const index=probabilities.indexOf(Math.max(...probabilities));
  self.postMessage({type:'result',signalQuality:['bad','acceptable','excellent'][index],qualityConfidence:probabilities[index]*100});
 }catch(error){self.postMessage({type:'error',message:String(error)})}
 finally{busy=false}
};
  const calculateFeatures = (signal: number[]): number[] => {
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
    const skewness = diff.reduce((sum, val) => sum + Math.pow(val, 3), 0) / signal.length / Math.pow(std, 3);
    const kurtosis = diff.reduce((sum, val) => sum + Math.pow(val, 4), 0) / signal.length / Math.pow(std, 4);
  
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
  

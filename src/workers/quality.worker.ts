// Colab training-compatible features and existing HeartLens model, off the UI thread.
import * as tf from '@tensorflow/tfjs'
import {calculateQualityFeatures} from '../lib/ppgQualityFeatures'
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
  const features=calculateQualityFeatures(event.data.signal||[]);
  const probabilities=tf.tidy(()=>{const prediction=model!.predict(tf.tensor2d([features])) as tf.Tensor;return Array.from(prediction.dataSync())});
  const index=probabilities.indexOf(Math.max(...probabilities));
  self.postMessage({type:'result',signalQuality:['bad','acceptable','excellent'][index],qualityConfidence:probabilities[index]*100});
 }catch(error){self.postMessage({type:'error',message:String(error)})}
 finally{busy=false}
};

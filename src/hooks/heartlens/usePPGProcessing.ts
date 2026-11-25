import {sampledFrameRate} from '../../lib/cameraFrameLoop';
import {contactCandidate,pulseAssessment,detrendPulse} from '../../lib/measurementValidity';
// hooks/usePPGProcessing.ts
import { useState, useRef, useEffect } from 'react';
// import * as tf from '@tensorflow/tfjs';

interface Valley {
  timestamp: Date;
  value: number;
  index: number;
}

interface HRVResult {
  sdnn: number;
  confidence: number;
}

interface HeartRateResult {
  bpm: number;
  confidence: number;
}

// interface MongoRecord {
//   ppgData: number[];
//   heartRate: HeartRateResult | { bpm: 0; confidence: 0 };
//   hrv: HRVResult | { sdnn: 0; confidence: 0 };
//   timestamp: Date;
// }

interface PPGProcessingResult {
  ppgData: number[];
  valleys: Valley[];
  heartRate: HeartRateResult;
  hrv: HRVResult;
  processFrame: (frameId?:number,mediaTime?:number) => void;
  getValidity: () => {contact:boolean;stable:boolean;hrvReady:boolean;reason:string;fps:number;duration:number;correlation:number;amplitude:number;beats:number};
}

/**
 * Custom hook for processing PPG (Photoplethysmography) data from camera feed
 * @param {boolean} isRecording - Whether the camera is currently recording
 * @param {string} signalCombination - The signal combination method to use ('default', 'red', 'green', 'blue')
 * @param {React.RefObject<HTMLVideoElement>} videoRef - Reference to the video element
 * @param {React.RefObject<HTMLCanvasElement>} canvasRef - Reference to the canvas element
 * @returns {Object} Object containing:
 *   - ppgData: Array of processed PPG signal values
 *   - valleys: Array of detected valley points in the signal
 *   - heartRate: Object containing BPM and confidence
 *   - hrv: Object containing SDNN and confidence
 *   - processFrame: Function to process a single video frame
 *   - startCamera: Function to start the camera
 *   - stopCamera: Function to stop the camera
 */
export default function usePPGProcessing(
  isRecording: boolean,
  signalCombination: string,
  videoRef: React.RefObject<HTMLVideoElement>,
  canvasRef: React.RefObject<HTMLCanvasElement>
): PPGProcessingResult {
  const [ppgData, setPpgData] = useState<number[]>([]);
  const [valleys, setValleys] = useState<Valley[]>([]);
  const [heartRate, setHeartRate] = useState<HeartRateResult>({
    bpm: 0,
    confidence: 0,
  });
  const [confidence, setConfidence] = useState<number>(0);
  const [hrv, setHRV] = useState<HRVResult>({ sdnn: 0, confidence: 0 });

  const gate = useRef({contact:false,stable:false,hrvReady:false,reason:'손가락 접촉 대기',fps:0,duration:0,correlation:0,amplitude:0,beats:0});
  const sampleBuffer=useRef<number[]>([]);
  const frameTimes=useRef<number[]>([]);
  const mediaEpoch=useRef<number|null>(null);
  const lastPublish=useRef(0);
  const sampleTimes=useRef<number[]>([]);
  const contactSince = useRef<number|null>(null);
  const contactCanvas = useRef<HTMLCanvasElement|null>(null);
  const lastAnalysis = useRef(0);
  const lastVideoTime = useRef(-1);


  const fpsRef = useRef<number>(30);

  useEffect(() => {
    if (isRecording) {
      setPpgData([]); setValleys([]);
      setHeartRate({bpm:0,confidence:0}); setHRV({sdnn:0,confidence:0});
      gate.current={contact:false,stable:false,hrvReady:false,reason:'손가락 접촉 대기',fps:0,duration:0,correlation:0,amplitude:0,beats:0};contactSince.current=null;sampleTimes.current=[];sampleBuffer.current=[];frameTimes.current=[];mediaEpoch.current=null;lastPublish.current=0;
      lastVideoTime.current=-1; lastAnalysis.current=0;
      fpsRef.current=30;
    }
  }, [isRecording]);

  const samplePoints = [
    { x: 0.2, y: 0.2 }, // top-left
    { x: 0.8, y: 0.2 }, // top-right
    { x: 0.5, y: 0.5 }, // center
    { x: 0.2, y: 0.8 }, // bottom-left
    { x: 0.8, y: 0.8 }, // bottom-right
  ];

  // A frame's identity comes from compositor metadata, not rounded currentTime.
  const processFrame = (frameId?:number,mediaTime?:number) => {
    if(!videoRef.current||!canvasRef.current||videoRef.current.readyState<2)return;
    const identity=frameId??videoRef.current.currentTime;
    if(identity===lastVideoTime.current)return;
    lastVideoTime.current=identity;
    const now=performance.now();
    if(mediaEpoch.current===null&&mediaTime!==undefined)mediaEpoch.current=Date.now()-mediaTime*1000;
    const sampleTime=mediaTime!==undefined&&mediaEpoch.current!==null?mediaEpoch.current+mediaTime*1000:Date.now();
    frameTimes.current=[...frameTimes.current.filter(t=>sampleTime-t<=3000),sampleTime];
    const measured=sampledFrameRate(frameTimes.current);
    if(measured>0)fpsRef.current=measured;
    gate.current.fps=measured;

    const canvas = canvasRef.current;
    const context = canvas.getContext('2d',{willReadFrequently:true});
    if (!context) return;

    try {
      context.drawImage(videoRef.current, 0, 0, canvas.width, canvas.height);
      if(!contactCanvas.current){contactCanvas.current=document.createElement('canvas');contactCanvas.current.width=32;contactCanvas.current.height=24;}
      const contactContext=contactCanvas.current.getContext('2d',{willReadFrequently:true});
      if(!contactContext)return;
      contactContext.drawImage(videoRef.current,0,0,32,24);
      const contact=contactCandidate(contactContext.getImageData(0,0,32,24).data);
      gate.current.contact=contact;
      if(!contact){
        contactSince.current=null;sampleTimes.current=[];sampleBuffer.current=[];gate.current={contact:false,stable:false,hrvReady:false,reason:'손가락 접촉 대기',fps:measured,duration:0,correlation:0,amplitude:0,beats:0};
        setPpgData(prev=>prev.length?[]:prev);setValleys(prev=>prev.length?[]:prev);
        setHeartRate(prev=>prev.bpm?{bpm:0,confidence:0}:prev);setHRV(prev=>prev.confidence?{sdnn:0,confidence:0}:prev);
        return;
      }
      if(contactSince.current===null)contactSince.current=performance.now();
      gate.current.duration=(performance.now()-contactSince.current)/1000;
      if(sampleBuffer.current.length<100)gate.current.reason="맥파 수집 중";


      let rSum = 0,
        gSum = 0,
        bSum = 0;
      let validSamples = 0;

      samplePoints.forEach((point, index) => {
        try {
          const x = Math.floor(point.x * canvas.width);
          const y = Math.floor(point.y * canvas.height);

          // Validate coordinates
          if (x >= 0 && x < canvas.width && y >= 0 && y < canvas.height) {
            // Average a 16x16 patch at each of the original five locations.
            // This preserves weak, sub-integer pulse variations instead of 0.2 steps.
            const pixels = context.getImageData(Math.max(0,x-8),Math.max(0,y-8),16,16).data;
            for(let i=0;i<pixels.length;i+=4){rSum+=pixels[i];gSum+=pixels[i+1];bSum+=pixels[i+2];validSamples++;}

            // Visualize sampling points
            context.beginPath();
            context.arc(x, y, 5, 0, 2 * Math.PI);
            context.fillStyle = 'yellow';
            context.fill();
          }
        } catch (err) {
          console.error(`Error processing sample point ${index}:`, err);
        }
      });

      if (validSamples === 0) return;

      let ppgSignal = 0;
      switch (signalCombination) {
        case 'redOnly':
          ppgSignal = rSum / validSamples;
          break;
        case 'greenOnly':
          ppgSignal = gSum / validSamples;
          break;
        case 'blueOnly':
          ppgSignal = bSum / validSamples;
          break;
        case 'redMinusBlue':
          ppgSignal = (rSum - bSum) / validSamples;
          break;
        case 'custom':
          ppgSignal = (3 * rSum - bSum - gSum) / validSamples;
          break;
        default:
          ppgSignal = (2 * rSum - gSum - bSum) / validSamples;
      }

      sampleTimes.current=[...sampleTimes.current.slice(-899),sampleTime];
      const newData=[...sampleBuffer.current.slice(-899),ppgSignal];
      sampleBuffer.current=newData;
      // UI/quality snapshots at 8 Hz; optical sampling stays at camera cadence.
      if(now-lastPublish.current>=125){lastPublish.current=now;setPpgData(newData)}
        if (newData.length >= 100 && performance.now() - lastAnalysis.current >= 500) {
          lastAnalysis.current = performance.now();
          const recentCount=Math.min(newData.length,Math.round(fpsRef.current*8));
          const assessment=pulseAssessment(newData,fpsRef.current);
          const newValleys=detectValleys(newData);
          const recentValleys=newValleys.filter(v=>v.index>=newData.length-recentCount);
          const duration=performance.now()-(contactSince.current??performance.now());
          const stable=duration>=5000&&assessment.ok&&recentValleys.length>=4;
          const hrvReady=stable&&newValleys.length>=11&&newValleys[newValleys.length-1].timestamp.getTime()-newValleys[0].timestamp.getTime()>=10000;
          gate.current={contact:true,stable,hrvReady,reason:duration<5000?'맥파 수집 중':!assessment.ok?assessment.reason:recentValleys.length<4?'맥박 간격 수집 중':'',fps:fpsRef.current,duration:duration/1000,correlation:assessment.correlation,amplitude:assessment.amplitude,beats:newValleys.length};
          setValleys(stable?newValleys:[]);

          const heartRateValue = calculateHeartRate(recentValleys);
          setHeartRate(stable?heartRateValue:{bpm:0,confidence:0});
          setConfidence(confidence);

          const hrvValues = calculateHRV(newValleys);
          setHRV(gate.current.hrvReady?hrvValues:{sdnn:0,confidence:0});
        }

    } catch (err) {
      console.error('Error in processFrame:', err);
    }
  };

  // Detect valleys in the PPG signal
  const detectValleys = (
    signal: number[],
    providedFps: number = fpsRef.current
  ): Valley[] => {
    const valleys: Valley[] = [];
    const minValleyDistance = Math.floor(providedFps * 0.4); // Minimum 0.4 seconds between valleys
    const windowSize = Math.max(1,Math.floor(providedFps * 0.15)); // 0.5 second window for smoothing

    const normalizedSignal = normalizeSignal(detrendPulse(signal,providedFps));

    for (let i = windowSize; i < normalizedSignal.length - windowSize; i++) {
      if (isLocalMinimum(normalizedSignal, i, windowSize)) {
        if (
          valleys.length === 0 ||
          i - valleys[valleys.length - 1].index >= minValleyDistance
        ) {
          valleys.push({
            timestamp: new Date(sampleTimes.current[i] ?? Date.now()),
            value: signal[i],
            index: i,
          });
        }
      }
    }

    return valleys;
  };

  const normalizeSignal = (signal: number[]): number[] => {
    const min = Math.min(...signal);
    const max = Math.max(...signal);
    if (max === min) return signal.map(() => 0);
    return signal.map((value) => (value - min) / (max - min));
  };

  const isLocalMinimum = (
    signal: number[],
    index: number,
    windowSize: number
  ): boolean => {
    const leftWindow = signal.slice(Math.max(0, index - windowSize), index);
    const rightWindow = signal.slice(
      index + 1,
      Math.min(signal.length, index + windowSize + 1)
    );

    return (
      Math.min(...leftWindow) >= signal[index] &&
      Math.min(...rightWindow) > signal[index]
    );
  };

  const calculateHeartRate = (valleys: Valley[]): HeartRateResult => {
    if (valleys.length < 2) return { bpm: 0, confidence: 0 };

    const intervals = valleys.slice(1).map((_, i) => {
      const interval =
        valleys[i + 1].timestamp.getTime() - valleys[i].timestamp.getTime();
      return interval / 1000;
    });

    const validIntervals = intervals.filter(
      (interval) => interval >= 0.4 && interval <= 2.0
    );

    if (validIntervals.length === 0) return { bpm: 0, confidence: 0 };

    const sortedIntervals = [...validIntervals].sort((a, b) => a - b);
    const median = sortedIntervals[Math.floor(sortedIntervals.length / 2)];

    const mean =
      validIntervals.reduce((sum, val) => sum + val, 0) / validIntervals.length;
    const variance =
      validIntervals.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) /
      validIntervals.length;
    const stdDev = Math.sqrt(variance);

    const coefficientOfVariation = (stdDev / mean) * 100;
    const confidence = Math.max(0, Math.min(100, 100 - coefficientOfVariation));

    const bpm = Math.round(60 / median);

    return { bpm, confidence };
  };

  const calculateHRV = (valleys: Valley[]): HRVResult => {
    if (valleys.length < 2) return { sdnn: 0, confidence: 0 };

    const rrIntervals = valleys.slice(1).map((_, i) => {
      const interval =
        valleys[i + 1].timestamp.getTime() - valleys[i].timestamp.getTime();
      return interval;
    });

    const validIntervals = rrIntervals.filter(
      (interval) => interval >= 250 && interval <= 2000
    );

    if (validIntervals.length < 2) return { sdnn: 0, confidence: 0 };

    const meanRR =
      validIntervals.reduce((sum, rr) => sum + rr, 0) / validIntervals.length;
    const squaredDifferences = validIntervals.map((rr) =>
      Math.pow(rr - meanRR, 2)
    );
    const sdnn = Math.sqrt(
      squaredDifferences.reduce((sum, diff) => sum + diff, 0) /
        (validIntervals.length - 1)
    );

    const intervalConfidence = Math.min(100, (validIntervals.length / 5) * 100);
    const cv = (sdnn / meanRR) * 100;
    const consistencyConfidence = Math.max(0, 100 - cv);
    const confidence = Math.min(
      100,
      (intervalConfidence + consistencyConfidence) / 2
    );

    return { sdnn: Math.round(sdnn), confidence: Math.round(confidence) };
  };

  return {
    ppgData,
    valleys,
    heartRate,
    hrv,
    processFrame,
    getValidity:()=>gate.current,
  };
}

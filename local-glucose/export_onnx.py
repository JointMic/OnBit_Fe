"""Export the supplied checkpoint for Vercel without retraining; verify CPU parity."""
import json,hashlib
from pathlib import Path
import numpy as np
import torch
import onnxruntime as ort
from model import ResNet34
ROOT=Path(__file__).resolve().parent
OUTPUT=ROOT.parent/'glucose_runtime/assets/model.onnx'
checkpoint=torch.load(ROOT/'assets/best.pt',map_location='cpu',weights_only=True)
model=ResNet34(123.);model.load_state_dict(checkpoint['model'],strict=True);model.eval();torch.set_num_threads(1)
torch.onnx.export(model,torch.zeros(1,1,100),str(OUTPUT),input_names=['ppg'],output_names=['glucose'],opset_version=17,dynamo=False)
session=ort.InferenceSession(str(OUTPUT),providers=['CPUExecutionProvider'])
rng=np.random.default_rng(42)
for x in [np.zeros((1,1,100),dtype='f4')]+[rng.uniform(-1,1,(1,1,100)).astype('f4') for _ in range(8)]:
 with torch.inference_mode():expected=model(torch.from_numpy(x)).numpy()
 actual=session.run(None,{'ppg':x})[0]
 np.testing.assert_allclose(actual,expected,atol=1e-4,rtol=1e-5)
metadata={'source':'best.pt','epoch':checkpoint['epoch'],'input_shape':[1,1,100],'opset':17,'torch_sha256':hashlib.sha256((ROOT/'assets/best.pt').read_bytes()).hexdigest(),'onnx_sha256':hashlib.sha256(OUTPUT.read_bytes()).hexdigest(),'parity_cases':9,'atol':1e-4,'rtol':1e-5}
(OUTPUT.parent/'model_metadata.json').write_text(json.dumps(metadata,indent=2)+'\n')
print('Export and nine-case PyTorch/ONNX parity passed')

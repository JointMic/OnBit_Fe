"""Same-origin experimental glucose inference; samples are processed in memory only."""
import json
from functools import lru_cache
from http.server import BaseHTTPRequestHandler
from urllib.parse import urlparse,parse_qs
from glucose_runtime.engine import Engine

@lru_cache(maxsize=1)
def engine():return Engine()

class handler(BaseHTTPRequestHandler):
    def reply(self,data,code=200):
        body=json.dumps(data,allow_nan=False).encode()
        self.send_response(code);self.send_header('Content-Type','application/json');self.send_header('Cache-Control','no-store');self.send_header('Content-Length',str(len(body)));self.end_headers();self.wfile.write(body)
    def operation(self):return parse_qs(urlparse(self.path).query).get('op',[self.path.rstrip('/').split('/')[-1]])[0]
    def do_GET(self):
        if self.operation()!='health':return self.reply({'error':'Not found'},404)
        e=engine();self.reply({'status':'ready','runtime':'onnx','cutoff':e.settings['cosine_cutoff'],'experimental':True})
    def do_POST(self):
        if self.operation()!='infer':return self.reply({'error':'Not found'},404)
        origin=self.headers.get('Origin')
        if origin and urlparse(origin).netloc!=self.headers.get('Host'):return self.reply({'error':'Origin not allowed'},403)
        try:
            n=int(self.headers.get('Content-Length','0'))
            if not 0<n<=150000:raise ValueError('Invalid request size')
            packet=json.loads(self.rfile.read(n));result=engine().infer(packet);self.reply(result)
        except (ValueError,TypeError,KeyError,OverflowError):self.reply({'error':'Invalid PPG packet'},400)
        except Exception:self.reply({'error':'Model inference unavailable'},503)
    def log_message(self,*args):pass

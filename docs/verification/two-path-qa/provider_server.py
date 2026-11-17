"""격리 QA 전용. 실제 Router/service를 실행하고 모델 함수만 합성 정답으로 대체한다."""
import json
import os
import sys
from pathlib import Path

root=Path(__file__).resolve().parents[3]
sys.path.insert(0,str(root/'backend/ai-service'))
sys.meta_path[:]=[f for f in sys.meta_path if '__editable__' not in getattr(f,'__module__','')]
from fastapi import FastAPI
from app.preprocessing import service
from app.preprocessing.router import router
import uvicorn

data=json.loads((root/'backend/ai-service/tests/preprocessing/fixtures/ten-episodes.json').read_text(encoding='utf-8'))
calls=[]
failures=set()
def extract(episode):
    expected=data['episodes'][episode.number-1]
    if episode.body!=expected['body']:
        raise ValueError('QA_SOURCE_MISMATCH')
    calls.append({'number':episode.number,'body':episode.body})
    if episode.number in failures:
        failures.remove(episode.number)
        from app.preprocessing.errors import PreprocessingFailure
        raise PreprocessingFailure('MODEL_TIMEOUT',504)
    return expected['output']

service.agent.extract=extract
service.agent.resolve=lambda rows:{'links':[l for l in data['resolution']['links'] if l['evidenceEpisode'] in {r.number for r in rows}]}
os.environ['INTERNAL_TOKEN']='qa-token'
os.environ.pop('OPENAI_API_KEY',None)
app=FastAPI();app.include_router(router)
@app.get('/qa/calls')
def read_calls():
    return calls

@app.post('/qa/fail-next/{number}')
def fail_next(number:int):
    failures.add(number)
    return {'number':number}

if __name__=='__main__':
    uvicorn.run(app,host='0.0.0.0',port=8769,access_log=False)

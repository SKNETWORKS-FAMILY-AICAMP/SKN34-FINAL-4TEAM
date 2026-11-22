"""격리 QA 전용. 실제 Router/service를 실행하고 모델 함수만 합성 정답으로 대체한다."""
import json
import os
import sys
from pathlib import Path

root=Path(__file__).resolve().parents[3]
sys.path.insert(0,str(root/'backend/ai-service'))
sys.meta_path[:]=[f for f in sys.meta_path if '__editable__' not in getattr(f,'__module__','')]
from fastapi import FastAPI
from app.manuscript_extraction import service
from app.preprocessing.router import router as job_router
from app.initial_world.router import router as initial_router
from app.initial_world import service as initial_service
from manual_provider import propose
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
        from app.manuscript_extraction.errors import PreprocessingFailure
        raise PreprocessingFailure('MODEL_TIMEOUT',504)
    return expected['output']

service.agent.extract=extract
service.agent.resolve=lambda rows:{'links':[l for l in data['resolution']['links'] if l['evidenceEpisode'] in {r.number for r in rows}]}
os.environ['INTERNAL_TOKEN']='qa-only-manuscript-internal-token-32-chars'
os.environ['CONTENT_SERVICE_BASE_URL']=os.environ.get('MANUSCRIPT_QA_CONTENT_URL','http://127.0.0.1:18761')
os.environ.pop('OPENAI_API_KEY',None)
# 격리 QA에는 RabbitMQ가 없다. 실제 router는 그대로 두고 Celery 발행만 즉시 시작하는 스레드로 바꾼다(운영 워커처럼 응답과 실행 순서를 보장하지 않는다).
import threading
from types import SimpleNamespace
from app.preprocessing import router as job_module, worker
from app.preprocessing.models import JobRequest
job_module.run_job=SimpleNamespace(delay=lambda payload: threading.Thread(target=worker.run,args=(JobRequest.model_validate(payload),),daemon=True).start())
app=FastAPI();app.include_router(job_router)
initial_service.agent.propose=propose
app.include_router(initial_router)

@app.get('/qa/status')
def status():
    return {'mode':'fixed-fixture-only','paidModelCalls':False,'directCandidates':True,'manuscriptEpisodes':[4,10],'incrementalUpdate':False}
@app.get('/qa/calls')
def read_calls():
    return calls

@app.post('/qa/fail-next/{number}')
def fail_next(number:int):
    failures.add(number)
    return {'number':number}

if __name__=='__main__':
    uvicorn.run(app,host='0.0.0.0',port=8769,access_log=False)

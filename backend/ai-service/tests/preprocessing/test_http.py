"""실제 추출/정체/구성 함수를 HTTP로 연결하되 제공사만 대역으로 사용한다."""
import json
from pathlib import Path
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from app.preprocessing import service

pytestmark = pytest.mark.integration

@pytest.mark.parametrize("count", [4,10])
def test_four_episode_http_structure_and_auth(monkeypatch,count):
    from app.preprocessing.router import router
    monkeypatch.setenv('INTERNAL_TOKEN', 'qa-token')
    data=json.loads((Path(__file__).parent/'fixtures/ten-episodes.json').read_text(encoding='utf-8'))
    data['episodes']=data['episodes'][:count]
    data['resolution']['links']=[l for l in data['resolution']['links'] if l['evidenceEpisode']<=count]
    monkeypatch.setattr(service.agent,'extract',lambda ep:data['episodes'][ep.number-1]['output'])
    monkeypatch.setattr(service.agent,'resolve',lambda rows:data['resolution'])
    app=FastAPI();app.include_router(router)
    with TestClient(app) as client:
        headers={'X-Internal-Token':'qa-token'}
        path='/internal/v1/manuscript-build/extractions'
        episode={k:v for k,v in data['episodes'][0].items() if k!='output'}
        assert client.post(path,json=episode).status_code==403
        rows=[]
        for ep in data['episodes']:
            response=client.post(path,json={k:v for k,v in ep.items() if k!='output'},headers=headers)
            assert response.status_code==200,response.text
            rows.append(response.json())
        response=client.post('/internal/v1/manuscript-build/structure',json={'extractions':rows},headers=headers)
        assert response.status_code==200,response.text
        result=response.json()
        assert len(result['payload']['relations'])==(2 if count==4 else 5)
        assert all('revealFromEpisode' not in c for c in result['payload']['cards'])
        if count==10:
            cards=result['payload']['cards']
            hero=next(c for c in cards if c['title']=='길동')
            merchant=next(c for c in cards if c['title']=='홍길동')
            assert hero['key']!=merchant['key']
            assert hero['aliases']==['홍길동']
            assert '다스리고' not in hero['characterDocs']['goal']
            assert '다스리고' in hero['characterDocs']['episodes']['03']
            assert '10화의 암호' not in str(hero)
            assert '비밀 지도' not in str(merchant)
            assert '10화의 암호' in merchant['characterDocs']['episodes']['10']
            assert next(c for c in cards if c['title']=='산채')['firstAppearanceEpisode']==5
            assert next(c for c in cards if c['title']=='부채')['firstAppearanceEpisode']==6
            assert [(r['fromEpisode'],r['ended']) for r in result['payload']['relations']]==[(1,False),(4,True),(5,False),(8,True),(9,False)]
            assert all(row['source']==ep['body'] for row,ep in zip(rows,data['episodes']))
        bad=rows+rows[:1]
        assert client.post('/internal/v1/manuscript-build/structure',json={'extractions':bad},headers=headers).status_code==422

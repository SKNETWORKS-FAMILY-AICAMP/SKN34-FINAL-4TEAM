import copy
import json
import pytest
from app.world_wiki import knowledge as k
from app.world_wiki import minimal as m
from agents import AgentOutputSchema
from pathlib import Path


def request():
    text='도윤은 꿈을 꾸었다. 서린은 그 꿈을 해석했다.\n능력은 아직 미정이다. | 원문 그대로'
    return k.InitialSemanticRequest(sources=[{'id':'name','text':'설정집'}, {'id':'description','text':text},
        {'id':'author-a:description','text':'서린은 도윤의 자녀다.'}],targets=[
        {'id':'author-a','name':'서린','kind':'character','sourceId':'author-a:description','start':0,'end':len('서린은 도윤의 자녀다.')}])


def output(**values):
    return m.MinimalOutput.model_validate(dict(new_entities=[],records=[],input_review=[],unresolved=[])|values)


def test_segments_preserve_every_character_and_are_stable_on_reorder():
    req=request();ctx=m.prepare(req)
    for source in req.sources:
        assert ''.join(s['quote'] for s in ctx.evidence.values() if s['sourceId']==source.id)==source.text
    req.sources.reverse()
    assert ctx.evidence==m.prepare(req).evidence
    assert ctx.aliases==m.prepare(req).aliases
    req.sources[0].text+=' 변경'
    with pytest.raises(ValueError,match='version'):m.expand(ctx,output())


def test_long_unpunctuated_source_is_losslessly_bounded():
    req=k.InitialSemanticRequest(sources=[{'id':'description','text':('긴 조건😀 | 부정 아님 '*200)}])
    ctx=m.prepare(req)
    assert ''.join(s.text for s in ctx.payload.segments)==req.sources[0].text
    assert max(len(s.text) for s in ctx.payload.segments)<=600


def test_unknown_event_predecessor_is_rejected():
    ctx=m.prepare(request());proof=next(iter(ctx.evidence))
    events=[dict(id=id,kind='event',text='과거 사건',subject=None,target=None,topics=['history.past_event'],time='',after=after,order_evidence=[proof],evidence=[proof]) for id,after in [('r1','r2'),('r2','missing')]]
    with pytest.raises(ValueError,match='event order'):m.expand(ctx,output(records=events))


def test_minimal_schema_uses_nested_anyof_and_no_universal_empty_fields():
    schema=AgentOutputSchema(m.MinimalOutput).json_schema()
    assert schema['type']=='object' and 'anyOf' not in schema
    assert 'anyOf' in schema['properties']['records']['items']
    def walk(v):
        if isinstance(v,dict):
            assert not {'oneOf','discriminator','if','then','else'}&v.keys()
            if v.get('type')=='object':
                assert v['additionalProperties'] is False
                assert set(v['required'])==set(v['properties'])
            for x in v.values():walk(x)
        elif isinstance(v,list):
            for x in v:walk(x)
    walk(schema)
    assert 'quote' not in json.dumps(schema)


def test_absence_is_explicit_and_missing_records_stay_unknown():
    result=m.expand(m.prepare(request()),output(input_review=['space.city']))
    rows={r['topic']:r for r in result['coverage']}
    assert rows['space.city']['status']=='not_provided'
    assert rows['culture.religion']['status']=='unknown'


def test_reference_evidence_and_duplicate_suspicion_without_merge():
    ctx=m.prepare(request());proof=next(iter(ctx.evidence));alias=next(iter(ctx.aliases))
    o=output(new_entities=[dict(id='n1',name='서린',type='character',topics=[],evidence=[proof])],
        records=[dict(kind='relation',id='r1',subject=alias,target='n1',predicate='child_of',polarity='asserted',detail=None,topics=[],evidence=[proof])])
    result=m.expand(ctx,o)
    assert len(result['items'])==2
    assert result['items'][1]['subjectId']=='author-a'
    assert result['review_flags']['n1']
    assert result['items'][0]['evidence'][0]['quote']==ctx.evidence[proof]['quote']
    bad=o.model_dump();bad['records'][0]['evidence']=['missing']
    with pytest.raises(ValueError,match='evidence'):m.expand(ctx,m.MinimalOutput.model_validate(bad))
    bad=o.model_dump();bad['records'][0]['target']='missing'
    with pytest.raises(ValueError,match='reference'):m.expand(ctx,m.MinimalOutput.model_validate(bad))


def test_absence_conflict_and_unresolved_are_not_silently_fixed():
    ctx=m.prepare(request());proof=next(iter(ctx.evidence))
    o=output(unresolved=[dict(text='누가 꿈을 해석했는지 확인 필요',targets=[],topics=['history.past_event'],evidence=[proof])])
    result=m.expand(ctx,o)
    assert result['review_flags'] and result['items'][0]['kind']=='note'
    o.input_review=['history.past_event']
    with pytest.raises(ValueError,match='absence'):m.expand(ctx,o)


def test_condition_uncertainty_negation_and_plan_are_preserved():
    ctx=m.prepare(request());proof=next(iter(ctx.evidence));alias=next(iter(ctx.aliases))
    records=[dict(id='r1',kind='constraint',text='칭찬받을수록 위협을 느낀다.',subject=alias,target=None,polarity='asserted',condition='칭찬받을수록',topics=['conflict.social_issue'],evidence=[proof]),
             dict(id='r2',kind='undetermined',text='초기 능력은 미정이다.',subject=alias,target=None,polarity='asserted',condition='',topics=['special.condition'],evidence=[proof]),
             dict(id='r3',kind='note',text='후반에 왕이 되는 결말도 검토 중이다.',target=alias,evidence=[proof])]
    rows=m.expand(ctx,output(records=records))['items']
    assert rows[0]['condition']=='칭찬받을수록'
    assert rows[1]['kind']=='undetermined' and rows[1]['polarity']=='asserted'
    assert rows[2]['kind']=='note' and rows[2]['topics']==[]


def test_real_route_uses_minimal_provider_contract_and_preserves_raw(monkeypatch,tmp_path):
    import asyncio
    import httpx2
    req=request();ctx=m.prepare(req);seen=[]
    raw=output(input_review=['space.city']).model_dump_json()
    def respond(http_request):
        body=json.loads(http_request.content);seen.append(body)
        assert json.loads(body['input'][-1]['content'])==ctx.payload.model_dump()
        assert 'quote' not in json.dumps(body['text']['format']['schema'])
        assert body['text']['format']['schema']['$defs']['EvidenceId']['enum']==list(ctx.evidence)
        return httpx2.Response(200,json={'id':'resp_local','object':'response','created_at':0,'status':'completed','model':'test-model','output':[{'id':'msg_local','type':'message','role':'assistant','status':'completed','content':[{'type':'output_text','text':raw,'annotations':[]}]}],'usage':{'input_tokens':1,'output_tokens':1,'total_tokens':2}})
    real=httpx2.AsyncClient
    class LocalClient(real):
        def __init__(self,**kw):
            kw.update(transport=httpx2.MockTransport(respond),trust_env=False);super().__init__(**kw)
    monkeypatch.setattr(httpx2,'AsyncClient',LocalClient)
    monkeypatch.setenv('OPENAI_API_KEY','local-test-only');monkeypatch.setenv('OPENAI_MODEL','test-model')
    monkeypatch.setenv('WORLD_POC_AUDIT_DIR',str(tmp_path))
    result=asyncio.run(k.initial_knowledge(req))
    assert len(seen)==1 and result['contractVersion']==m.VERSION
    assert result['rawOutput']==raw and result['items']==[]
    assert next(r for r in result['coverage'] if r['topic']=='culture.religion')['status']=='unknown'
    audit=json.loads(next(tmp_path.glob('*.json')).read_text(encoding='utf-8'))
    assert audit['source_context']['revision']==ctx.revision
    assert audit['source_context']['input']==req.model_dump()
    assert audit['raw_response']['output'][0]['content'][0]['text']==raw

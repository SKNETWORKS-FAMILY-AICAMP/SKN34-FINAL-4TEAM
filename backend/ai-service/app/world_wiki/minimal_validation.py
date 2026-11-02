"""Request-bound schema and blocking diagnostics; never repair model content."""
import json
import re
from collections import Counter
from agents import AgentOutputSchema
from agents.exceptions import ModelBehaviorError
from pydantic import ValidationError


class ValidationFailure(ValueError, ModelBehaviorError):
    def __init__(self, diagnostics):
        self.diagnostics = diagnostics
        self.raw_output = None
        self.usage = {}
        super().__init__('; '.join(f"{d['record_id'] or '$'} {d['field']}: {d['cause']}" for d in diagnostics))


def check_context(ctx):
    from .minimal import prepare, revision
    if revision(ctx.original) != ctx.revision:
        raise ValueError('Source version mismatch')
    fresh = prepare(ctx.original)
    if (fresh.evidence, fresh.aliases, fresh.payload) != (ctx.evidence, ctx.aliases, ctx.payload):
        raise ValueError('Source version mapping mismatch')


def diagnose(ctx, raw):
    from .minimal import MinimalOutput, NewEntity, Statement, Relation, Event, Note, Unresolved
    from .knowledge import INITIAL_TOPICS
    diagnostics = []
    def add(rid, field, code, cause, status='error'):
        diagnostics.append(dict(record_id=rid, field=field, code=code, cause=cause, status=status))
    try:
        check_context(ctx)
    except ValueError as exc:
        add(None, '$source', 'source_version', str(exc))
        add(None, '$source', 'uncheckable', '근거 검사는 원문 버전 불일치로 검사 불가', 'uncheckable')
        return diagnostics
    if isinstance(raw, MinimalOutput):raw = raw.model_dump()
    if isinstance(raw, str):
        try:raw = json.loads(raw)
        except ValueError:
            add(None, '$', 'json_parse', 'JSON parsing failed')
            add(None, '$', 'uncheckable', '구조·참조 검사는 JSON 파싱 실패로 검사 불가', 'uncheckable')
            return diagnostics
    try:MinimalOutput.model_validate(raw)
    except ValidationError as exc:
        for error in exc.errors(include_input=False, include_url=False):
            loc = error['loc'];rid = None
            if isinstance(raw, dict) and len(loc)>1 and isinstance(loc[1], int):
                rows = raw.get(loc[0])
                if isinstance(rows, list) and loc[1]<len(rows) and isinstance(rows[loc[1]], dict):rid = rows[loc[1]].get('id')
            add(rid if isinstance(rid,str) else None, '.'.join(map(str,loc)), 'structure', error['msg'])
    if not isinstance(raw, dict):
        add(None, '$', 'uncheckable', '객체 구조가 없어 참조 검사 불가', 'uncheckable')
        return diagnostics
    valid = [];all_ids = [];raw_rows=[]
    models = {'fact':Statement,'rule':Statement,'constraint':Statement,'undetermined':Statement,
              'claim':Statement,'relation':Relation,'event':Event,'note':Note}
    for key in ('new_entities','records','unresolved'):
        rows = raw.get(key)
        if not isinstance(rows,list):
            add(None,key,'uncheckable','배열 구조가 없어 개별 기록 검사 불가','uncheckable');continue
        for n,row in enumerate(rows):
            path=f'{key}.{n}'
            rid=row.get('id') if isinstance(row,dict) else None
            if isinstance(row,dict):raw_rows.append((path,row))
            if key!='unresolved' and isinstance(rid,str):all_ids.append(rid)
            kind=row.get('kind') if isinstance(row,dict) else None
            model = NewEntity if key=='new_entities' else Unresolved if key=='unresolved' else models.get(kind) if isinstance(kind,str) else None
            try:
                if model is None:raise ValueError()
                parsed=model.model_validate(row)
            except (ValidationError,ValueError):
                add(rid if isinstance(rid,str) else None,path,'uncheckable','기록 구조 오류로 종류별 계약 검사 불가; 읽을 수 있는 참조는 별도 검사','uncheckable');continue
            valid.append((path,parsed))
    counts=Counter(all_ids);duplicates={i for i,c in counts.items() if c>1}
    unreadable=set(all_ids)-{r.id for _,r in valid if hasattr(r,'id')}
    reserved=set(ctx.aliases)|set(ctx.aliases.values())|{'author-world-name'}
    for rid in all_ids:
        if counts[rid]>1:
            add(rid,'id','duplicate_id','Duplicate candidate ID')
            counts[rid]=0
        if not re.fullmatch(r'[A-Za-z][A-Za-z0-9_-]{0,39}',rid) or rid in reserved or rid.startswith('unresolved-'):
            add(rid,'id','invalid_id','Invalid or reserved candidate ID')
    entities={t.id:t.kind for t in ctx.payload.targets}
    entities.update({r.id:r.type for _,r in valid if isinstance(r,NewEntity) and r.id not in duplicates})
    events={r.id:r for _,r in valid if isinstance(r,Event) and r.id not in duplicates}
    if duplicates:add(None,'records','uncheckable','중복 ID를 경유하는 대상·순서 검사는 검사 불가','uncheckable')
    def topics(rid,path,values):
        if len(values)!=len(set(values)) or any(t not in INITIAL_TOPICS or t=='basic.name' for t in values):
            add(rid,path,'invalid_topic','Invalid topic or duplicate topic')
    def evidence(rid,path,values):
        if len(values)!=len(set(values)):add(rid,path,'duplicate_evidence','Duplicate evidence reference')
        for n,value in enumerate(values):
            if value not in ctx.evidence:add(rid,f'{path}.{n}','evidence_reference',f'Invalid evidence reference: {value}')
        if len(values)>8:add(rid,path,'destination_limit','근거 수가 기존 Core 후보 계약의 최대 8개를 초과함')
    # A malformed text field must not hide an independently readable bad reference.
    used=set()
    for path,row in raw_rows:
        rid=row.get('id') if isinstance(row.get('id'),str) else None
        values=row.get('topics',[])
        if isinstance(values,list) and all(isinstance(v,str) for v in values):
            topics(rid,path+'.topics',values);used.update(values)
        for field in ('evidence','order_evidence'):
            values=row.get(field,[])
            if isinstance(values,list) and all(isinstance(v,str) for v in values):evidence(rid,path+'.'+field,values)
        refs={f:row.get(f) for f in ('subject','target')}
        if isinstance(row.get('targets'),list):refs.update({f'targets.{i}':v for i,v in enumerate(row['targets'])})
        for field,value in refs.items():
            if not isinstance(value,str):continue
            if value in duplicates|unreadable:add(rid,path+'.'+field,'uncheckable','중복 ID 또는 참조 대상 구조 오류로 검사 불가','uncheckable')
            elif value not in entities:add(rid,path+'.'+field,'entity_reference','Invalid entity reference: '+value)
    pairs={'child_of':('character','character'),'sibling_of':('character','character'),
           'spouse_of':('character','character'),'trusts':('character','character'),
           'hostile_to':('character','character'),'member_of':('character','organization'),
           'leads':('character','organization'),'can_use':('character','ability')}
    for path,r in valid:
        rid=getattr(r,'id',None)
        if isinstance(r,NewEntity) and (not r.name.strip() or len(r.name)>100):add(rid,path+'.name','entity_name','Invalid entity name')
        if isinstance(r,Statement) and r.kind=='claim' and r.subject not in duplicates and entities.get(r.subject)!='character':
            add(rid,path+'.subject','claim_speaker','Missing claim speaker; use unresolved')
        if isinstance(r,Relation) and r.subject in entities and r.target in entities:
            pair=(entities[r.subject],entities[r.target])
            good=pair==pairs.get(r.predicate) if r.predicate!='located_in' else pair[0] in {'character','location','organization'} and pair[1]=='location'
            if not good or r.subject==r.target:add(rid,path+'.predicate','relation_types','Invalid relation types')
        if isinstance(r,Event):
            # Preserve Core's primary history category contract, not an all-history restriction.
            if r.topics and not any(t.startswith('history.') for t in r.topics):
                add(rid,path+'.topics','category_topic','초기 역사 사건의 주 분류와 topics가 일치하지 않음')
            if r.after=='':add(rid,path+'.after','invalid_event_order','Invalid event order: empty predecessor ID')
            if r.after and not r.order_evidence:add(rid,path+'.order_evidence','invalid_event_order','Invalid event order: missing order evidence')
            seen={rid};prev=r.after
            while prev:
                if prev in duplicates|unreadable:
                    add(rid,path+'.after','uncheckable','중복 ID 또는 선행 사건 구조 오류로 순서 검사 불가','uncheckable');break
                if prev not in events:
                    add(rid,path+'.after','invalid_event_order','Invalid event order: '+prev);break
                if prev in seen:
                    add(rid,path+'.after','event_cycle','Cyclic event order');break
                seen.add(prev);prev=events[prev].after
    absent=raw.get('input_review')
    if isinstance(absent,list) and all(isinstance(t,str) for t in absent):
        topics(None,'input_review',absent)
        for t in absent:
            if t in used:add(None,'input_review','absence_conflict','Input absence conflicts with records or unresolved: '+t)
    return diagnostics


def check_schema_limits(schema):
    # Official Structured Outputs budgets, counting shared definitions once.
    totals={'enums':0,'strings':0,'properties':0}
    def walk(node):
        if isinstance(node,dict):
            props=node.get('properties',{});defs=node.get('$defs',{})
            totals['properties']+=len(props)
            totals['strings']+=sum(map(len,props))+sum(map(len,defs))
            values=node.get('enum',[]);size=sum(len(v) for v in values if isinstance(v,str))
            totals['enums']+=len(values);totals['strings']+=size
            if len(values)>250 and size>15000:raise ValueError('Schema enum string limit exceeded')
            if isinstance(node.get('const'),str):totals['strings']+=len(node['const'])
            for value in node.values():walk(value)
        elif isinstance(node,list):
            for value in node:walk(value)
    walk(schema)
    if totals['enums']>1000 or totals['strings']>120000 or totals['properties']>5000:
        raise ValueError('Structured Outputs schema limit exceeded')
    def depth(node,n=0,refs=()):
        if not isinstance(node,dict):return
        if '$ref' in node:
            ref=node['$ref']
            if ref in refs:raise ValueError('Recursive schema unsupported by this contract')
            if not ref.startswith('#/$defs/'):raise ValueError('Unsupported schema reference')
            depth(schema['$defs'][ref.split('/')[-1]],n,(*refs,ref));return
        n+=int(node.get('type') in ('object','array'))
        if n>10:raise ValueError('Schema nesting limit exceeded')
        for child in node.get('properties',{}).values():depth(child,n,refs)
        depth(node.get('items'),n,refs)
        for child in node.get('anyOf',[]):depth(child,n,refs)
    depth(schema)


class RequestOutputSchema(AgentOutputSchema):
    def __init__(self,ctx):
        from .minimal import MinimalOutput
        check_context(ctx)
        super().__init__(MinimalOutput)
        self.ctx=ctx
        ids=[s.id for s in ctx.payload.segments]
        if not ids or len(ids)!=len(set(ids)) or set(ids)!=set(ctx.evidence):
            raise ValueError('Invalid evidence ID dictionary')
        schema=super().json_schema()
        for definition in schema['$defs'].values():
            for name,field in definition.get('properties',{}).items():
                if name in ('evidence','order_evidence'):field['items']={'$ref':'#/$defs/EvidenceId'}
        schema['$defs']['EvidenceId']={'type':'string','enum':ids}
        check_schema_limits(schema)

    def validate_json(self,json_str):
        from .minimal import MinimalOutput
        issues=diagnose(self.ctx,json_str)
        if issues:raise ValidationFailure(issues)
        return MinimalOutput.model_validate_json(json_str)

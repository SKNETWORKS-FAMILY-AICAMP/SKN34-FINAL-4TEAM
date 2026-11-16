import {cardTypePatch} from '../entities/studioCards'
import {newSetting} from '../entities/studioWorld'
import {it,expect,vi} from 'vitest'
import {InitialWorldUseCase} from '../usecases/InitialWorldUseCase'
import {currentCandidate,type Analysis,type Candidate} from '../entities/initialWorld'
import type {InitialWorldRepository} from '../repositories/InitialWorldRepository'
const c:Candidate={localRef:'fact-1',type:'goal',title:'목표',text:'나라를 세우려 한다',subjectId:crypto.randomUUID(),relatedEntityIds:[],provenance:'ai_extraction',evidence:[{sourceId:'world:description',start:0,end:2,quote:'원문',quoteHash:'h'}],relation:null,condition:'',timeText:'',polarity:'asserted'}
const id=crypto.randomUUID(),a:Analysis={analysisId:crypto.randomUUID(),basis:{draftRevision:2,relationshipVersion:1,currentRevisionId:null,inputHash:'h'},executionStatus:'completed',freshness:'current',output:{schemaVersion:'initial-world.v1',candidates:[c],diagnostics:[]},candidateIds:{'fact-1':id},decisions:[]}
function setup(){const mutate=vi.fn();const repo:InitialWorldRepository={mutate,list:vi.fn(),read:vi.fn(),receipt:vi.fn(),pending:()=>null,resume:vi.fn(),acknowledge:vi.fn()};return {mutate,useCase:new InitialWorldUseCase(repo)}}
it('keeps the original candidate immutable and submits a separate author revision without AI evidence',()=>{
 const {useCase,mutate}=setup();useCase.decide('world',a,c,'edit',{...c,text:'작가 수정'},'설명')
 expect(mutate.mock.calls[0][2]).toMatchObject({action:'edit',expectedDecisionSequence:0,editedCandidate:{provenance:'author_revision',evidence:[],text:'작가 수정'},comment:'설명'})
 expect(c.evidence).toHaveLength(1)
})
it.each(['pending','held','rejected'] as const)('blocks latest %s even after an earlier approval',state=>{
 const {useCase,mutate}=setup(),analysis={...a,decisions:[{candidateId:id,candidateRef:c.localRef,sequence:1,state:'approved' as const,content:c},{candidateId:id,candidateRef:c.localRef,sequence:2,state,content:c}]}
 expect(()=>useCase.apply('world',analysis,[id])).toThrow('최신 승인');expect(mutate).not.toHaveBeenCalled()
})
it('uses the latest approval sequence and rejects stale results',()=>{
 const {useCase,mutate}=setup(),analysis={...a,decisions:[{candidateId:id,candidateRef:c.localRef,sequence:3,state:'approved' as const,content:c}]}
 expect(currentCandidate(analysis,c).sequence).toBe(3);useCase.apply('world',analysis,[id]);expect(mutate.mock.calls[0][2]).toEqual({expectedDraftRevision:2,candidates:[{candidateId:id,decisionSequence:3}]})
 expect(()=>useCase.apply('world',{...analysis,freshness:'stale'},[id])).toThrow('재분석')
})

it('does not let an applied semantic card silently change its meaning through the ordinary card type editor',()=>{
 const row=newSetting();row.item={...row.item,kind:'fact',semanticType:'plan'}
 expect(()=>cardTypePatch(row.item,'character',[row])).toThrow('의미')
})

import { expect, it } from 'vitest'
import { newSetting } from '../entities/studioWorld'
import { assertNoNewRelationDuplicates, applyRelationChanges, editStudioSetting, putRelation, removeRelation, relationDefinitions, cardDeletionInfo, removeCard } from '../entities/studioRelations'

it('keeps mutual facts separate from independent directed emotions and stable IDs',()=>{
 const a=newSetting('people'),b=newSetting('people');a.item.title='가람';b.item.title='나래'
 let rows=[a,b]
 rows=putRelation(rows,{subjectId:a.item.id,targetId:b.item.id,predicate:'friend_of',polarity:'asserted'})
 rows=putRelation(rows,{subjectId:a.item.id,targetId:b.item.id,predicate:'trusts',polarity:'asserted'})
 rows=putRelation(rows,{subjectId:b.item.id,targetId:a.item.id,predicate:'wary_of',polarity:'asserted'})
 expect(rows).toHaveLength(5)
 expect(relationDefinitions.trusts.group).toBe('emotion')
 expect(()=>putRelation(rows,{subjectId:b.item.id,targetId:a.item.id,predicate:'friend_of',polarity:'asserted'})).toThrow(/이미/)
 expect(()=>putRelation(rows,{subjectId:a.item.id,targetId:'missing',predicate:'trusts',polarity:'asserted'})).toThrow(/설정/)
 const trust=rows[3].item
 const changed=putRelation(rows,{...trust,polarity:'denied'})
 expect(changed[3].item.id).toBe(trust.id)
 expect(changed[3].item.polarity).toBe('denied')
 expect(removeRelation(changed,trust.id)).toHaveLength(4)
 expect(()=>removeRelation(rows,a.item.id)).toThrow()
 const ref={...a,item:{...a.item,relatedIds:[trust.id]}}
 expect(()=>removeRelation([ref,...rows.slice(1)],trust.id)).toThrow(/참조/)
})

it('applies a multi-relation pair atomically, preserving IDs/prose and removing only explicitly selected records',()=>{
 const a=newSetting('people'),b=newSetting('people');a.item.title='가람';b.item.title='나래'
 let rows=putRelation([a,b],{subjectId:a.item.id,targetId:b.item.id,predicate:'friend_of',polarity:'asserted'})
 rows=putRelation(rows,{subjectId:a.item.id,targetId:b.item.id,predicate:'spouse_of',polarity:'denied',text:'배우자로 오해받지만 아니다.'})
 rows=putRelation(rows,{subjectId:a.item.id,targetId:b.item.id,predicate:'trusts',polarity:'asserted'})
 const before=structuredClone(rows),[friend,spouse,trust]=rows.slice(2).map(s=>s.item)
 expect(applyRelationChanges(rows,[spouse],[])[3]).toBe(rows[3])
 expect(()=>applyRelationChanges(rows,[{...friend,predicate:'likes'},{...trust,predicate:'likes'}],[])).toThrow(/이미/)
 expect(rows).toEqual(before)
 const edited=applyRelationChanges(rows,[{...friend,predicate:'likes'},{subjectId:b.item.id,targetId:a.item.id,predicate:'wary_of',polarity:'asserted'}],[trust.id])
 expect(edited.find(s=>s.item.id===friend.id)?.item.text).toBe('가람 · 호감 · 나래')
 expect(edited.find(s=>s.item.id===spouse.id)).toEqual(rows[3])
 expect(edited.some(s=>s.item.id===trust.id)).toBe(false)
 expect(edited.filter(s=>s.item.kind==='relation')).toHaveLength(3)
 // A pair is a view, not a single fact slot; multiple real relationships remain.
 expect(edited.find(s=>s.item.id===spouse.id)?.item.polarity).toBe('denied')
})

it('rejects stale pair rows after external prose, title or endpoint-name edits without losing the latest settings or draft',()=>{
 const a=newSetting('people'),b=newSetting('people');a.item.title='가람';b.item.title='나래'
 const rows=putRelation([a,b],{subjectId:a.item.id,targetId:b.item.id,predicate:'friend_of',polarity:'asserted'})
 const relation=rows[2].item,stale={...relation,baseline:{...relation}}
 const changes=[stale,{subjectId:b.item.id,targetId:a.item.id,predicate:'custom_emotion',polarity:'asserted' as const,text:'아직 입력 중인 감정'}]
 for(const [id,patch] of [[relation.id,{text:'설정 작성에서 고친 최신 설명'}],[relation.id,{title:'설정 작성에서 고친 최신 이름'}],[a.item.id,{title:'가람 수정'}]] as const) {
  const latest=editStudioSetting(rows,id,patch),before=structuredClone(latest),draft=structuredClone(changes)
  expect(()=>applyRelationChanges(latest,changes,[])).toThrow(/다른.*변경/)
  expect(latest).toEqual(before)
  expect(changes).toEqual(draft)
 }
})

it('accepts current baselines across save clones and unrelated edits while preserving relation IDs and prose',()=>{
 const a=newSetting('people'),b=newSetting('people'),note=newSetting();a.item.title='가람';b.item.title='나래'
 const rows=putRelation([a,b,note],{subjectId:a.item.id,targetId:b.item.id,predicate:'custom_relation',polarity:'asserted',text:'오랜 동료이자 경쟁자'})
 const relation=rows[3].item
 const latest=editStudioSetting(structuredClone(rows),note.item.id,{text:'관계 밖에서 수정한 메모'})
 const changed=applyRelationChanges(latest,[{...relation,baseline:{...relation}},{subjectId:b.item.id,targetId:a.item.id,predicate:'custom_emotion',polarity:'asserted',text:'믿고 있지만 경계한다.'}],[])
 expect(changed[3]).toBe(latest[3])
 expect(changed[3].item).toEqual(relation)
 expect(changed[2].item.text).toBe('관계 밖에서 수정한 메모')
 expect(changed[4].item.text).toBe('믿고 있지만 경계한다.')
 expect(changed[4].item).not.toHaveProperty('baseline')
})

it('preserves free relationship and compound emotion prose without coercing it to legacy predicates',()=>{
 const a=newSetting('people'),b=newSetting('people');a.item.title='아버지';b.item.title='홍길동'
 const prose='존경하고 인정받고 싶지만 차별에는 분노한다.\n가족이기에 더 두렵다.'
 const rows=applyRelationChanges([a,b],[{subjectId:a.item.id,targetId:b.item.id,predicate:'custom_relation',polarity:'asserted',text:'아버지와 서자, 인정받지 못한 가족'},{subjectId:b.item.id,targetId:a.item.id,predicate:'custom_emotion',polarity:'asserted',text:prose}],[])
 expect(rows[2].item.predicate).toBe('custom_relation')
 expect(rows[3].item).toMatchObject({predicate:'custom_emotion',text:prose,authorText:prose})
 expect(editStudioSetting(rows,a.item.id,{title:'홍 판서'})[3].item.text).toBe(prose)
})

it('synchronizes exact generated fields on structure/name edits and preserves independent author prose',()=>{
 const a=newSetting('people'),b=newSetting('people'),c=newSetting('people')
 a.item.title='가람';b.item.title='나래';c.item.title='다온'
 let rows=putRelation([a,b,c],{subjectId:a.item.id,targetId:b.item.id,predicate:'friend_of',polarity:'asserted'})
 const id=rows[3].item.id
 rows=editStudioSetting(rows,id,{predicate:'trusts'})
 expect(rows[3].item).toMatchObject({id,title:'가람 · 신뢰 · 나래',text:'가람 · 신뢰 · 나래',authorText:'가람 · 신뢰 · 나래'})
 rows=editStudioSetting(rows,a.item.id,{title:'가람 수정'})
 expect(rows[3].item.text).toBe('가람 수정 · 신뢰 · 나래')
 rows=editStudioSetting(rows,id,{subjectId:b.item.id,targetId:c.item.id,polarity:'denied'})
 expect(rows[3].item.text).toBe('나래 · 신뢰 아님 · 다온')
 rows=editStudioSetting(rows,id,{targetId:null})
 rows=editStudioSetting(rows,id,{targetId:a.item.id})
 expect(rows[3].item.text).toBe('나래 · 신뢰 아님 · 가람 수정')
 rows=editStudioSetting(rows,id,{text:'예전에는 친구였으나 지금은 경계한다.'})
 rows=editStudioSetting(rows,id,{predicate:'wary_of'})
 expect(rows[3].item.title).toBe('나래 · 경계 아님 · 가람 수정')
 expect(rows[3].item.text).toBe('예전에는 친구였으나 지금은 경계한다.')
 rows=editStudioSetting(rows,id,{title:'두 사람의 약속'})
 rows=editStudioSetting(rows,b.item.id,{title:'나래 수정'})
 expect(rows[3].item.title).toBe('두 사람의 약속')
 expect(rows[3].item.text).toBe('예전에는 친구였으나 지금은 경계한다.')
 // An already inconsistent or legacy description is not guessed from its old words.
 rows[3].item.title='나래 · 친구 · 가람'
 rows=editStudioSetting(rows,id,{predicate:'likes'})
 expect(rows[3].item.title).toBe('나래 · 친구 · 가람')
})

it('connects setting cards beyond characters and rejects an incomplete edit',()=>{
 const person=newSetting('people'),place=newSetting('places');person.item.title='가람';place.item.title='항구'
 const rows=putRelation([person,place],{subjectId:person.item.id,targetId:place.item.id,predicate:'custom_relation_directed',polarity:'asserted',text:'지키는 장소'})
 expect(rows[2].item).toMatchObject({subjectId:person.item.id,targetId:place.item.id})
 expect(()=>putRelation(rows,{...rows[2].item,text:''})).toThrow()
 expect(()=>putRelation(rows,{...rows[2].item,targetId:null})).toThrow()
})

it('previews incident links and blocks person deletion when unrelated settings reference that person',()=>{
 const a=newSetting('people'),b=newSetting('people');a.item.title='가람';b.item.title='나래'
 const rows=putRelation([a,b],{subjectId:a.item.id,targetId:b.item.id,predicate:'custom_relation',polarity:'asserted',text:'오랜 동료이자 경쟁자'})
 const note=newSetting();note.item.title='가람의 계약';note.item.relatedIds=[a.item.id]
 expect(cardDeletionInfo(rows,a.item.id).relations).toHaveLength(1)
 expect(removeCard(rows,a.item.id)).toEqual([b])
 expect(()=>removeCard([...rows,note],a.item.id)).toThrow(/가람의 계약/)
 expect(rows).toHaveLength(3)
})

it('deletes a card of any type together with its relations, and refuses one that another setting still references',()=>{
 const garam=newSetting('people'),harbor=newSetting('places'),memo=newSetting('notes');garam.item.title='가람';harbor.item.title='항구';memo.item.title='메모'
 const rows=putRelation([garam,harbor,memo],{subjectId:garam.item.id,targetId:harbor.item.id,predicate:'custom_relation_directed',polarity:'asserted',text:'지키는 장소'})
 const info=cardDeletionInfo(rows,harbor.item.id)
 expect(info.card).toBe(harbor);expect(info.relations.map(r=>r.item.id)).toEqual([rows[3].item.id]);expect(info.blockers).toEqual([])
 expect(removeCard(rows,harbor.item.id)).toEqual([garam,memo]) // 장소 카드와 거기 이어진 관계가 함께 빠진다
 expect(removeCard(rows,memo.item.id)).toEqual([garam,harbor,rows[3]]) // 메모도 지울 수 있다
 const ref=newSetting();ref.item.title='항구 기록';ref.item.relatedIds=[harbor.item.id]
 expect(()=>removeCard([...rows,ref],harbor.item.id)).toThrow(/항구 기록/)
 expect(()=>removeCard(rows,'missing')).toThrow('삭제할 설정을 찾을 수 없습니다.')
 expect(rows).toHaveLength(4)
})


it.each(['pending','held','rejected'] as const)('preserves metadata when only labels change for %s items',decision=>{
 const row=newSetting('people');row.item.title='근거가 있는 인물';row.item.text='작성된 원문';row.item.origin='extraction';row.item.decision=decision
 row.item.authorText='기존 원문';row.item.evidence=[{sourceId:'source',quote:'인용'}];row.item.orderEvidence=[{sourceId:'history',quote:'순서'}]
 const original=structuredClone(row),labels=[{tags:['새 태그']},{aliases:['별칭']},{userCategory:'새 분류'}]
 for(const label of labels){
  const result=editStudioSetting([row],row.item.id,{},label)[0]
  expect(result.item).toEqual(original.item)
  expect(result).toMatchObject(label)
 }
 expect(editStudioSetting([row],row.item.id,{title:row.item.title},{tags:['변경']})[0].item).toEqual(original.item)
 const edited=editStudioSetting([row],row.item.id,{text:'작성자가 고친 원문'})[0]
 expect(edited.item).toMatchObject({origin:'author_addition',decision:'approved',text:'작성자가 고친 원문',evidence:[],orderEvidence:[]})
 expect(row).toEqual(original)
})

it('rejects only newly introduced relation identity duplicates while preserving existing data and drafts',()=>{
 const a=newSetting('people'),b=newSetting('people');a.item.title='가람';b.item.title='나래'
 let saved=putRelation([a,b],{subjectId:a.item.id,targetId:b.item.id,predicate:'custom_relation',polarity:'asserted',text:'동료'})
 saved=putRelation(saved,{subjectId:a.item.id,targetId:b.item.id,predicate:'custom_relation',polarity:'asserted',text:'경쟁자'})
 const first=saved[2].item,second=saved[3].item
 const draft=editStudioSetting(saved,second.id,{text:'동료'}),before=structuredClone(draft)
 expect(()=>assertNoNewRelationDuplicates(draft,saved)).toThrow(/이미/)
 expect(draft).toEqual(before)
 expect(draft[3].item.id).toBe(second.id)
 const legacy=structuredClone(draft)
 expect(()=>assertNoNewRelationDuplicates(legacy,legacy)).not.toThrow()
 const legacyTitleEdit=editStudioSetting(legacy,first.id,{title:'기존 관계 이름'})
 expect(()=>assertNoNewRelationDuplicates(legacyTitleEdit,legacy)).not.toThrow()
 const duplicateThird={...structuredClone(legacy[2]),item:{...structuredClone(legacy[2].item),id:crypto.randomUUID()}}
 expect(()=>assertNoNewRelationDuplicates([...legacy,duplicateThird],legacy)).toThrow(/이미/)
 const changedTogether=legacy.map(s=>s.item.kind==='relation'?{...s,item:{...s.item,text:'새로운 중복'}}:s)
 expect(()=>assertNoNewRelationDuplicates(changedTogether,legacy)).toThrow(/이미/)
})

it('uses existing relation direction and polarity semantics in duplicate checks',()=>{
 const a=newSetting('people'),b=newSetting('people');a.item.title='가람';b.item.title='나래'
 const base=putRelation([a,b],{subjectId:a.item.id,targetId:b.item.id,predicate:'friend_of',polarity:'asserted'})
 const r=base[2]
 const reverse={...structuredClone(r),item:{...structuredClone(r.item),id:crypto.randomUUID(),subjectId:b.item.id,targetId:a.item.id}}
 expect(()=>assertNoNewRelationDuplicates([...base,reverse],base)).toThrow(/이미/)
 const denied={...reverse,item:{...reverse.item,polarity:'denied' as const}}
 expect(()=>assertNoNewRelationDuplicates([...base,denied],base)).not.toThrow()
 const directed={...r,item:{...r.item,predicate:'custom_relation_directed',text:'따라간다'}}
 const directedReverse={...reverse,item:{...reverse.item,predicate:'custom_relation_directed',text:'따라간다'}}
 expect(()=>assertNoNewRelationDuplicates([a,b,directed,directedReverse],[])).not.toThrow()
})

it('allows editing existing duplicate compatibility rows but rejects new panel collisions atomically',()=>{
 const a=newSetting('people'),b=newSetting('people');a.item.title='가람';b.item.title='나래'
 const initial=putRelation([a,b],{subjectId:a.item.id,targetId:b.item.id,predicate:'custom_relation',polarity:'asserted',text:'동료'})
 const copy={...structuredClone(initial[2]),item:{...structuredClone(initial[2].item),id:crypto.randomUUID()}}
 const legacy=[...initial,copy],before=structuredClone(legacy)
 const updated=applyRelationChanges(legacy,[{...legacy[2].item,title:'유지할 새 이름'}],[])
 expect(updated[2].item).toMatchObject({id:legacy[2].item.id,text:'동료',title:'유지할 새 이름'})
 expect(updated[3]).toEqual(legacy[3])
 expect(legacy).toEqual(before)
 expect(()=>applyRelationChanges(legacy,[{subjectId:a.item.id,targetId:b.item.id,predicate:'custom_relation',polarity:'asserted',text:'동료'}],[])).toThrow(/이미/)
 expect(legacy).toEqual(before)
})

it('restores automatic names for cleared relation titles without changing IDs or prose',()=>{
 const a=newSetting('people'),b=newSetting('people');a.item.title='가람';b.item.title='나래'
 const input={subjectId:a.item.id,targetId:b.item.id,predicate:'custom_relation',polarity:'asserted' as const,text:'동료'}
 const automatic=putRelation([a,b],input)[2].item
 const cleared=putRelation([a,b],{...input,title:''})[2].item
 expect(cleared.title).toBe(automatic.title)
 expect(cleared.text).toBe('동료')
 const manual=putRelation([a,b],{...input,title:'직접 적은 이름'})
 const existing=manual[2].item
 const restored=applyRelationChanges(manual,[{...existing,title:''}],[])[2].item
 expect(restored).toMatchObject({id:existing.id,title:automatic.title,text:'동료'})
 expect(manual[2].item.title).toBe('직접 적은 이름')
})

it('allows atomic relation identity exchanges without changing relation IDs',()=>{
 const a=newSetting('people'),b=newSetting('people');a.item.title='가람';b.item.title='나래'
 let settings=putRelation([a,b],{subjectId:a.item.id,targetId:b.item.id,predicate:'friend_of',polarity:'asserted'})
 settings=putRelation(settings,{subjectId:a.item.id,targetId:b.item.id,predicate:'spouse_of',polarity:'asserted'})
 const first=settings[2].item,second=settings[3].item
 const changed=applyRelationChanges(settings,[{...first,predicate:'spouse_of'},{...second,predicate:'friend_of'}],[])
 expect(changed[2].item).toMatchObject({id:first.id,predicate:'spouse_of'})
 expect(changed[3].item).toMatchObject({id:second.id,predicate:'friend_of'})
})


it('compares pair edits against the saved state rather than a temporarily duplicated draft',()=>{
 const a=newSetting('people'),b=newSetting('people');a.item.title='가람';b.item.title='나래'
 let saved=putRelation([a,b],{subjectId:a.item.id,targetId:b.item.id,predicate:'custom_relation',polarity:'asserted',text:'동료'})
 saved=putRelation(saved,{subjectId:a.item.id,targetId:b.item.id,predicate:'custom_relation',polarity:'asserted',text:'경쟁자'})
 const draft=editStudioSetting(saved,saved[3].item.id,{text:'동료'}),before=structuredClone(draft)
 expect(()=>applyRelationChanges(draft,[{...draft[2].item,title:'고친 이름'}],[],saved)).toThrow(/이미/)
 const unrelated={subjectId:b.item.id,targetId:a.item.id,predicate:'custom_emotion',polarity:'asserted' as const,text:'믿는다'}
 expect(()=>applyRelationChanges(draft,[unrelated],[],saved)).toThrow(/이미/)
 expect(draft).toEqual(before)
})

it('allows unrelated single edits of legacy duplicates without changing ids or text',()=>{
 const a=newSetting('people'),b=newSetting('people');a.item.title='가람';b.item.title='나래'
 const base=putRelation([a,b],{subjectId:a.item.id,targetId:b.item.id,predicate:'custom_relation',polarity:'asserted',text:'동료'})
 const copy={...structuredClone(base[2]),item:{...structuredClone(base[2].item),id:crypto.randomUUID()}}
 const legacy=[...base,copy],before=structuredClone(legacy)
 const updated=putRelation(legacy,{...legacy[2].item,title:'고친 이름'})
 expect(updated[2].item).toMatchObject({id:legacy[2].item.id,title:'고친 이름',text:'동료'})
 expect(updated[3]).toEqual(legacy[3])
 expect(legacy).toEqual(before)
})

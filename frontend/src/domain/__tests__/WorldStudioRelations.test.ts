import { expect, it } from 'vitest'
import { newSetting } from '../entities/studioWorld'
import { applyRelationChanges, editStudioSetting, putRelation, removeRelation, relationDefinitions, personDeletionInfo, removePerson } from '../entities/studioRelations'

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
 expect(personDeletionInfo(rows,a.item.id).relations).toHaveLength(1)
 expect(removePerson(rows,a.item.id)).toEqual([b])
 expect(()=>removePerson([...rows,note],a.item.id)).toThrow(/가람의 계약/)
 expect(rows).toHaveLength(3)
})

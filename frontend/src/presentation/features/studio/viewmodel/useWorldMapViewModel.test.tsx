// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'
import { newSetting, type StudioSetting } from '../../../../domain/entities/studioWorld'
import { buildWorldMap, useWorldMapViewModel } from './useWorldMapViewModel'

afterEach(cleanup)
it('keeps the other person visible through a relationship node, without expanding unrelated neighbors',()=>{
 const a=setting('a'),b=setting('b'),r=setting('r'),c=setting('c')
 r.item={...r.item,kind:'relation',subjectId:'a',targetId:'b'}
 b.item.relatedIds=['c']
 const {result}=renderHook(()=>useWorldMapViewModel([a,b,r,c]))
 act(()=>result.current.select('a'))
 expect([...result.current.neighbors].sort()).toEqual(['a','b','r'])
})
it('describes event chronology from the selected event',()=>{
 const a=setting('a'),b=setting('b');a.item.kind='event';b.item.kind='event';b.item.afterId='a'
 const {result}=renderHook(()=>useWorldMapViewModel([a,b]))
 act(()=>result.current.select('a'))
 expect(result.current.connections[0].label).toBe('이후 사건')
 act(()=>result.current.select('b'))
 expect(result.current.connections[0].label).toBe('이전 사건')
})
function setting(id:string,title=id):StudioSetting {
 const s=newSetting('people');s.item.id=id;s.item.title=title;return s
}
it('maps only approved settings and explicit links, preserving negation and dangling references',()=>{
 const a=setting('a','가람'),b=setting('b','나루'),r=setting('r','신뢰 아님'),pending=setting('p')
 pending.item.decision='pending'
 r.item={...r.item,kind:'relation',subjectId:'a',targetId:'b',predicate:'trusts',polarity:'denied'}
 a.item.relatedIds=['b','b','missing','p']
 b.item.afterId='a'
 const settings=[a,b,r,pending],before=structuredClone(settings)
 const graph=buildWorldMap(settings)
 expect(graph.nodes.map(n=>n.id)).toEqual(['a','b','r'])
 expect(graph.links.map(l=>[l.source,l.target,l.label])).toEqual([
  ['a','b','관련 설정'],['a','b','이후 사건'],['a','r','관계 주체'],['r','b','신뢰 아님'],
 ])
 expect(graph.missingLinks).toBe(2)
 graph.nodes[0].x=100
 graph.links[0].source=graph.nodes[0]
 expect(settings).toEqual(before)
})
it('searches title, text and tags without changing the saved graph; resets selection on replacement',()=>{
 const a=setting('a','가람');a.tags=['북부'];const b=setting('b','나루');b.item.text='항구 기록관'
 const {result,rerender}=renderHook(({settings})=>useWorldMapViewModel(settings),{initialProps:{settings:[a,b]}})
 act(()=>result.current.setQuery('북부'))
 expect(result.current.results.map(n=>n.id)).toEqual(['a'])
 expect(result.current.graph.nodes).toHaveLength(2)
 act(()=>{result.current.select('a');result.current.setQuery('항구')})
 expect(result.current.results.map(n=>n.id)).toEqual(['b'])
 rerender({settings:[b]})
 expect(result.current.selected).toBeNull()
})

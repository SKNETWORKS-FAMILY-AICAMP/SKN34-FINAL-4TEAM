// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { newSetting, type StudioWorld } from '../../../../domain/entities/studioWorld'
import { WorldMap } from './WorldMap'
import {putRelation} from '../../../../domain/entities/studioRelations'
import { act, renderHook } from '@testing-library/react'
import { useWorldMapViewModel } from '../viewmodel/useWorldMapViewModel'

vi.mock('react-force-graph-2d',()=>({default:()=> <div aria-label="그래프 캔버스"/>}))
afterEach(()=>{cleanup();vi.unstubAllGlobals();vi.unstubAllEnvs()})
it('expands the presentation map and closes it with Escape',()=>{
 vi.stubEnv('MODE','mockup')
 vi.stubGlobal('ResizeObserver',class{observe(){}disconnect(){}})
 const a=newSetting('people');a.item.title='길동'
 render(<WorldMap world={{id:'demo',version:1,name:'세계',description:'',settings:[a],analysis:null}}/> )
 fireEvent.click(screen.getByRole('button',{name:'지도 넓게 보기'}))
 const map=screen.getByRole('region',{name:'전체 세계관 지도'})
 expect(map.classList.contains('world-map-expanded')).toBe(true)
 fireEvent.keyDown(map,{key:'Escape'})
 expect(map.classList.contains('world-map-expanded')).toBe(false)
})
it('keeps a related person in focus through a relation node without expanding unrelated settings',()=>{
 const a=newSetting('people'),b=newSetting('people'),place=newSetting('places')
 b.item.relatedIds=[place.item.id]
 const settings=putRelation([a,b,place],{subjectId:a.item.id,targetId:b.item.id,predicate:'child_of',polarity:'asserted'})
 const {result}=renderHook(()=>useWorldMapViewModel(settings))
 act(()=>result.current.select(a.item.id))
 expect(result.current.neighbors.has(b.item.id)).toBe(true)
 expect(result.current.neighbors.has(place.item.id)).toBe(false)
})
it('provides keyboard-accessible search and details for saved data, and an empty state',async()=>{
 vi.stubGlobal('ResizeObserver',class{observe(){}disconnect(){}})
 const a=newSetting('people');a.item.title='가람';a.item.text='북부 기록관';a.tags=['항구']
 const world:StudioWorld={id:'w',version:1,name:'바다',description:'',settings:[a],analysis:null}
 const {rerender}=render(<WorldMap world={world}/> )
 fireEvent.click(screen.getByRole('button',{name:'가람 인물'}))
 expect(screen.getByRole('heading',{name:'가람'})).toBeTruthy()
 fireEvent.change(screen.getByRole('searchbox',{name:'설정 검색'}),{target:{value:'없는설정'}})
 expect(screen.getByText('일치하는 설정이 없습니다.')).toBeTruthy()
 fireEvent.click(screen.getByRole('button',{name:'검색 조건 초기화'}))
 expect(screen.getByRole('button',{name:'가람 인물'})).toBeTruthy()
 rerender(<WorldMap key="new-world" world={{...world,id:'new-world',settings:[]}}/> )
 expect(screen.getByText('저장된 설정이 없습니다.')).toBeTruthy()
 expect(screen.queryByRole('heading',{name:'가람'})).toBeNull()
})

it('shows complete directed relationships from both selected characters',()=>{
 vi.stubGlobal('ResizeObserver',class{observe(){}disconnect(){}})
 const a=newSetting('people'),b=newSetting('people')
 a.item.title='가람';b.item.title='나래'
 const full='부모가 자녀를 보호하고 양육하는 관계'
 const settings=putRelation([a,b],{subjectId:a.item.id,targetId:b.item.id,predicate:'custom_relation_directed',polarity:'asserted',text:full})
 const world:StudioWorld={id:'w',version:1,name:'세계',description:'',settings,analysis:null}
 render(<WorldMap world={world} charactersOnly/>)
 fireEvent.click(screen.getByRole('button',{name:'가람 인물'}))
 expect(screen.getByText('보내는 관계 · '+full)).toBeTruthy()
 fireEvent.click(screen.getByRole('button',{name:'나래 인물'}))
 expect(screen.getByText('받는 관계 · '+full)).toBeTruthy()
})

// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { Provider } from 'react-redux'
import { MemoryRouter } from 'react-router'
import { afterEach, expect, it, vi } from 'vitest'
import App from './App'
import { createAppStore } from './app/store'
import { newSetting, type SettingItem, type StudioWorld } from './domain/entities/studioWorld'

afterEach(()=>{cleanup();vi.unstubAllGlobals();vi.restoreAllMocks()})
it('keeps drafts and candidates out of saved views, renders approved relations with polarity and preserves them after failure',async()=>{
 const personA=newSetting('people'),personB=newSetting('people')
 personA.item={...personA.item,title:'가람',text:'등대지기',authorText:'등대지기'}
 personB.item={...personB.item,title:'나래',text:'항해사',authorText:'항해사'}
 const item=(patch:Partial<SettingItem>):SettingItem=>({...newSetting().item,title:'후보',text:'원문',authorText:'원문',decision:'pending',...patch})
 const trust=item({kind:'relation',title:'가람의 신뢰',text:'가람은 나래를 신뢰한다.',subjectId:personA.item.id,targetId:personB.item.id,predicate:'trusts'})
 const denied=item({kind:'relation',title:'적대하지 않음',text:'가람은 나래를 적대하지 않는다.',subjectId:personA.item.id,targetId:personB.item.id,predicate:'hostile_to',polarity:'denied'})
 const event=item({kind:'event',title:'등대 건립',text:'100년 전 등대가 건립되었다.',category:'history',timeText:'100년 전'})
 let persisted:StudioWorld={id:'confirmed-world',name:'확정 분리 검증',description:'합성 자료',version:1,settings:[personA,personB],analysis:{id:'run',status:'review',candidates:[trust,denied,event],issues:[]}}
 const fetcher=vi.fn(async(url:RequestInfo|URL,init?:RequestInit)=>{
  const path=String(url)
  if(path.endsWith('/approve')) {
   const body=JSON.parse(String(init?.body))
   expect(body.ids.sort()).toEqual([trust.id,denied.id,event.id].sort())
   persisted={...persisted,version:2,settings:[...persisted.settings,...[trust,denied,event].map(i=>({item:{...i,decision:'approved' as const},userCategory:'설정',tags:[]}))]}
  }
  if(path.endsWith('/analyze'))persisted={...persisted,version:3,analysis:{id:'failed',status:'failed',candidates:[],issues:['합성 분석 실패']}}
  return new Response(JSON.stringify(path.endsWith('/capabilities')?{aiEnabled:true}:path.endsWith('/worlds')?[persisted]:persisted))
 })
 vi.stubGlobal('fetch',fetcher);vi.spyOn(window,'confirm').mockReturnValue(true)
 render(<Provider store={createAppStore({role:'user'})}><MemoryRouter initialEntries={['/worlds/confirmed-world']}><App/></MemoryRouter></Provider>)
 await screen.findByRole('heading',{name:'확정 분리 검증',level:2})
 const tool=(name:string)=>fireEvent.click(within(screen.getByRole('navigation',{name:'세계관 도구'})).getByRole('button',{name}))
 fireEvent.click(within(screen.getByRole('navigation',{name:'설정 작성 메뉴'})).getByRole('button',{name:'인물 2개'}))
 fireEvent.change(screen.getByLabelText('항목 이름'),{target:{value:'저장하지 않은 이름'}})
 tool('설정집');expect(screen.queryByText('저장하지 않은 이름')).toBeNull();expect(screen.getByRole('heading',{name:'가람'})).toBeTruthy()
 expect(screen.queryByText(trust.text)).toBeNull();expect(screen.queryByText(event.text)).toBeNull()
 tool('인물 관계도');expect(screen.queryByText(trust.text)).toBeNull()
 tool('초기 역사 시간선');expect(screen.queryByText(event.text)).toBeNull()
 fireEvent.click(within(screen.getByRole('navigation',{name:'내 세계관'})).getByRole('button',{name:/확정 분리 검증/}))
 await waitFor(()=>expect(screen.getByRole<HTMLButtonElement>('button',{name:'저장'}).disabled).toBe(true))
 tool('AI 후보 검토')
 for(const title of ['가람의 신뢰','적대하지 않음','등대 건립'])fireEvent.click(screen.getByRole('checkbox',{name:new RegExp('후보 선택.*'+title)}))
 fireEvent.click(screen.getByRole('button',{name:'선택한 후보 확정'}))
 await waitFor(()=>expect(persisted.version).toBe(2))
 await waitFor(()=>expect(screen.getByRole<HTMLButtonElement>('button',{name:'저장'}).disabled).toBe(true))
 tool('인물 관계도');expect(screen.getByRole('heading',{name:'가람 → 신뢰 → 나래'})).toBeTruthy();expect(screen.getByRole('heading',{name:'가람 → 적대 아님 → 나래'})).toBeTruthy()
 tool('초기 역사 시간선');expect(screen.getByRole('heading',{name:'등대 건립'})).toBeTruthy()
 const savedIds=persisted.settings.map(s=>s.item.id)
 tool('AI 후보 검토');fireEvent.click(screen.getByRole('checkbox',{name:'저장한 설정의 외부 AI 처리를 요청합니다.'}));fireEvent.click(screen.getByRole('button',{name:'AI 분석 요청'}))
 await screen.findByText('합성 분석 실패');expect(persisted.settings.map(s=>s.item.id)).toEqual(savedIds)
 tool('설정집');expect(screen.getByText(trust.text)).toBeTruthy()
 fireEvent.click(within(screen.getByRole('navigation',{name:'위키 문서 목록'})).getByRole('button',{name:'등대 건립'}))
 expect(screen.getByText(event.text)).toBeTruthy()
 tool('인물 관계도');expect(screen.getByRole('heading',{name:'가람 → 신뢰 → 나래'})).toBeTruthy()
 tool('초기 역사 시간선');expect(screen.getByRole('heading',{name:'등대 건립'})).toBeTruthy()
},20000)

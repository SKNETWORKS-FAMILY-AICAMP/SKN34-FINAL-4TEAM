// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { Provider } from 'react-redux'
import { MemoryRouter } from 'react-router'
import { afterEach, expect, it, vi } from 'vitest'
import App from './App'
import { createAppStore } from './app/store'
import { newSetting, type StudioWorld } from './domain/entities/studioWorld'

vi.mock('./presentation/features/studio/view/WorldMapCanvas',()=>({default:()=> <div>그래프 렌더러</div>}))
afterEach(()=>{cleanup();vi.unstubAllGlobals()})
it('keeps unsaved edits out of the map and updates the map only after Core save',async()=>{
 const person=newSetting('people');person.item.title='저장된 인물'
 let saved:StudioWorld={id:'map-world',name:'지도 테스트',description:'',version:1,settings:[person],analysis:null}
 vi.stubGlobal('fetch',vi.fn(async(url:RequestInfo|URL,init?:RequestInit)=>{
  if(init?.method==='PUT')saved={...JSON.parse(String(init.body)),version:saved.version+1}
  const path=String(url)
  return new Response(JSON.stringify(path.endsWith('/capabilities')?{aiEnabled:false}:path.endsWith('/worlds')?[saved]:saved))
 }))
 render(<Provider store={createAppStore({role:'user'})}><MemoryRouter initialEntries={['/worlds/map-world']}><App/></MemoryRouter></Provider>)
 await screen.findByRole('heading',{name:'지도 테스트'})
 fireEvent.click(screen.getByRole('button',{name:'인물 1개'}))
 fireEvent.change(screen.getByLabelText('항목 이름'),{target:{value:'아직 저장하지 않은 인물'}})
 fireEvent.click(screen.getByRole('button',{name:'세계관 탐색'}))
 fireEvent.click(screen.getByRole('button',{name:'전체 세계관 지도'}))
 const list=screen.getByRole('navigation',{name:'지도 설정 목록'})
 expect(within(list).getByRole('button',{name:'저장된 인물 인물'})).toBeTruthy()
 expect(within(list).queryByRole('button',{name:'아직 저장하지 않은 인물 인물'})).toBeNull()
 fireEvent.click(screen.getByRole('button',{name:'저장'}))
 expect(await screen.findByRole('button',{name:'아직 저장하지 않은 인물 인물'})).toBeTruthy()
 fireEvent.click(screen.getByRole('button',{name:'설정 작성'}))
 fireEvent.click(screen.getByRole('button',{name:'인물 1개'}))
 expect((screen.getByLabelText('항목 이름') as HTMLInputElement).value).toBe('아직 저장하지 않은 인물')
})

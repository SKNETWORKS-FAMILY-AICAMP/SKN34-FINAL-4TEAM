// @vitest-environment jsdom
import {cleanup,fireEvent,render,screen} from '@testing-library/react'
import {Provider} from 'react-redux'
import {MemoryRouter} from 'react-router'
import {afterEach,expect,it,vi} from 'vitest'
import App from './App'
import {createAppStore} from './app/store'

afterEach(()=>{cleanup();vi.unstubAllGlobals()})
it('keeps the world list open across tabs and preserves an explicit collapse until expanded',async()=>{
 const world={id:'sidebar-world',name:'목록 유지 검증',description:'',version:1,settings:[],analysis:null}
 vi.stubGlobal('fetch',vi.fn(async(url:RequestInfo|URL)=>new Response(JSON.stringify(String(url).endsWith('/capabilities')?{aiEnabled:false}:String(url).endsWith('/worlds')?[world]:world))))
 render(<Provider store={createAppStore({role:'user'})}><MemoryRouter initialEntries={['/worlds/sidebar-world']}><App/></MemoryRouter></Provider>)
 await screen.findByRole('heading',{name:world.name})
 const list=screen.getByRole('navigation',{name:'내 세계관'})
 const tabs=['관계 편집','세계관 탐색','전체 세계관 지도','설정집','인물 관계도','초기 역사 시간선','AI 후보 검토','설정 작성']
 for(const name of tabs){
  fireEvent.click(screen.getByRole('button',{name}))
  expect(list.closest('aside')?.hidden).toBe(false)
  expect(screen.getByRole('button',{name:'세계관 목록 접기'}).getAttribute('aria-expanded')).toBe('true')
 }
 fireEvent.click(screen.getByRole('button',{name:'세계관 목록 접기'}))
 for(const name of tabs){
  fireEvent.click(screen.getByRole('button',{name}))
  expect(list.closest('aside')?.hidden).toBe(true)
  expect(screen.getByRole('button',{name:'세계관 목록 펼치기'}).getAttribute('aria-expanded')).toBe('false')
 }
 const toggle=screen.getByRole('button',{name:'세계관 목록 펼치기'})
 toggle.focus();expect(document.activeElement).toBe(toggle)
 fireEvent.click(toggle)
 expect(list.closest('aside')?.hidden).toBe(false)
 expect(screen.getByRole('button',{name:'세계관 목록 접기'}).getAttribute('aria-controls')).toBe(list.closest('aside')?.id)
},20000)

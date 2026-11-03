// @vitest-environment jsdom
import {cleanup,fireEvent,render,screen} from '@testing-library/react'
import {Provider} from 'react-redux'
import {MemoryRouter} from 'react-router'
import {afterEach,expect,it,vi} from 'vitest'
import App from './App'
import {createAppStore} from './app/store'

afterEach(()=>{cleanup();vi.unstubAllGlobals()})
it('preserves list collapse and unsaved input while switching only direct authoring menus',async()=>{
 const world={id:'direct-layout',name:'직접 작성',description:'',version:1,settings:[]}
 vi.stubGlobal('fetch',vi.fn(async(url:RequestInfo|URL)=>new Response(JSON.stringify(String(url).endsWith('/worlds')?[world]:world))))
 render(<Provider store={createAppStore({role:'user'})}><MemoryRouter initialEntries={['/worlds/direct-layout']}><App/></MemoryRouter></Provider>)
 await screen.findByRole('heading',{name:'직접 작성',level:2})
 const list=screen.getByRole('navigation',{name:'내 세계관'}).closest('aside')!
 expect(list.hidden).toBe(false)
 fireEvent.change(screen.getByLabelText('세계관 설명'),{target:{value:'저장 전 원문'}})
 fireEvent.click(screen.getByRole('button',{name:'세계관 목록 접기'}))
 for(const name of ['인물 0개','장소 0개','기본 설정 0개']){
  fireEvent.click(screen.getByRole('button',{name}))
  expect(list.hidden).toBe(true)
  expect(screen.getByRole('button',{name:'세계관 목록 펼치기'}).getAttribute('aria-expanded')).toBe('false')
 }
 const button=screen.getByRole('button',{name:'세계관 목록 펼치기'});button.focus();expect(document.activeElement).toBe(button)
 fireEvent.click(button)
 expect(list.hidden).toBe(false)
 expect(screen.getByLabelText<HTMLTextAreaElement>('세계관 설명').value).toBe('저장 전 원문')
 expect(screen.queryByRole('button',{name:'인물 관계 편집'})).toBeNull()
 expect(screen.queryByRole('button',{name:'전체 세계관 지도'})).toBeNull()
})

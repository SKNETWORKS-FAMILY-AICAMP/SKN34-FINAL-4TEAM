// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { Provider } from 'react-redux'
import { MemoryRouter } from 'react-router'
import { afterEach, expect, it, vi } from 'vitest'
import App from './App'
import { createAppStore } from './app/store'
import {cardTypes} from './domain/entities/studioCards'
const studioSections=[...cardTypes.filter(t=>t.id!=='object'&&t.id!=='other'),{id:'note',label:'집필 메모'}]
import type { StudioWorld } from './domain/entities/studioWorld'

afterEach(()=>{cleanup();vi.unstubAllGlobals()})
it('exposes original menus from main navigation and preserves every menu through save, edit and reopening',async()=>{
 let persisted:StudioWorld={id:'menu-world',name:'메뉴 검증',description:'',version:1,settings:[],analysis:null}
 const fetcher=vi.fn(async(url:RequestInfo|URL,init?:RequestInit)=>{
  const path=String(url)
  if(init?.method==='PUT') {persisted={...JSON.parse(String(init.body)),version:persisted.version+1}}
  return new Response(JSON.stringify(path.endsWith('/capabilities')?{aiEnabled:false}:path.endsWith('/worlds')?[persisted]:persisted))
 })
 vi.stubGlobal('fetch',fetcher)
 const show=()=>render(<Provider store={createAppStore({role:'user'})}><MemoryRouter initialEntries={['/worlds/menu-world']}><App/></MemoryRouter></Provider>)
 show()
 await screen.findByRole('heading',{name:'메뉴 검증',level:2})
 expect(screen.getByText('저장됨')).toBeTruthy()
 expect(screen.getByText('세계관 편집').classList.contains('sr-only')).toBe(true)
 expect(screen.queryByRole('button',{name:/화면 ID/})).toBeNull()
 const gnb=screen.getByRole('navigation',{name:'주요 메뉴'})
 fireEvent.click(within(gnb).getByRole('button',{name:'세계관 작업실'}))
 await screen.findByRole('heading',{name:'세계관 작업실',level:1})
 expect(screen.queryByRole('heading',{name:'메뉴 검증',level:2})).toBeNull()
 fireEvent.click(await screen.findByRole('button',{name:/^메뉴 검증/}))
 await screen.findByRole('heading',{name:'메뉴 검증',level:2})
 fireEvent.click(within(screen.getByRole('main')).getByRole('button',{name:'세계관 작업실'}))
 await waitFor(()=>expect(screen.queryByRole('heading',{name:'메뉴 검증',level:2})).toBeNull())
 fireEvent.click(within(screen.getByRole('navigation',{name:'주요 메뉴'})).getByRole('button',{name:/내 서재/}))
 fireEvent.click(await screen.findByRole('button',{name:'내가 쓰는 소설'}))
 await screen.findByRole('heading',{name:'작품 작업실'})
 fireEvent.click(within(screen.getByRole('main')).getByRole('button',{name:'세계관 작업실'}))
 fireEvent.click(await screen.findByRole('button',{name:/^메뉴 검증/}))
 await screen.findByRole('heading',{name:'메뉴 검증',level:2})
 for(const section of studioSections) {
  const menus=screen.getByRole('navigation',{name:'설정 작성 메뉴'})
  fireEvent.click(within(menus).getByRole('button',{name:new RegExp('^'+section.label+' ')}))
  fireEvent.click(screen.getByRole('button',{name:section.label+' 추가'}))
  fireEvent.change(screen.getByLabelText('항목 이름'),{target:{value:section.label+' 항목'}})
  fireEvent.change(screen.getByLabelText('내용'),{target:{value:'첫 줄 | 그대로\n'+section.label}})
  fireEvent.click(screen.getByText('기존 정리 정보'))
  fireEvent.change(screen.getByLabelText('내 분류'),{target:{value:'내 사용자 분류'}})
  fireEvent.change(screen.getByLabelText('내 태그 (쉼표로 구분)'),{target:{value:'태그'}})
 }
 expect(document.body.textContent).not.toMatch(/항목 ID:|DB 저장본|로컬 검증|버전 [0-9]/)
 fireEvent.click(screen.getByRole('button',{name:'저장'}))
 await waitFor(()=>expect(persisted.settings).toHaveLength(studioSections.length))
 await waitFor(()=>expect(screen.getByRole<HTMLButtonElement>('button',{name:'저장'}).disabled).toBe(true))
 const ids=persisted.settings.map(s=>s.item.id)
 for(const section of studioSections) {
  fireEvent.click(within(screen.getByRole('navigation',{name:'설정 작성 메뉴'})).getByRole('button',{name:new RegExp('^'+section.label+' ')}))
  fireEvent.change(screen.getByLabelText('내용'),{target:{value:'수정 | 원문\n'+section.label}})
 }
 fireEvent.click(screen.getByRole('button',{name:'저장'}))
 await waitFor(()=>expect(persisted.version).toBe(3))
 await waitFor(()=>expect(screen.getByRole<HTMLButtonElement>('button',{name:'저장'}).disabled).toBe(true))
 cleanup();show()
 await screen.findByRole('heading',{name:'메뉴 검증',level:2})
 expect(persisted.settings.map(s=>s.item.id)).toEqual(ids)
 for(const section of studioSections) {
  fireEvent.click(within(screen.getByRole('navigation',{name:'설정 작성 메뉴'})).getByRole('button',{name:new RegExp('^'+section.label+' ')}))
  expect(screen.getByLabelText<HTMLTextAreaElement>('내용').value).toBe('수정 | 원문\n'+section.label)
  expect(screen.getByLabelText<HTMLInputElement>('내 분류').value).toBe('내 사용자 분류')
  expect(screen.getByLabelText<HTMLInputElement>('내 태그 (쉼표로 구분)').value).toBe('태그')
 }
 fireEvent.focus(screen.getByLabelText('내 태그 (쉼표로 구분)'))
 fireEvent.blur(screen.getByLabelText('내 태그 (쉼표로 구분)'))
 expect(screen.getByRole<HTMLButtonElement>('button',{name:'저장'}).disabled).toBe(true)
},20000)

// @vitest-environment jsdom
import { cleanup,fireEvent,render,screen,waitFor } from '@testing-library/react'
import { Provider } from 'react-redux'
import { MemoryRouter } from 'react-router'
import {afterEach,expect,it,vi} from 'vitest'
import App from './App'
import {createAppStore} from './app/store'
import {newSetting,type StudioWorld} from './domain/entities/studioWorld'
import {putRelation} from './domain/entities/studioRelations'
afterEach(()=>{cleanup();vi.unstubAllGlobals()})
it('shows a name-only workshop character as the same card without creating links, and reloads its ID',async()=>{
 const a=newSetting('people'),b=newSetting('people');a.item.title='기존 가람';b.item.title='기존 나래'
 let saved:StudioWorld={id:'card-world',name:'카드 등록 검증',description:'',version:1,settings:putRelation([a,b],{subjectId:a.item.id,targetId:b.item.id,predicate:'friend_of',polarity:'asserted'}),analysis:null}
 vi.stubGlobal('fetch',vi.fn(async(url:RequestInfo|URL,init?:RequestInit)=>{
  if(init?.method==='PUT')saved={...JSON.parse(String(init.body)),version:saved.version+1}
  return new Response(JSON.stringify(String(url).endsWith('/capabilities')?{aiEnabled:false}:String(url).endsWith('/worlds')?[saved]:saved))
 }))
 const show=()=>render(<Provider store={createAppStore({role:'user'})}><MemoryRouter initialEntries={['/worlds/card-world']}><App/></MemoryRouter></Provider>)
 show();await screen.findByRole('heading',{name:'카드 등록 검증'})
 fireEvent.click(screen.getByRole('button',{name:'인물 2개'}))
 fireEvent.click(screen.getByRole('button',{name:'인물 추가'}))
 fireEvent.change(screen.getByLabelText('항목 이름'),{target:{value:'홍길동'}})
 fireEvent.click(screen.getByRole('button',{name:'이 인물의 관계 편집'}))
 expect(await screen.findByRole('group',{name:'홍길동 인물 카드'},{timeout:5000})).toBeTruthy()
 expect(screen.getAllByRole('button',{name:/관계선 편집/})).toHaveLength(1)
 fireEvent.click(screen.getByRole('button',{name:'저장'}))
 await waitFor(()=>expect(saved.settings).toHaveLength(4))
 const id=saved.settings.find(s=>s.item.title==='홍길동')!.item.id
 expect(saved.settings.filter(s=>s.item.kind==='relation')).toHaveLength(1)
 expect(saved.settings.find(s=>s.item.id===id)?.item.text).toBe('')
 cleanup();show();await screen.findByRole('heading',{name:'카드 등록 검증'})
 fireEvent.click(screen.getByRole('button',{name:'관계 편집'}))
 expect(await screen.findByRole('group',{name:'홍길동 인물 카드'},{timeout:5000})).toBeTruthy()
 expect(saved.settings.find(s=>s.item.title==='홍길동')?.item.id).toBe(id)
},20000)

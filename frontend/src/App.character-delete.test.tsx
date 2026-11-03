// @vitest-environment jsdom
import { cleanup,fireEvent,render,screen,waitFor } from '@testing-library/react'
import { Provider } from 'react-redux'
import { MemoryRouter } from 'react-router'
import {afterEach,expect,it,vi} from 'vitest'
import App from './App'
import {createAppStore} from './app/store'
import {newSetting,type StudioWorld} from './domain/entities/studioWorld'
import {putRelation} from './domain/entities/studioRelations'
vi.mock('./presentation/features/studio/view/CharacterCards',()=>({default:()=> <div>인물 카드</div>}))
afterEach(()=>{cleanup();vi.unstubAllGlobals()})
it('confirms person/incident relation removal and restores identical IDs before the next edit',async()=>{
 const a=newSetting('people'),b=newSetting('people');a.item.title='가람';b.item.title='나래'
 let saved:StudioWorld={id:'delete-world',name:'삭제 검증',description:'',version:1,settings:putRelation([a,b],{subjectId:a.item.id,targetId:b.item.id,predicate:'custom_relation',polarity:'asserted',text:'오랜 동료이자 경쟁자'}),analysis:null}
 vi.stubGlobal('fetch',vi.fn(async(url:RequestInfo|URL,init?:RequestInit)=>{
  if(init?.method==='PUT')saved={...JSON.parse(String(init.body)),version:saved.version+1}
  return new Response(JSON.stringify(String(url).endsWith('/capabilities')?{aiEnabled:false}:String(url).endsWith('/worlds')?[saved]:saved))
 }))
 render(<Provider store={createAppStore({role:'user'})}><MemoryRouter initialEntries={['/worlds/delete-world']}><App/></MemoryRouter></Provider>)
 await screen.findByRole('heading',{name:'삭제 검증'})
 fireEvent.click(screen.getByRole('button',{name:'인물 관계 편집'}))
 fireEvent.click(screen.getByRole('button',{name:'가람 인물'}))
 fireEvent.click(screen.getByRole('button',{name:'인물 삭제'}))
 expect(screen.getByText('오랜 동료이자 경쟁자')).toBeTruthy()
 fireEvent.click(screen.getByRole('button',{name:'인물과 연결 삭제'}))
 expect(screen.queryByRole('button',{name:'가람 인물'})).toBeNull()
 expect(saved.settings).toHaveLength(3)
 fireEvent.click(screen.getByRole('button',{name:'인물 삭제 되돌리기'}))
 expect(screen.getByRole('button',{name:'가람 인물'})).toBeTruthy()
 await waitFor(()=>expect((screen.getByRole('button',{name:'저장'}) as HTMLButtonElement).disabled).toBe(true))
 expect(saved.version).toBe(1)
 expect(saved.settings.map(s=>s.item.id)).toEqual([a.item.id,b.item.id,saved.settings[2].item.id])
})

// @vitest-environment jsdom
import {cleanup,fireEvent,render,screen,waitFor,within} from '@testing-library/react'
import {Provider} from 'react-redux'
import {MemoryRouter} from 'react-router'
import {afterEach,expect,it,vi} from 'vitest'
import App from './App'
import {createAppStore} from './app/store'
import {newSetting,type StudioWorld} from './domain/entities/studioWorld'
vi.mock('./presentation/features/studio/view/CharacterCards',()=>({default:()=> <div>관계 캔버스</div>}))
afterEach(()=>{cleanup();vi.unstubAllGlobals()})
it('edits graph and form through one state, saves/reloads IDs, and preserves failed deletion',async()=>{
 const a=newSetting('people'),b=newSetting('people');a.item.id='a';a.item.title='가람';b.item.id='b';b.item.title='나래'
 let saved:StudioWorld={id:'relationship-world',name:'관계 검증',description:'',version:1,settings:[a,b],analysis:null},fail=false
 vi.stubGlobal('fetch',vi.fn(async(url:RequestInfo|URL,init?:RequestInit)=>{
  if(init?.method==='PUT'){
   if(fail)return new Response(JSON.stringify({detail:'다른 곳에서 변경되었습니다'}),{status:409})
   saved={...JSON.parse(String(init.body)),version:saved.version+1}
  }
  return new Response(JSON.stringify(String(url).endsWith('/capabilities')?{aiEnabled:false}:String(url).endsWith('/worlds')?[saved]:saved))
 }))
 const show=()=>render(<Provider store={createAppStore({role:'user'})}><MemoryRouter initialEntries={['/worlds/relationship-world']}><App/></MemoryRouter></Provider>)
 show();await screen.findByRole('heading',{name:'관계 검증'})
 fireEvent.click(screen.getByRole('button',{name:'관계 편집'}))
 fireEvent.click(screen.getByRole('button',{name:'가람 인물'}))
 fireEvent.click(screen.getByRole('button',{name:'다른 인물과 연결하기'}))
 expect(screen.queryByRole('complementary',{name:'인물과 관계 편집'})).toBeNull()
 fireEvent.keyDown(screen.getByRole('button',{name:'나래 인물'}),{key:'Escape'})
 expect(screen.queryByRole('complementary',{name:'인물과 관계 편집'})).toBeNull()
 fireEvent.click(screen.getByRole('button',{name:'가람 인물'}))
 fireEvent.click(screen.getByRole('button',{name:'다른 인물과 연결하기'}))
 fireEvent.click(screen.getByRole('button',{name:'나래 인물'}))
 fireEvent.change(screen.getByLabelText('실제 관계 1'),{target:{value:'아버지와 서자, 인정받지 못한 가족'}})
 fireEvent.change(screen.getByLabelText('가람 → 나래 감정 1'),{target:{value:'아끼지만 가문의 질서를 거스를까 두렵다'}})
 fireEvent.change(screen.getByLabelText('나래 → 가람 감정 1'),{target:{value:'존경하고 인정받고 싶지만 차별에는 분노한다.\n그래도 가족이다.'}})
 fireEvent.click(screen.getByRole('button',{name:'편집본에 적용'}))
 expect(saved.settings).toHaveLength(2)
 fireEvent.click(screen.getByRole('button',{name:'가람 인물'}))
 fireEvent.change(screen.getByLabelText('인물 이름'),{target:{value:'가람 수정'}})
 fireEvent.click(screen.getByRole('button',{name:'설정 작성'}))
 fireEvent.click(screen.getByRole('button',{name:'인물 2개'}))
 expect((screen.getByLabelText('항목 이름') as HTMLInputElement).value).toBe('가람 수정')
 fireEvent.change(screen.getByLabelText('항목 이름'),{target:{value:'가람 폼 수정'}})
 fireEvent.click(screen.getByRole('button',{name:'관계 편집'}))
 expect(await screen.findByRole('button',{name:'가람 폼 수정 인물'})).toBeTruthy()
 fireEvent.click(screen.getByRole('button',{name:'저장'}))
 await waitFor(()=>expect(saved.settings).toHaveLength(5))
 expect(saved.settings.slice(2).map(s=>[s.item.subjectId,s.item.targetId,s.item.predicate])).toEqual([['a','b','custom_relation'],['a','b','custom_emotion'],['b','a','custom_emotion']])
 expect(saved.settings[4].item.text).toBe('존경하고 인정받고 싶지만 차별에는 분노한다.\n그래도 가족이다.')
 const ids=saved.settings.map(s=>s.item.id)
 cleanup();show();await screen.findByRole('heading',{name:'관계 검증'})
 fireEvent.click(screen.getByRole('button',{name:'관계 편집'}))
 fireEvent.click(within(screen.getByRole('navigation',{name:'인물 관계 목록'})).getByRole('button'))
 fireEvent.click(screen.getByRole('button',{name:'실제 관계 1 삭제'}))
 fireEvent.click(screen.getByRole('button',{name:'편집본에 적용'}))
 fail=true;fireEvent.click(screen.getByRole('button',{name:'저장'}))
 await screen.findByRole('alert')
 expect(saved.settings.map(s=>s.item.id)).toEqual(ids)
 expect(screen.getByText('저장 실패 · 입력은 유지됩니다')).toBeTruthy()
},20000)

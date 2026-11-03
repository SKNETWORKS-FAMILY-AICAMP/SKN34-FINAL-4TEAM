// @vitest-environment jsdom
import {cleanup,fireEvent,render,screen,waitFor,within} from '@testing-library/react'
import {Provider} from 'react-redux'
import {MemoryRouter} from 'react-router'
import {afterEach,expect,it,vi} from 'vitest'
import App from './App'
import {createAppStore} from './app/store'
import {newSetting,type StudioWorld} from './domain/entities/studioWorld'
import {putRelation} from './domain/entities/studioRelations'
vi.mock('./presentation/features/studio/view/CharacterCards',()=>({default:()=> <div>관계 캔버스</div>}))
afterEach(()=>{cleanup();vi.unstubAllGlobals()})

it('keeps generated relation prose consistent across graph, form, Wiki and reload without replacing custom descriptions',async()=>{
 const a=newSetting('people'),b=newSetting('people');a.item.id='a';a.item.title='가람';b.item.id='b';b.item.title='나래'
 let saved:StudioWorld={id:'prose-world',name:'관계 문구 검증',description:'',version:1,settings:putRelation([a,b],{subjectId:'a',targetId:'b',predicate:'friend_of',polarity:'asserted'}),analysis:null}
 const relationId=saved.settings[2].item.id
 vi.stubGlobal('fetch',vi.fn(async(url:RequestInfo|URL,init?:RequestInit)=>{
  if(init?.method==='PUT')saved={...JSON.parse(String(init.body)),version:saved.version+1}
  return new Response(JSON.stringify(String(url).endsWith('/capabilities')?{aiEnabled:false}:String(url).endsWith('/worlds')?[saved]:saved))
 }))
 const show=()=>render(<Provider store={createAppStore({role:'user'})}><MemoryRouter initialEntries={['/worlds/prose-world']}><App/></MemoryRouter></Provider>)
 show();await screen.findByRole('heading',{name:'관계 문구 검증'})
 fireEvent.change(screen.getByLabelText('관계'),{target:{value:'trusts'}})
 expect((screen.getByLabelText('내용') as HTMLTextAreaElement).value).toBe('가람 · 신뢰 · 나래')
 fireEvent.click(screen.getByRole('button',{name:'저장'}))
 await waitFor(()=>expect(saved.settings[2].item.text).toBe('가람 · 신뢰 · 나래'))
 fireEvent.click(screen.getByRole('button',{name:'설정집'}))
 expect(screen.getByRole('heading',{name:'가람 · 신뢰 · 나래'})).toBeTruthy()
 expect(screen.queryByText('가람 · 친구 · 나래')).toBeNull()
 fireEvent.click(screen.getByRole('button',{name:'인물 관계 편집'}))
 fireEvent.click(within(screen.getByRole('navigation',{name:'인물 관계 목록'})).getByRole('button'))
 fireEvent.change(screen.getByLabelText('가람 → 나래 감정 1'),{target:{value:'둘은 오랜 동료지만 지난 사건 이후 거리를 둔다.'}})
 fireEvent.click(screen.getByRole('button',{name:'편집본에 적용'}))
 fireEvent.click(screen.getByRole('button',{name:'가람 인물'}))
 fireEvent.change(screen.getByLabelText('인물 이름'),{target:{value:'가람 수정'}})
 fireEvent.click(screen.getByRole('button',{name:'저장'}))
 await waitFor(()=>expect(saved.settings[2].item.predicate).toBe('custom_emotion'))
 expect(saved.settings[2].item.text).toBe('둘은 오랜 동료지만 지난 사건 이후 거리를 둔다.')
 fireEvent.click(screen.getByRole('button',{name:'설정 작성'}))
 fireEvent.change(screen.getByLabelText('관계'),{target:{value:'wary_of'}})
 fireEvent.change(screen.getByLabelText('관계 주체'),{target:{value:'b'}})
 fireEvent.change(screen.getByLabelText('관계 대상'),{target:{value:'a'}})
 fireEvent.click(screen.getByRole('button',{name:'저장'}))
 await waitFor(()=>expect(saved.settings[2].item.title).toBe('나래 · 경계 · 가람 수정'))
 expect(saved.settings[2].item).toMatchObject({id:relationId,text:'둘은 오랜 동료지만 지난 사건 이후 거리를 둔다.',authorText:'둘은 오랜 동료지만 지난 사건 이후 거리를 둔다.'})
 cleanup();show();await screen.findByRole('heading',{name:'관계 문구 검증'})
 fireEvent.click(screen.getByRole('button',{name:'설정집'}))
 expect(screen.getByRole('heading',{name:'나래 · 경계 · 가람 수정'})).toBeTruthy()
 expect(screen.getByText('둘은 오랜 동료지만 지난 사건 이후 거리를 둔다.')).toBeTruthy()
},20000)

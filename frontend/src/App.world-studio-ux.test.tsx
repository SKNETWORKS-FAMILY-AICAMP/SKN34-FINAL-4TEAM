// @vitest-environment jsdom
import {cleanup,fireEvent,render,screen,within,waitFor} from '@testing-library/react'
import {Provider} from 'react-redux'
import {MemoryRouter} from 'react-router'
import {afterEach,expect,it,vi} from 'vitest'
import App from './App'
import {createAppStore} from './app/store'
import {newSetting,type StudioWorld,type StudioSetting} from './domain/entities/studioWorld'
// Keep the singleton repository bound to each test's current HTTP stub.
vi.mock('./data/world-studio/HttpWorldStudioRepository',async importOriginal=>{
 const actual=await importOriginal<typeof import('./data/world-studio/HttpWorldStudioRepository')>()
 return {HttpWorldStudioRepository:class extends actual.HttpWorldStudioRepository {
  constructor(){super((...args)=>fetch(...args))}
 }}
})
vi.mock('./presentation/features/studio/view/CharacterCards',()=>({default:()=> <div>인물 캔버스</div>}))
vi.mock('./presentation/features/studio/view/WorldMapCanvas',()=>({default:()=> <div>지도 캔버스</div>}))
afterEach(()=>{cleanup();vi.unstubAllGlobals();vi.restoreAllMocks()})
async function show(extra?:StudioSetting){
 const a=newSetting('people');a.item.title='홍길동';a.item.text='원문';a.item.category='society'
 const b=newSetting('people');b.item.title='홍 판서'
 const c=newSetting();c.item.kind='entity';c.item.entityType='organization';c.item.title='활빈당';c.item.category='society'
 let world:StudioWorld={id:'ux',name:'홍길동전 UX',description:'',version:1,settings:[a,b,c,...(extra?[extra]:[])],analysis:null}
 const second={...world,id:'ux-second',name:'두 번째 세계관'}
 const put=vi.fn()
 vi.stubGlobal('fetch',vi.fn(async(url:RequestInfo|URL,init?:RequestInit)=>{if(init?.method==='PUT'){put();world={...JSON.parse(String(init.body)),version:world.version+1}}return new Response(JSON.stringify(String(url).endsWith('/capabilities')?{aiEnabled:false}:String(url).endsWith('/worlds')?[world,second]:String(url).endsWith('/ux-second')?second:world))}))
 render(<Provider store={createAppStore({role:'user'})}><MemoryRouter initialEntries={['/worlds/ux']}><App/></MemoryRouter></Provider>)
 await screen.findByRole('heading',{name:world.name});return {read:()=>world,put,id:a.item.id}
}
it('groups tools into four areas and keeps the selected draft through filters and relationship return',async()=>{
 const qa=await show()
 expect(within(screen.getByRole('navigation',{name:'세계관 도구'})).getAllByRole('button').map(b=>b.textContent)).toEqual(['설정 작성','관계 편집','세계관 탐색','AI 후보 검토'])
 fireEvent.change(screen.getByLabelText('내용'),{target:{value:'저장 전 설명'}})
 fireEvent.change(screen.getByLabelText('영역 필터'),{target:{value:'basic'}})
 expect(screen.getByLabelText<HTMLInputElement>('항목 이름').value).toBe('홍길동')
 fireEvent.click(screen.getByRole('button',{name:'조직 1개'}))
 expect(screen.getByLabelText<HTMLInputElement>('항목 이름').value).toBe('홍길동')
 fireEvent.click(screen.getByRole('button',{name:'이 인물의 관계 편집'}))
 expect(screen.getByRole('region',{name:'인물 관계 편집'})).toBeTruthy()
 fireEvent.click(screen.getByRole('button',{name:'설정 카드로 돌아가기'}))
 expect(screen.getByLabelText<HTMLTextAreaElement>('내용').value).toBe('저장 전 설명')
 fireEvent.click(screen.getByRole('button',{name:'세계관 탐색'}))
 fireEvent.click(screen.getByRole('button',{name:'설정집'}))
 expect(screen.getByRole('heading',{name:'확정 Wiki'}).closest('section')?.textContent).not.toContain('저장 전 설명')
 fireEvent.click(screen.getByRole('button',{name:'설정 작성'}))
 expect(screen.getByLabelText<HTMLTextAreaElement>('내용').value).toBe('저장 전 설명')
 fireEvent.click(screen.getByRole('button',{name:'저장'}));await waitFor(()=>expect(qa.put).toHaveBeenCalledOnce())
 expect(qa.read().settings[0].item.id).toBe(qa.id);expect(qa.read().settings[0].item.text).toBe('저장 전 설명')
})

it('opens the newly chosen person on repeat visits and retains un-applied relationship text across tabs',async()=>{
 await show()
 fireEvent.click(screen.getByRole('button',{name:'이 인물의 관계 편집'}))
 fireEvent.click(screen.getByRole('button',{name:'설정 카드로 돌아가기'}))
 fireEvent.click(within(screen.getByRole('navigation',{name:'전체 항목'})).getByRole('button',{name:/홍 판서/}))
 fireEvent.click(screen.getByRole('button',{name:'이 인물의 관계 편집'}))
 expect(screen.getByLabelText<HTMLInputElement>('인물 이름').value).toBe('홍 판서')
 fireEvent.click(screen.getByRole('button',{name:'다른 인물과 연결하기'}))
 fireEvent.click(screen.getByRole('button',{name:'홍길동 인물'}))
 fireEvent.change(screen.getByLabelText('실제 관계 1'),{target:{value:'아버지와 서자'}})
 fireEvent.click(screen.getByRole('button',{name:'AI 후보 검토'}))
 fireEvent.click(screen.getByRole('button',{name:'관계 편집'}))
 expect(screen.getByLabelText<HTMLInputElement>('실제 관계 1').value).toBe('아버지와 서자')
})

it('returns to card editing when another world is opened from relationships',async()=>{
 await show()
 fireEvent.click(screen.getByRole('button',{name:'이 인물의 관계 편집'}))
 fireEvent.click(within(screen.getByRole('navigation',{name:'내 세계관'})).getByRole('button',{name:/두 번째 세계관/}))
 await screen.findByRole('heading',{name:'두 번째 세계관'})
 expect(screen.getByLabelText('항목 이름').closest('[hidden]')).toBeNull()
 expect(screen.queryByRole('region',{name:'인물 관계 편집'})).toBeNull()
})

it('keeps the edited world when the author declines the unsaved-change warning',async()=>{
 await show()
 const confirm=vi.spyOn(window,'confirm').mockReturnValue(false)
 fireEvent.change(screen.getByLabelText('내용'),{target:{value:'보존할 입력'}})
 fireEvent.click(within(screen.getByRole('navigation',{name:'내 세계관'})).getByRole('button',{name:/두 번째 세계관/}))
 expect(confirm).toHaveBeenCalledWith('저장하지 않은 변경이 있습니다. 이동할까요?')
 expect(screen.getByRole('heading',{name:'홍길동전 UX'})).toBeTruthy()
 expect(screen.getByLabelText<HTMLTextAreaElement>('내용').value).toBe('보존할 입력')
})

it.each(['object','other','aliases'])('blocks the whole save without dropping unsupported %s data',async(field)=>{
 const row=newSetting('people');row.item.title='보호할 기존 카드'
 if(field==='aliases')row.aliases=['기존 별칭'];else row.item.entityType=field
 const qa=await show(row)
 fireEvent.change(screen.getByLabelText('내용'),{target:{value:'새 입력'}})
 expect(screen.getByRole<HTMLButtonElement>('button',{name:'저장'}).disabled).toBe(true)
 expect(screen.getByText('지원하지 않는 입력으로 저장할 수 없음')).toBeTruthy()
 fireEvent.click(screen.getByRole('button',{name:'저장'}))
 expect(qa.put).not.toHaveBeenCalled()
 expect(qa.read().settings.at(-1)).toEqual(row)
})

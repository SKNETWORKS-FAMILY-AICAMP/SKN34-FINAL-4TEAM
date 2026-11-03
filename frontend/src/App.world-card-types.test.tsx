// @vitest-environment jsdom
import {cleanup,fireEvent,render,screen,waitFor,within} from '@testing-library/react'
import {Provider} from 'react-redux'
import {MemoryRouter} from 'react-router'
import {afterEach,expect,it,vi} from 'vitest'
import App from './App'
import {createAppStore} from './app/store'
import {newSetting,type StudioWorld} from './domain/entities/studioWorld'
import {cardTypes,settingAreas} from './domain/entities/studioCards'
afterEach(()=>{cleanup();vi.unstubAllGlobals()})
it('offers eight types, preserves content and identity across seven area choices, and blocks unsavable fields',async()=>{
 const c=newSetting('people');c.item.title='홍길동';c.item.text='원문\n그대로';c.tags=['주인공'];c.item.evidence=[{sourceId:'source-1',quote:'원문'}];c.item.origin='extraction'
 const old=newSetting();old.item.kind='entity';old.item.entityType='legacy-unknown';old.item.title='구형 카드'
 let world:StudioWorld={id:'taxonomy',name:'홍길동전 분류',description:'',version:1,settings:[c,old],analysis:null}
 const put=vi.fn()
 vi.stubGlobal('fetch',vi.fn(async(url:RequestInfo|URL,init?:RequestInit)=>{if(init?.method==='PUT'){put();world={...JSON.parse(String(init.body)),version:world.version+1}}return new Response(JSON.stringify(String(url).endsWith('/capabilities')?{aiEnabled:false}:String(url).endsWith('/worlds')?[world]:world))}))
 const show=()=>render(<Provider store={createAppStore({role:'user'})}><MemoryRouter initialEntries={['/worlds/taxonomy']}><App/></MemoryRouter></Provider>)
 show();await screen.findByRole('heading',{name:world.name})
 const types=screen.getByLabelText('카드 유형')
 expect(within(types).getAllByRole('option').map(o=>o.textContent)).toEqual(cardTypes.map(t=>t.label))
 for(const area of settingAreas){fireEvent.change(screen.getByLabelText('설정 영역'),{target:{value:area.id}});expect(screen.getByLabelText<HTMLInputElement>('항목 이름').value).toBe('홍길동')}
 expect(screen.getByLabelText<HTMLTextAreaElement>('내용').value).toBe(c.item.text)
 fireEvent.click(screen.getByRole('button',{name:'저장'}));await waitFor(()=>expect(put).toHaveBeenCalledTimes(1))
 expect(world.settings[0].item.evidence).toEqual(c.item.evidence);expect(world.settings[0].item.origin).toBe('extraction');expect(world.settings[0].item.id).toBe(c.item.id);expect(world.settings[1]).toEqual(old);expect(world.settings[0].tags).toEqual(['주인공'])
 cleanup();show();await screen.findByRole('heading',{name:world.name})
 expect(screen.getByLabelText<HTMLSelectElement>('설정 영역').value).toBe('conflict')
 fireEvent.click(screen.getByRole('button',{name:'분류 확인 1개'}));expect(screen.getByLabelText<HTMLInputElement>('항목 이름').value).toBe('구형 카드')
 fireEvent.click(screen.getByRole('button',{name:'인물 1개'}))
 expect(within(screen.getByLabelText('카드 유형')).getByRole<HTMLOptionElement>('option',{name:'사물'}).disabled).toBe(true)
 expect(within(screen.getByLabelText('카드 유형')).getByRole<HTMLOptionElement>('option',{name:'기타'}).disabled).toBe(true)
 expect(screen.getByLabelText<HTMLInputElement>('별칭 (선택)').disabled).toBe(true)
 expect(screen.getByText(/사물·기타 유형과 별칭 저장은 준비 중/)).toBeTruthy()
 expect(put).toHaveBeenCalledTimes(1)
 fireEvent.click(screen.getByRole('button',{name:'분류 확인 1개'}))
 fireEvent.change(screen.getByLabelText('카드 유형'),{target:{value:'location'}})
 expect(screen.getByLabelText<HTMLInputElement>('항목 이름').value).toBe('구형 카드')
 expect(screen.getByLabelText<HTMLSelectElement>('카드 유형').value).toBe('location')
},20000)

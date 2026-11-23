// @vitest-environment jsdom
import {cleanup,fireEvent,render,screen} from '@testing-library/react'
import {Provider} from 'react-redux'
import {MemoryRouter,Routes,Route} from 'react-router'
import {afterEach,expect,it,vi} from 'vitest'
import {createAppStore} from '../../app/store'
import {WorldStudioPage} from '../../presentation/features/worldstudio/view/WorldStudioPage'
import {WorldStudioUseCase} from '../../domain/usecases/WorldStudioUseCase'
import {newSetting,type StudioWorld} from '../../domain/entities/studioWorld'
import type {useWorldStudioViewModel} from '../../presentation/features/worldstudio/viewmodel/useWorldStudioViewModel'
/** 게시판 제목은 미리보기를 열고 `수정하기`가 편집 화면을 연다. 이미 미리보기가 열려 있으면(편집 화면에 다녀온 뒤) 제목을 다시 누르지 않는다(접힌다). */
const openCard=(name:string)=>{const title=screen.getByRole('button',{name});if(title.getAttribute('aria-expanded')!=='true')fireEvent.click(title);fireEvent.click(screen.getByRole('button',{name:'수정하기'}))}
let useCase:WorldStudioUseCase
let current:ReturnType<typeof useWorldStudioViewModel>
vi.mock('../../presentation/features/worldstudio/viewmodel/useWorldStudioViewModel',async original=>{
 const actual=await original<typeof import('../../presentation/features/worldstudio/viewmodel/useWorldStudioViewModel')>()
 return {useWorldStudioViewModel:()=>{current=actual.useWorldStudioViewModel(useCase);return current}}
})
afterEach(cleanup)
it('does not dirty or rewrite a saved card when unchanged tag and alias fields lose focus',async()=>{
 const card=newSetting('people');card.item.title='가람';card.tags=['금빛 열쇠'];card.aliases=['오래된 이름']
 const world:StudioWorld={id:'labels',name:'태그 검증',description:'',version:1,settings:[card],analysis:null}
 useCase=new WorldStudioUseCase({listStudio:async()=>[world],read:async()=>structuredClone(world),create:async()=>world,saveStudio:vi.fn(),setPublication:vi.fn()})
 render(<Provider store={createAppStore({role:'user'})}><MemoryRouter initialEntries={['/worldstudio/labels']}><Routes><Route path="/worldstudio/:worldId" element={<WorldStudioPage/>}/></Routes></MemoryRouter></Provider>)
 await screen.findByRole('heading',{name:'태그 검증',level:1})
 openCard('가람 인물') // 설정집에서 카드를 골라(미리보기) 수정하기를 눌러야 편집 화면이 열린다
 fireEvent.click(screen.getByRole('tab',{name:'개요'})) // 별칭·태그는 개요 탭에 있다
 const tag=screen.getByLabelText(/태그 \(쉼표로 구분\)/),alias=screen.getByLabelText(/^별칭/)
 fireEvent.focus(tag);fireEvent.blur(tag);fireEvent.focus(alias);fireEvent.blur(alias)
 expect(current.dirty).toBe(false)
 expect(current.editing!.settings).toEqual(world.settings)
 fireEvent.change(tag,{target:{value:' 금빛 열쇠 ,'}});fireEvent.blur(tag)
 expect(current.editing!.settings[0].tags).toEqual(['금빛 열쇠'])
 expect(current.dirty).toBe(true)
 expect(world.settings[0].tags).toEqual(['금빛 열쇠'])
})

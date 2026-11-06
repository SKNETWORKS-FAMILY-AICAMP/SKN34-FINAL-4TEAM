// @vitest-environment jsdom
import { cleanup,fireEvent,render,screen } from '@testing-library/react'
import { afterEach,expect,it,vi } from 'vitest'
import { newSetting } from '../../../../domain/entities/studioWorld'
import { useWorldMapViewModel } from '../viewmodel/useWorldMapViewModel'
import { buildCharacterMap } from '../viewmodel/characterMap'
import CharacterCards from './CharacterCards'
afterEach(()=>{cleanup();vi.unstubAllGlobals()})
it('opens saved character details without exposing edit or connect controls',()=>{
 const a=newSetting('people');a.item.title='홍문'
 const onSelect=vi.fn()
 function Harness(){const vm=useWorldMapViewModel([a],buildCharacterMap);return <CharacterCards vm={vm} editing={{busy:false,readOnly:true,selectedRelations:[],targetSource:null,layoutVersion:0,onSelect,onConnect:vi.fn(),onRelation:vi.fn()}}/>}
 render(<Harness/> )
 fireEvent.click(screen.getByRole('button',{name:'홍문 상세 보기'}))
 expect(onSelect).toHaveBeenCalledWith(a.item.id)
 expect(screen.queryByRole('button',{name:/관계 연결|정보 편집/})).toBeNull()
})
it('creates cards without links and separates dragging, info and explicit connection buttons',()=>{
 vi.stubGlobal('PointerEvent',MouseEvent)
 const a=newSetting('people'),b=newSetting('people');a.item.title='가람';a.item.text='북부 기록관';b.item.title='나래'
 const onSelect=vi.fn(),onConnect=vi.fn(),onRelation=vi.fn()
 function Harness(){const vm=useWorldMapViewModel([a,b],buildCharacterMap);return <CharacterCards vm={vm} editing={{busy:false,selectedRelations:[],targetSource:null,layoutVersion:0,onSelect,onConnect,onRelation}}/>}
 render(<Harness/> )
 expect(screen.getByRole('group',{name:'가람 인물 카드'})).toBeTruthy()
 expect(screen.queryByRole('button',{name:/관계선 편집/})).toBeNull()
 const card=screen.getByRole('group',{name:'가람 인물 카드'})
 const before=card.style.transform
 fireEvent.pointerDown(card,{clientX:30,clientY:30})
 fireEvent.pointerMove(card,{clientX:110,clientY:70})
 fireEvent.pointerUp(card,{clientX:110,clientY:70})
 expect(card.style.transform).not.toBe(before)
 expect(onConnect).not.toHaveBeenCalled()
 fireEvent.click(screen.getByRole('button',{name:'가람 관계 연결'}))
 expect(onConnect).toHaveBeenCalledWith(a.item.id)
 fireEvent.click(screen.getByRole('button',{name:'가람 정보 편집'}))
 expect(onSelect).toHaveBeenCalledWith(a.item.id)
 expect(a.item).not.toHaveProperty('x')
})

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
 function Harness(){const vm=useWorldMapViewModel([a],buildCharacterMap);return <CharacterCards vm={vm} editing={{busy:false,readOnly:true,selectedRelations:[],targetSource:null,onSelect,onConnect:vi.fn(),onRelation:vi.fn()}}/>}
 render(<Harness/> )
 fireEvent.click(screen.getByRole('button',{name:'홍문 상세 보기'}))
 expect(onSelect).toHaveBeenCalledWith(a.item.id)
 expect(screen.queryByRole('button',{name:/관계 연결|정보 편집/})).toBeNull()
})
it('creates cards without links and separates dragging, info and explicit connection buttons',()=>{
 vi.stubGlobal('PointerEvent',MouseEvent)
 const a=newSetting('people'),b=newSetting('people');a.item.title='가람';a.item.text='북부 기록관';b.item.title='나래'
 const onSelect=vi.fn(),onConnect=vi.fn(),onRelation=vi.fn()
 function Harness(){const vm=useWorldMapViewModel([a,b],buildCharacterMap);return <CharacterCards vm={vm} editing={{busy:false,selectedRelations:[],targetSource:null,onSelect,onConnect,onRelation}}/>}
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
it('onPick이 있으면 카드 본문을 누를 때(드래그 없이) onSelect 대신 onPick을 부르고 드래그하면 부르지 않는다',()=>{
 vi.stubGlobal('PointerEvent',MouseEvent)
 const a=newSetting('people'),b=newSetting('people');a.item.title='가람';b.item.title='나래'
 const onSelect=vi.fn(),onPick=vi.fn()
 function Harness(){const vm=useWorldMapViewModel([a,b],buildCharacterMap);return <CharacterCards vm={vm} editing={{busy:false,selectedRelations:[],targetSource:null,onSelect,onConnect:vi.fn(),onRelation:vi.fn(),onPick}}/>}
 render(<Harness/>)
 const card=screen.getByRole('group',{name:'가람 인물 카드'})
 fireEvent.pointerDown(card,{clientX:30,clientY:30});fireEvent.pointerUp(card,{clientX:30,clientY:30})
 expect(onPick).toHaveBeenCalledOnce();expect(onPick).toHaveBeenCalledWith(a.item.id);expect(onSelect).not.toHaveBeenCalled()
 fireEvent.pointerDown(card,{clientX:30,clientY:30});fireEvent.pointerMove(card,{clientX:110,clientY:70});fireEvent.pointerUp(card,{clientX:110,clientY:70})
 expect(onPick).toHaveBeenCalledOnce()
 fireEvent.click(screen.getByRole('button',{name:'가람 정보 편집'}))
 expect(onSelect).toHaveBeenCalledWith(a.item.id);expect(onPick).toHaveBeenCalledOnce()
})
it('상대를 고르는 중에도 카드 본문을 누르면 onPick이 불리고 그때는 카드를 끌 수 없다',()=>{
 vi.stubGlobal('PointerEvent',MouseEvent)
 const a=newSetting('people'),b=newSetting('people');a.item.title='가람';b.item.title='나래'
 const onPick=vi.fn()
 function Harness(){const vm=useWorldMapViewModel([a,b],buildCharacterMap);return <CharacterCards vm={vm} editing={{busy:false,selectedRelations:[],targetSource:a.item.id,onSelect:vi.fn(),onConnect:vi.fn(),onRelation:vi.fn(),onPick}}/>}
 render(<Harness/>)
 const card=screen.getByRole('group',{name:'나래 인물 카드'}),before=card.style.transform
 fireEvent.pointerDown(card,{clientX:30,clientY:30});fireEvent.pointerUp(card,{clientX:30,clientY:30})
 expect(onPick).toHaveBeenCalledOnce();expect(onPick).toHaveBeenCalledWith(b.item.id)
 fireEvent.pointerDown(card,{clientX:30,clientY:30});fireEvent.pointerMove(card,{clientX:110,clientY:70});fireEvent.pointerUp(card,{clientX:110,clientY:70})
 expect(card.style.transform).toBe(before);expect(onPick).toHaveBeenCalledOnce()
})

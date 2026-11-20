// @vitest-environment jsdom
import { useState } from 'react'
import { act,cleanup,fireEvent,render,renderHook,screen } from '@testing-library/react'
import { afterEach,expect,it,vi } from 'vitest'
import { newSetting } from '../../../../domain/entities/studioWorld'
import { useWorldMapViewModel } from '../viewmodel/useWorldMapViewModel'
import { buildCharacterMap, mapNeighbors } from '../viewmodel/characterMap'
import { putRelation } from '../../../../domain/entities/studioRelations'
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
it('카드 요약과 말풍선(title)은 본문의 링크 원문 대신 링크 글자만 보이고, 검색도 보이는 요약에 맞춘다 (#485 QA)',()=>{
 const a=newSetting('people'),b=newSetting('people');a.item.title='가람';b.item.title='나래'
 a.item.text='[나래](card:3f95a1c2-0b6d-4c1e-9a77-5e0d2c8b1a10)의 오랜 벗'
 function Harness(){const vm=useWorldMapViewModel([a,b],buildCharacterMap);return <CharacterCards vm={vm} editing={{busy:false,selectedRelations:[],targetSource:null,onSelect:vi.fn(),onConnect:vi.fn(),onRelation:vi.fn()}}/>}
 render(<Harness/>)
 const summary=screen.getByText('나래의 오랜 벗')
 expect(summary.getAttribute('title')).toBe('나래의 오랜 벗')
 expect(document.body.textContent).not.toContain('card:')
 const {result}=renderHook(()=>useWorldMapViewModel([a,b],buildCharacterMap))
 act(()=>result.current.setQuery('3f95a1c2'));expect(result.current.results).toEqual([]) // 링크 주소 조각은 화면에 없으니 찾히지 않는다
 act(()=>result.current.setQuery('오랜 벗'));expect(result.current.results.map(n=>n.id)).toEqual([a.item.id])
})

/** 가람이 나래·다온과, 나래가 다온과 이어진 세계(가람에 닿는 선 2개, 나래↔다온 1개). */
function triangle() {
 const a=newSetting('people'),b=newSetting('people'),c=newSetting('people');a.item.title='가람';b.item.title='나래';c.item.title='다온'
 let rows=putRelation([a,b,c],{subjectId:a.item.id,targetId:b.item.id,predicate:'friend_of',polarity:'asserted'})
 rows=putRelation(rows,{subjectId:a.item.id,targetId:c.item.id,predicate:'friend_of',polarity:'asserted'})
 rows=putRelation(rows,{subjectId:b.item.id,targetId:c.item.id,predicate:'friend_of',polarity:'asserted'})
 return {a,b,c,rows}
}
const actions=()=>({busy:false,selectedRelations:[],targetSource:null,onSelect:vi.fn(),onConnect:vi.fn(),onRelation:vi.fn()})
const labels=()=>Array.from(document.querySelectorAll('text.relationship-edge-label'),t=>t.textContent)
it('center를 주면 중심 카드를 보드 가운데에 두고 이웃을 둘레에 놓으며 라벨은 중심 카드에 닿는 선에만 그린다',()=>{
 const {a,rows}=triangle()
 function Harness(){const vm=useWorldMapViewModel(rows,buildCharacterMap);return <CharacterCards vm={{...vm,graph:mapNeighbors(vm.graph,a.item.id,0,12)}} center={a.item.id} editing={actions()}/>}
 render(<Harness/>)
 const at=(name:string)=>{const el=screen.getByRole('group',{name});return /translate\(([-\d.]+)px, ([-\d.]+)px\)/.exec(el.style.transform)!.slice(1).map(Number)}
 const board=document.querySelector<HTMLElement>('.relationship-cards-board')!
 const [cx,cy]=at('가람 인물 카드')
 expect([cx+100,cy+75]).toEqual([parseFloat(board.style.width)/2,parseFloat(board.style.height)/2]) // 중심 카드의 한가운데가 보드 가운데
 const [bx,by]=at('나래 인물 카드'),[dx,dy]=at('다온 인물 카드')
 expect(Math.round(bx-cx)).toBe(0) // 첫 이웃은 중심 바로 위
 expect(by).toBeLessThan(cy)
 expect(dy).toBeGreaterThan(by) // 둘째 이웃은 시계 방향(아래쪽)
 expect(Math.hypot(bx-cx,by-cy)).toBeCloseTo(Math.hypot(dx-cx,dy-cy),5) // 같은 원 위
 expect(labels()).toHaveLength(2) // 나래↔다온 선은 이 보기에 없고(중심에 닿는 이웃 선만), 둘 다 중심 카드에 닿는다
 expect(document.querySelector<HTMLElement>('.relationship-cards-scroll')!.style.height).toMatch(/^\d+px$/) // 상자 높이는 보드를 따르되 640px까지
 expect(parseFloat(document.querySelector<HTMLElement>('.relationship-cards-scroll')!.style.height)).toBeLessThanOrEqual(640)
})
it('center 없는 전체 보기는 카드를 고르기 전에는 라벨이 없고 고르면 그 카드에 닿는 선의 라벨만 보이며 선은 툴팁·이름으로 계속 읽힌다',()=>{
 const {a,rows}=triangle()
 let pick!:(id:string|null)=>void
 function Harness(){const vm=useWorldMapViewModel(rows,buildCharacterMap);pick=vm.select;return <CharacterCards vm={vm} editing={actions()}/>}
 render(<Harness/>)
 expect(labels()).toEqual([]) // 고르기 전에는 없다
 expect(screen.getAllByRole('button',{name:/관계선 편집/})).toHaveLength(3) // 선은 읽히고 누를 수 있다
 expect(document.querySelectorAll('.relationship-edge-hit title')).toHaveLength(3) // <title> 툴팁
 act(()=>pick(a.item.id))
 expect(labels()).toHaveLength(2) // 가람에 닿는 선 둘뿐(나래↔다온은 그리지 않는다)
 expect(document.querySelectorAll('.relationship-kind')).toHaveLength(3) // 카드마다 유형 점
})

it('중심 보기의 중앙 정렬은 처음(과 중심·이웃 수·폭이 바뀔 때)만 하고, 부모가 다시 그리거나 카드를 끌어 보드가 커져도 사용자가 민 스크롤을 되돌리지 않는다',()=>{
 vi.stubGlobal('PointerEvent',MouseEvent)
 const original=Object.getOwnPropertyDescriptor(Element.prototype,'scrollLeft')
 const writes=vi.fn()
 Object.defineProperty(Element.prototype,'scrollLeft',{configurable:true,get:()=>0,set:(value:number)=>writes(value)})
 try{
  const {a,rows}=triangle()
  let bump!:()=>void
  function Harness(){
   const vm=useWorldMapViewModel(rows,buildCharacterMap),[,tick]=useState(0);bump=()=>tick(n=>n+1)
   return <CharacterCards vm={{...vm,graph:mapNeighbors(vm.graph,a.item.id,0,12)}} center={a.item.id} editing={actions()}/> // 부모가 그릴 때마다 graph·nodes가 새 배열이다(관계 편집기와 같다)
  }
  render(<Harness/>)
  expect(writes).toHaveBeenCalledTimes(1) // 처음 한 번 중심 카드가 보이게 맞춘다
  act(()=>bump());act(()=>bump())
  expect(writes).toHaveBeenCalledTimes(1) // 다시 그려도 스크롤을 건드리지 않는다
  const card=screen.getByRole('group',{name:'나래 인물 카드'}) // 끌어서 보드 바깥으로 내보내면 보드가 커진다
  fireEvent.pointerDown(card,{clientX:30,clientY:30});fireEvent.pointerMove(card,{clientX:2400,clientY:30});fireEvent.pointerUp(card,{clientX:2400,clientY:30})
  expect(parseFloat(document.querySelector<HTMLElement>('.relationship-cards-board')!.style.width)).toBeGreaterThan(2000)
  expect(writes).toHaveBeenCalledTimes(1) // 드래그로 보드가 커져도 중앙으로 되돌리지 않는다
 }finally{
  if(original)Object.defineProperty(Element.prototype,'scrollLeft',original);else delete (Element.prototype as {scrollLeft?:unknown}).scrollLeft
 }
})

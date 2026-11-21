// @vitest-environment jsdom
import { notifyResize } from '../../../../test/reactFlowStubs'
import { useState } from 'react'
import { act,cleanup,createEvent,fireEvent,render,renderHook,screen,waitFor,within } from '@testing-library/react'
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
it('카드는 React Flow 캔버스(점 격자 배경·확대/축소/화면 맞춤 컨트롤, 잠금 버튼 없음) 위에 놓이고 카드 버튼은 끌기에 먹히지 않는 nodrag이며 정보 편집·관계 연결은 각자 콜백만 부른다',()=>{
 const a=newSetting('people'),b=newSetting('people');a.item.title='가람';a.item.text='북부 기록관';b.item.title='나래'
 const onSelect=vi.fn(),onConnect=vi.fn(),onRelation=vi.fn()
 function Harness(){const vm=useWorldMapViewModel([a,b],buildCharacterMap);return <CharacterCards vm={vm} editing={{busy:false,selectedRelations:[],targetSource:null,onSelect,onConnect,onRelation}}/>}
 render(<Harness/> )
 const flow=screen.getByRole('group',{name:'인물 카드 그래프'})
 expect(flow.querySelector('.react-flow')).toBeTruthy()
 expect(flow.querySelector('.react-flow__background-pattern.dots')).toBeTruthy() // 점 격자 배경
 expect(within(flow).getByRole('button',{name:'확대'})).toBeTruthy()
 expect(within(flow).getByRole('button',{name:'축소'})).toBeTruthy()
 expect(within(flow).getByRole('button',{name:'화면에 맞추기'})).toBeTruthy()
 expect(within(flow).queryByRole('button',{name:/잠금|interactiv/i})).toBeNull() // 보기 잠금 버튼은 끈다
 const card=screen.getByRole('group',{name:'가람 인물 카드'})
 expect(card.getAttribute('data-id')).toBe(a.item.id)
 expect(card.classList.contains('draggable')).toBe(true) // 카드는 끌 수 있다
  expect(card.hasAttribute('tabindex')).toBe(false) // 카드 자체는 초점을 받지 않는다(카드 안 버튼이 키보드 길이다)
  expect(card.hasAttribute('aria-describedby')).toBe(false) // React Flow의 영어 키보드 안내를 잇지 않는다
 expect(screen.queryByRole('button',{name:/관계선 편집/})).toBeNull() // 관계가 없으면 선도 없다
 for(const button of within(card).getAllByRole('button'))expect(button.closest('.nodrag'),button.textContent??'').toBeTruthy() // 버튼 누르기가 노드 끌기로 먹히지 않는다
 fireEvent.click(within(card).getByRole('button',{name:'가람 관계 연결'}))
 expect(onConnect).toHaveBeenCalledWith(a.item.id)
 fireEvent.click(within(card).getByRole('button',{name:'가람 정보 편집'}))
 expect(onSelect).toHaveBeenCalledWith(a.item.id)
 expect(onRelation).not.toHaveBeenCalled()
 expect(a.item).not.toHaveProperty('x') // 끌어 옮긴 위치는 화면 상태일 뿐 저장하지 않는다
})
it('onPick이 있으면 카드 본문을 누를 때 onSelect 대신 onPick을 부르고, 카드 안 버튼을 누를 때는 부르지 않는다',()=>{
 const a=newSetting('people'),b=newSetting('people');a.item.title='가람';b.item.title='나래'
 const onSelect=vi.fn(),onPick=vi.fn()
 function Harness(){const vm=useWorldMapViewModel([a,b],buildCharacterMap);return <CharacterCards vm={vm} editing={{busy:false,selectedRelations:[],targetSource:null,onSelect,onConnect:vi.fn(),onRelation:vi.fn(),onPick}}/>}
 render(<Harness/>)
 const card=screen.getByRole('group',{name:'가람 인물 카드'})
 fireEvent.click(card)
 expect(onPick).toHaveBeenCalledOnce();expect(onPick).toHaveBeenCalledWith(a.item.id);expect(onSelect).not.toHaveBeenCalled()
 fireEvent.click(within(card).getByRole('button',{name:'가람 정보 편집'}))
 expect(onSelect).toHaveBeenCalledWith(a.item.id);expect(onPick).toHaveBeenCalledOnce()
})
it('상대를 고르는 중에도 카드 본문을 누르면 onPick이 불리고 그때는 카드를 끌 수 없으며, 처리 중(busy)에는 누르기도 받지 않는다',()=>{
 const a=newSetting('people'),b=newSetting('people');a.item.title='가람';b.item.title='나래'
 const onPick=vi.fn()
 const harness=(busy:boolean)=>{function Harness(){const vm=useWorldMapViewModel([a,b],buildCharacterMap);return <CharacterCards vm={vm} editing={{busy,selectedRelations:[],targetSource:a.item.id,onSelect:vi.fn(),onConnect:vi.fn(),onRelation:vi.fn(),onPick}}/>};return <Harness/>}
 render(harness(false))
 const card=screen.getByRole('group',{name:'나래 인물 카드'})
 expect(card.classList.contains('draggable')).toBe(false)
 fireEvent.click(card)
 expect(onPick).toHaveBeenCalledOnce();expect(onPick).toHaveBeenCalledWith(b.item.id)
 cleanup();onPick.mockClear()
 render(harness(true))
 fireEvent.click(screen.getByRole('group',{name:'나래 인물 카드'}))
 expect(onPick).not.toHaveBeenCalled()
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

it('캔버스 상자가 숨겨져 크기가 0이면 React Flow를 그리지 않고(0×0 상자에서는 경고가 반복되고 화면 맞춤이 NaN 좌표를 만든다), 보이게 되면 다시 그리며 끌어 둔 카드 위치 같은 화면 상태는 그대로다',()=>{
 const a=newSetting('people');a.item.title='가람'
 function Harness(){const vm=useWorldMapViewModel([a],buildCharacterMap);return <CharacterCards vm={vm} editing={{busy:false,selectedRelations:[],targetSource:null,onSelect:vi.fn(),onConnect:vi.fn(),onRelation:vi.fn()}}/>}
 const width=vi.spyOn(Element.prototype,'clientWidth','get').mockReturnValue(0),height=vi.spyOn(Element.prototype,'clientHeight','get').mockReturnValue(0)
 render(<Harness/>)
 expect(screen.getByRole('group',{name:'인물 카드 그래프'}).querySelector('.react-flow')).toBeNull() // 숨은 상자에서는 그리지 않는다
 expect(screen.queryByRole('group',{name:'가람 인물 카드'})).toBeNull()
 width.mockReturnValue(800);height.mockReturnValue(600);act(()=>notifyResize()) // 보이게 된다
 expect(screen.getByRole('group',{name:'가람 인물 카드'})).toBeTruthy()
 width.mockReturnValue(0);height.mockReturnValue(0);act(()=>notifyResize()) // 다시 숨는다
 expect(screen.queryByRole('group',{name:'가람 인물 카드'})).toBeNull()
 width.mockRestore();height.mockRestore()
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
/** React Flow 노드 래퍼의 위치(좌표는 카드의 왼쪽 위 모서리). */
const at=(name:string)=>{const el=screen.getByRole('group',{name});return /translate\(([-\d.]+)px,\s*([-\d.]+)px\)/.exec(el.style.transform)!.slice(1).map(Number)}
it('center를 주면 중심 카드를 가운데에 두고 이웃을 둘레에 놓으며 라벨은 중심 카드에 닿는 선에만 그린다',()=>{
 const {a,rows}=triangle()
 function Harness(){const vm=useWorldMapViewModel(rows,buildCharacterMap);return <CharacterCards vm={{...vm,graph:mapNeighbors(vm.graph,a.item.id,0,12)}} center={a.item.id} editing={actions()}/>}
 render(<Harness/>)
 const [cx,cy]=at('가람 인물 카드'),[bx,by]=at('나래 인물 카드'),[dx,dy]=at('다온 인물 카드')
 expect(Math.round(bx-cx)).toBe(0) // 첫 이웃은 중심 바로 위
 expect(by).toBeLessThan(cy)
 expect(dy).toBeGreaterThan(by) // 둘째 이웃은 시계 방향(아래쪽)
 expect(Math.hypot(bx-cx,by-cy)).toBeCloseTo(Math.hypot(dx-cx,dy-cy),5) // 같은 원 위
 expect(screen.getByRole('group',{name:'가람 인물 카드'}).style.width).toBe('200px') // 카드는 늘 같은 크기다(화면에 맞춘 축소는 캔버스 확대·축소가 맡는다)
 expect(screen.getByRole('group',{name:'가람 인물 카드'}).style.height).toBe('150px')
 expect(labels()).toHaveLength(2) // 나래↔다온 선은 이 보기에 없고(중심에 닿는 이웃 선만), 둘 다 중심 카드에 닿는다
})
it('center 없는 전체 보기는 모든 카드를 격자에 깔고(서로 겹치지 않는다), 라벨은 선에 마우스를 올리거나 초점을 둘 때만 그 선 하나에 보이며 선은 툴팁·이름으로 계속 읽힌다',()=>{
 const {a,rows}=triangle()
 let pick!:(id:string|null)=>void
 function Harness(){const vm=useWorldMapViewModel(rows,buildCharacterMap);pick=vm.select;return <CharacterCards vm={vm} editing={actions()}/>}
 render(<Harness/>)
 const spots=['가람','나래','다온'].map(n=>at(n+' 인물 카드'))
 for(const [i,p] of spots.entries())for(const q of spots.slice(i+1))expect(Math.abs(p[0]-q[0])<200&&Math.abs(p[1]-q[1])<150).toBe(false) // 카드 겹침 없음
 expect(labels()).toEqual([]) // 고르기 전에는 없다
 expect(screen.getAllByRole('button',{name:/관계선 편집/})).toHaveLength(3) // 선은 읽히고 누를 수 있다
 expect(document.querySelectorAll('.relationship-edge-hit title')).toHaveLength(3) // <title> 툴팁
 act(()=>pick(a.item.id))
 expect(labels()).toEqual([]) // 고른 카드의 선이어도 올리기 전에는 없다(겹친 라벨을 피한다)
 const edge=screen.getAllByRole('button',{name:/관계선 편집/})[0]
 fireEvent.mouseEnter(edge);expect(labels()).toHaveLength(1)
 fireEvent.mouseLeave(edge);expect(labels()).toEqual([])
 fireEvent.focus(edge);expect(labels()).toHaveLength(1)
 fireEvent.blur(edge);expect(labels()).toEqual([])
 expect(document.querySelectorAll('.relationship-kind')).toHaveLength(3) // 카드마다 유형 점
})
it('관계선을 누르면 그 관계의 편집(onRelation)을 부르고 처리 중(busy)에는 부르지 않으며, 방향이 있는 관계만 화살표(marker)를 가진다',()=>{
 const a=newSetting('people'),b=newSetting('people'),c=newSetting('people');a.item.title='가람';b.item.title='나래';c.item.title='다온'
 let rows=putRelation([a,b,c],{subjectId:a.item.id,targetId:b.item.id,predicate:'parent_of',polarity:'asserted'}) // 방향 관계
 rows=putRelation(rows,{subjectId:b.item.id,targetId:c.item.id,predicate:'friend_of',polarity:'asserted'}) // 대칭 관계
 const [parent,friend]=rows.filter(s=>s.item.kind==='relation').map(s=>s.item.id)
 const onRelation=vi.fn()
 const harness=(busy:boolean)=>{function Harness(){const vm=useWorldMapViewModel(rows,buildCharacterMap);return <CharacterCards vm={vm} editing={{...actions(),busy,onRelation}}/>};return <Harness/>}
 render(harness(false))
 expect(document.querySelectorAll('.react-flow__edges path[marker-end]')).toHaveLength(1) // 대칭 관계(친구)에는 화살표가 없다
 fireEvent.click(screen.getByRole('button',{name:/관계선 편집: 가람 · 나래/}))
 expect(onRelation).toHaveBeenCalledOnce();expect(onRelation).toHaveBeenCalledWith(parent)
 fireEvent.click(screen.getByRole('button',{name:/관계선 편집: 나래 · 다온/}))
 expect(onRelation).toHaveBeenLastCalledWith(friend)
 cleanup();onRelation.mockClear()
 render(harness(true))
 fireEvent.click(screen.getByRole('button',{name:/관계선 편집: 가람 · 나래/}))
 expect(onRelation).not.toHaveBeenCalled()
})
it('검색에 걸리지 않은 카드는 dim으로 흐리고 고른 카드는 aria-current와 selected, 상대를 고르는 중 다른 카드는 target이다',()=>{
 const a=newSetting('people'),b=newSetting('people');a.item.title='가람';b.item.title='나래'
 let vmRef!:ReturnType<typeof useWorldMapViewModel>
 function Harness(){const vm=useWorldMapViewModel([a,b],buildCharacterMap);vmRef=vm;return <CharacterCards vm={vm} editing={{...actions(),targetSource:a.item.id}}/>}
 render(<Harness/>)
 act(()=>vmRef.setQuery('나래'));act(()=>vmRef.select(b.item.id))
 const card=(name:string)=>screen.getByRole('group',{name}).querySelector('.relationship-character-card')!
 expect(card('가람 인물 카드').classList.contains('dim')).toBe(true)
 expect(card('나래 인물 카드').classList.contains('dim')).toBe(false)
 expect(card('나래 인물 카드').classList.contains('selected')).toBe(true)
 expect(screen.getByRole('group',{name:'나래 인물 카드'}).getAttribute('aria-current')).toBe('true')
 expect(card('나래 인물 카드').classList.contains('target')).toBe(true) // 상대를 고르는 중 시작 카드가 아닌 카드
 expect(card('가람 인물 카드').classList.contains('target')).toBe(false)
 expect(screen.getByRole('button',{name:'나래 상대 선택'})).toBeTruthy()
})

/** 허브 하나가 이웃 n장과 이어진 세계(모든 선이 허브에 닿는다). */
function hub(n:number) {
 const h=newSetting('people');h.item.title='허브'
 const others=Array.from({length:n},(_,i)=>{const s=newSetting('people');s.item.title='이웃 '+i;return s})
 const rows=others.reduce((r,o)=>putRelation(r,{subjectId:h.item.id,targetId:o.item.id,predicate:'friend_of',polarity:'asserted'}),[h,...others])
 return {h,rows}
}
it('간선 그림은 카드 아래 층이고 라벨은 별도 SVG로 카드 위 층(뷰포트 포털)에 그려지며 선 방향으로 눕는다(거꾸로 뒤집히지 않는다)',()=>{
 const {h,rows}=hub(4)
 function Harness(){const vm=useWorldMapViewModel(rows,buildCharacterMap);return <CharacterCards vm={{...vm,graph:mapNeighbors(vm.graph,h.item.id,0,12)}} center={h.item.id} editing={actions()}/>}
 render(<Harness/>)
 const edges=document.querySelector('.react-flow__edges')!,nodes=document.querySelector('.react-flow__nodes')!,layer=document.querySelector('svg.relationship-card-labels')!
 expect(edges.compareDocumentPosition(nodes)&Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy() // 간선 층이 카드 층보다 앞(아래)
 expect(nodes.compareDocumentPosition(layer)&Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy() // 라벨 SVG는 카드 층보다 뒤(위)
 expect(layer.closest('.react-flow__viewport-portal')).toBeTruthy()
 expect(layer.getAttribute('aria-hidden')).toBe('true') // 같은 말은 선 버튼의 이름과 툴팁이 이미 읽힌다
 expect(edges.querySelector('text')).toBeNull()
 const texts=[...layer.querySelectorAll('text.relationship-edge-label')]
 expect(texts).toHaveLength(4)
 const angles=texts.map(t=>Number(/rotate\((-?[\d.]+) /.exec(t.getAttribute('transform')!)![1]))
 for(const deg of angles){expect(deg).toBeGreaterThan(-90);expect(deg).toBeLessThanOrEqual(90)}
 expect(angles.some(deg=>Math.abs(deg)<1)).toBe(true) // 오른쪽·왼쪽 이웃으로 가는 가로선은 눕지 않고
 expect(angles.some(deg=>Math.abs(deg-90)<1)).toBe(true) // 위·아래 이웃으로 가는 세로선은 90°다
})

it('전체 보기에서 카드(버튼)에 키보드 초점이 가면 그 카드에 닿는 선의 라벨이 보이고, 같은 카드 안에서 초점이 옮겨 가도 유지되며 카드를 떠나면 사라진다',()=>{
 const {a,rows}=triangle()
 function Harness(){const vm=useWorldMapViewModel(rows,buildCharacterMap);return <CharacterCards vm={vm} editing={actions()}/>}
 render(<Harness/>)
 expect(labels()).toEqual([])
 const info=screen.getByRole('button',{name:'가람 정보 편집'}),connect=screen.getByRole('button',{name:'가람 관계 연결'}),other=screen.getByRole('button',{name:'나래 정보 편집'})
 fireEvent.focus(info)
 expect(labels()).toHaveLength(2) // 가람에 닿는 선 둘뿐(나래↔다온은 가람에 닿지 않는다)
 fireEvent.blur(info,{relatedTarget:connect}) // 같은 카드의 다른 버튼으로 옮겨 간다
 fireEvent.focus(connect)
 expect(labels()).toHaveLength(2)
 fireEvent.blur(connect,{relatedTarget:other}) // 다른 카드로 떠난다
 fireEvent.focus(other)
 expect(labels()).toHaveLength(2) // 나래에 닿는 선 둘(가람·다온)
 fireEvent.blur(other,{relatedTarget:null})
 expect(labels()).toEqual([])
 expect(a.item.title).toBe('가람')
})

/** React Flow 뷰포트의 transform(배율). 화면 맞춤이 어떻게 돼 있는지 본다. */
const zoomOf=()=>Number(/scale\(([\d.]+)\)/.exec(document.querySelector<HTMLElement>('.react-flow__viewport')!.style.transform)?.[1])
it('처음에는 모든 카드가 상자 안에 들어오게 화면을 맞추고(카드가 읽히는 1배까지), 컨트롤의 화면 맞춤 버튼은 끌어 옮기거나 확대한 뒤에도 같은 맞춤으로 되돌린다',async()=>{
 const {rows}=triangle()
 function Harness(){const vm=useWorldMapViewModel(rows,buildCharacterMap);return <CharacterCards vm={vm} editing={actions()}/>}
 render(<Harness/>)
 const fitted=zoomOf()
 expect(fitted).toBeLessThan(1) // 격자 3열(888px)이 상자 폭 800px보다 넓어 줄여서 맞춘다
 expect(fitted).toBeGreaterThanOrEqual(.15)
 fireEvent.click(screen.getByRole('button',{name:'확대'}))
 await waitFor(()=>expect(zoomOf()).toBeGreaterThan(fitted))
 fireEvent.click(screen.getByRole('button',{name:'화면에 맞추기'}))
 await waitFor(()=>expect(zoomOf()).toBeCloseTo(fitted,5))
})
it('중심 카드가 바뀌면 화면을 다시 맞추고, 카드 하나뿐이면 늘리지 않고 원래 크기(1배)로 둔다',async()=>{
 const a=newSetting('people');a.item.title='가람'
 const {a:hubA,rows}=triangle()
 function Alone(){const vm=useWorldMapViewModel([a],buildCharacterMap);return <CharacterCards vm={vm} editing={actions()}/>}
 render(<Alone/>)
 expect(zoomOf()).toBe(1)
 cleanup()
 let setCenter!:(id:string|undefined)=>void
 function Switch(){const vm=useWorldMapViewModel(rows,buildCharacterMap),[center,set]=useState<string|undefined>(undefined);setCenter=set;return <CharacterCards vm={center?{...vm,graph:mapNeighbors(vm.graph,center,0,12)}:vm} center={center} editing={actions()}/>}
 render(<Switch/>)
 const all=zoomOf()
 act(()=>setCenter(hubA.item.id)) // 중심 보기: 원 둘레로 다시 배치되니 화면도 다시 맞춘다
 await waitFor(()=>expect(zoomOf()).not.toBeCloseTo(all,3))
})

/** React Flow의 끌기(d3-drag)는 mousedown·mouseup의 view(창)를 쓴다. jsdom은 생성자의 view로 vitest의 window를 받지 않으니(Window 판별 실패) 이벤트를 만든 뒤에 붙인다. */
const mouse=(el:Element,type:'mouseDown'|'mouseMove'|'mouseUp',x:number,y:number)=>{const e=createEvent[type](el,{clientX:x,clientY:y,button:0});Object.defineProperty(e,'view',{value:window});fireEvent(el,e)}
it('카드를 끌면 그 카드만 옮겨지고(다른 카드는 그대로) 위치는 저장하지 않으며, 끌고 놓은 직후의 click은 본문 누르기로 치지 않는다',async()=>{
 const a=newSetting('people'),b=newSetting('people');a.item.title='가람';b.item.title='나래'
 const onPick=vi.fn()
 function Harness(){const vm=useWorldMapViewModel([a,b],buildCharacterMap);return <CharacterCards vm={vm} editing={{...actions(),onPick}}/>}
 render(<Harness/>)
 const card=screen.getByRole('group',{name:'가람 인물 카드'}),beforeA=at('가람 인물 카드'),beforeB=at('나래 인물 카드')
 mouse(card,'mouseDown',100,100)
 mouse(card,'mouseMove',130,120) // 문턱(4px)을 넘으면 끌기가 시작되고, 카드는 이 자리부터 손을 따라간다
 mouse(card,'mouseMove',170,140)
 mouse(card,'mouseUp',170,140)
 fireEvent.click(card) // 브라우저는 손을 뗀 바로 그 순간에 click을 보낸다: React Flow가 이 click을 막아 본문 누르기가 되지 않는다
 expect(onPick).not.toHaveBeenCalled()
 await waitFor(()=>expect(at('가람 인물 카드')[0]-beforeA[0]).toBeGreaterThan(30)) // 오른쪽으로 옮겨졌다(손 40px = 캔버스 좌표 40px÷배율, 배율은 1 이하)
 expect(at('가람 인물 카드')[1]-beforeA[1]).toBeGreaterThan(15)
 expect(at('나래 인물 카드')).toEqual(beforeB) // 다른 카드는 그대로
 await new Promise((resolve)=>setTimeout(resolve,0)) // 막는 장치는 다음 순간에 풀린다
 fireEvent.click(card)
 expect(onPick).toHaveBeenCalledOnce() // 그다음 누르기는 받는다
 cleanup() // 위치는 화면 상태일 뿐이라 다시 그리면 배치로 돌아간다
 render(<Harness/>)
 expect(at('가람 인물 카드')).toEqual(beforeA)
})
it('캔버스가 떠 있는 동안에도 Space·Backspace 같은 페이지 키를 가로채지 않는다(React Flow의 기본 단축키는 document의 keydown을 막아 Space로 페이지를 내릴 수 없게 된다)',()=>{
 const a=newSetting('people');a.item.title='가람'
 function Harness(){const vm=useWorldMapViewModel([a],buildCharacterMap);return <CharacterCards vm={vm} editing={actions()}/>}
 render(<Harness/>)
 for(const init of [{key:' ',code:'Space'},{key:'Backspace',code:'Backspace'}]){
  const event=createEvent.keyDown(document.body,init)
  fireEvent(document.body,event)
  expect(event.defaultPrevented,init.code).toBe(false)
 }
})
it('키보드 초점이 간 카드가 캔버스 밖이면 그 카드가 가운데 오게 옮기고, 이미 보이는 카드는 가만둔다(React Flow는 카드 안 버튼의 초점을 따라가지 않는다)',async()=>{
 const a=newSetting('people'),b=newSetting('people');a.item.title='가람';b.item.title='나래'
 function Harness(){const vm=useWorldMapViewModel([a,b],buildCharacterMap);return <CharacterCards vm={vm} editing={actions()}/>}
 render(<Harness/>)
 const viewport=()=>/translate\(([-\d.]+)px,\s*([-\d.]+)px\)/.exec(document.querySelector<HTMLElement>('.react-flow__viewport')!.style.transform)!.slice(1).map(Number)
 const box=(left:number,top:number,width:number,height:number)=>({left,top,width,height,right:left+width,bottom:top+height,x:left,y:top,toJSON:()=>({})}) as DOMRect
 // jsdom은 화면 배치를 모른다: 캔버스는 800×600, 나래 카드만 그 오른쪽 밖에 있다고 알려 준다.
 const spy=vi.spyOn(Element.prototype,'getBoundingClientRect').mockImplementation(function(this:Element){
  if(this.classList.contains('react-flow'))return box(0,0,800,600)
  if(this.classList.contains('relationship-character-card'))return this.textContent?.includes('나래')?box(900,100,200,150):box(100,100,200,150)
  return box(0,0,0,0)
 })
 try{
  const before=viewport()
  fireEvent.focus(screen.getByRole('button',{name:'가람 정보 편집'}))
  expect(viewport()).toEqual(before) // 이미 보이는 카드는 가만둔다
  fireEvent.focus(screen.getByRole('button',{name:'나래 정보 편집'}))
  const [nx,ny]=at('나래 인물 카드'),zoom=zoomOf()
  await waitFor(()=>{ // 카드 가운데(카드 좌표 + 100, +75)가 캔버스 가운데(400, 300)에 온다
   expect(viewport()[0]).toBeCloseTo(400-(nx+100)*zoom,1)
   expect(viewport()[1]).toBeCloseTo(300-(ny+75)*zoom,1)
  })
  expect(zoomOf()).toBeCloseTo(zoom,5) // 배율은 그대로
 }finally{spy.mockRestore()}
})

/** React Flow 뷰포트의 이동(translate, 캔버스 좌표 0,0이 화면 어디에 놓이는지). */
const viewportOf=()=>/translate\(([-\d.]+)px,\s*([-\d.]+)px\)/.exec(document.querySelector<HTMLElement>('.react-flow__viewport')!.style.transform)!.slice(1).map(Number)
/** 인물 n장(제목 인물1…). */
const crowd=(n:number)=>Array.from({length:n},(_,i)=>{const s=newSetting('people');s.item.title=`인물${i+1}`;return s})
/** 허브 한 장이 이웃 k장과 이어진 세계. */
function star(k:number){const hub=newSetting('people');hub.item.title='허브';const rest=crowd(k);let rows=[hub,...rest];for(const o of rest)rows=putRelation(rows,{subjectId:hub.item.id,targetId:o.item.id,predicate:'friend_of',polarity:'asserted'});return {hub,rows}}
/** 캔버스(800×600) 안에 카드(200×150) 전체가 들어오는지: 카드마다 뷰포트 이동·배율을 적용한 화면 사각형을 본다. */
const insideCanvas=(name:string)=>{const [vx,vy]=viewportOf(),z=zoomOf(),[x,y]=at(name);return vx+x*z>=0&&vy+y*z>=0&&vx+(x+200)*z<=800&&vy+(y+150)*z<=600}
it('중심 보기에서 이웃이 많아 한눈에 못 들어오면 카드 글자가 읽히는 0.7배로 시작하고 중심 카드가 캔버스 가운데에 온다(넘치는 이웃은 끌어서 본다)',()=>{
 const {hub,rows}=star(12)
 function Harness(){const vm=useWorldMapViewModel(rows,buildCharacterMap);return <CharacterCards vm={{...vm,graph:mapNeighbors(vm.graph,hub.item.id,0,12)}} center={hub.item.id} editing={actions()}/>}
 render(<Harness/>)
 expect(zoomOf()).toBeCloseTo(0.7,5) // 다 넣으면 0.41배라 글자를 읽을 수 없다
 const [vx,vy]=viewportOf(),[cx,cy]=at('허브 인물 카드')
 expect(vx+(cx+100)*0.7).toBeCloseTo(400,1) // 중심 카드의 가운데가 캔버스(800×600)의 가운데
 expect(vy+(cy+75)*0.7).toBeCloseTo(300,1)
})
it('중심 보기에서 이웃이 적어 0.7배 이상으로 들어오면 전부 보이게 맞춘다(배율을 더 줄이지도, 억지로 낮추지도 않는다)',()=>{
 const {hub,rows}=star(3)
 function Harness(){const vm=useWorldMapViewModel(rows,buildCharacterMap);return <CharacterCards vm={{...vm,graph:mapNeighbors(vm.graph,hub.item.id,0,12)}} center={hub.item.id} editing={actions()}/>}
 render(<Harness/>)
 expect(zoomOf()).toBeGreaterThanOrEqual(0.7)
 expect(zoomOf()).toBeLessThan(1)
 for(const name of ['허브 인물 카드','인물1 인물 카드','인물2 인물 카드','인물3 인물 카드'])expect(insideCanvas(name),name).toBe(true)
})
it('전체 보기에서 카드가 많아 한눈에 못 들어오면 0.45배로 시작해 왼쪽 위 카드부터 보이고, 화면에 맞추기 버튼은 그보다 줄여 전체를 보여 준다',async()=>{
 function Harness(){const vm=useWorldMapViewModel(crowd(20),buildCharacterMap);return <CharacterCards vm={vm} editing={actions()}/>}
 render(<Harness/>)
 expect(zoomOf()).toBeCloseTo(0.45,5) // 다 넣으면 0.32배
 expect(viewportOf()).toEqual([24,24]) // 첫 카드가 왼쪽 위 가장자리(24px)에 놓인다
 expect(insideCanvas('인물1 인물 카드')).toBe(true)
 expect(insideCanvas('인물6 인물 카드')).toBe(false) // 오른쪽 끝 열은 캔버스 밖으로 넘친다(끌어서 본다)
 fireEvent.click(screen.getByRole('button',{name:'화면에 맞추기'}))
 await waitFor(()=>expect(zoomOf()).toBeLessThan(0.4))
 expect(zoomOf()).toBeGreaterThanOrEqual(0.15)
 for(const name of ['인물1 인물 카드','인물6 인물 카드','인물20 인물 카드'])expect(insideCanvas(name),name).toBe(true) // 전체가 들어온다
})

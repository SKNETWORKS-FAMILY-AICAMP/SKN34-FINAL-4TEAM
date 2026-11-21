// @vitest-environment jsdom
import { notifyResize } from '../../../../test/reactFlowStubs'
import { useState } from 'react'
import { act,cleanup,createEvent,fireEvent,render,renderHook,screen,waitFor,within } from '@testing-library/react'
import { afterEach,expect,it,vi } from 'vitest'
import { newSetting } from '../../../../domain/entities/studioWorld'
import { useWorldMapViewModel } from '../viewmodel/useWorldMapViewModel'
import { buildCharacterMap } from '../viewmodel/characterMap'
import { putRelation } from '../../../../domain/entities/studioRelations'
import CharacterCards from './CharacterCards'
afterEach(()=>{cleanup();vi.unstubAllGlobals();vi.useRealTimers()})

type Rows=ReturnType<typeof newSetting>[]
const actions=(over:Record<string,unknown>={})=>({busy:false,selectedRelations:[] as string[],targetSource:null as string|null,deleteLock:'',onPick:vi.fn(),onSelect:vi.fn(),onConnect:vi.fn(),onPair:vi.fn(),onRelation:vi.fn(),onDeleteCard:vi.fn(),onDeleteRelation:vi.fn(),onAdd:vi.fn(),onMark:vi.fn(),...over})
/** 가람이 나래·다온과, 나래가 다온과 이어진 세계(선 3개). */
function triangle(){
 const a=newSetting('people'),b=newSetting('people'),c=newSetting('people');a.item.title='가람';b.item.title='나래';c.item.title='다온'
 let rows=putRelation([a,b,c],{subjectId:a.item.id,targetId:b.item.id,predicate:'friend_of',polarity:'asserted'})
 rows=putRelation(rows,{subjectId:a.item.id,targetId:c.item.id,predicate:'friend_of',polarity:'asserted'})
 rows=putRelation(rows,{subjectId:b.item.id,targetId:c.item.id,predicate:'friend_of',polarity:'asserted'})
 return {a,b,c,rows}
}
const crowd=(n:number)=>Array.from({length:n},(_,i)=>{const s=newSetting('people');s.item.title='인물'+(i+1);return s})
function Cards({rows,editing,find}:{rows:Rows;editing:ReturnType<typeof actions>;find?:{id:string;seq:number}|null}){const vm=useWorldMapViewModel(rows,buildCharacterMap);return <CharacterCards vm={vm} editing={editing} find={find}/>}
const flowEl=()=>screen.getByRole('group',{name:/카드 그래프$/})
const card=(name:string)=>screen.getByRole('group',{name:name+' 인물 카드'})
const at=(name:string)=>{const el=card(name);return /translate\(([-\d.]+)px,\s*([-\d.]+)px\)/.exec(el.style.transform)!.slice(1).map(Number)}
const viewportOf=()=>/translate\(([-\d.]+)px,\s*([-\d.]+)px\)/.exec(document.querySelector<HTMLElement>('.react-flow__viewport')!.style.transform)!.slice(1).map(Number)
const zoomOf=()=>Number(/scale\(([\d.]+)\)/.exec(document.querySelector<HTMLElement>('.react-flow__viewport')!.style.transform)?.[1])
/** 캔버스(800×600) 안에 카드(200×150) 전체가 들어오는지. */
const insideCanvas=(name:string)=>{const [vx,vy]=viewportOf(),z=zoomOf(),[x,y]=at(name);return vx+x*z>=0&&vy+y*z>=0&&vx+(x+200)*z<=800&&vy+(y+150)*z<=600}
const hit=(re:RegExp)=>screen.getByRole('button',{name:re})
const labels=()=>Array.from(document.querySelectorAll('text.relationship-edge-label'),t=>t.textContent)
/** React Flow의 끌기(d3-drag)는 mousedown·mouseup의 view(창)를 쓴다. jsdom은 생성자의 view로 vitest의 window를 받지 않으니(Window 판별 실패) 이벤트를 만든 뒤에 붙인다. */
const mouse=(el:Element,type:'mouseDown'|'mouseMove'|'mouseUp',x:number,y:number)=>{const e=createEvent[type](el,{clientX:x,clientY:y,button:0});Object.defineProperty(e,'view',{value:window});fireEvent(el,e)}

it('캔버스는 점 격자 배경·확대/축소/화면 맞춤 컨트롤(잠금 버튼 없음)과 왼쪽 위 도구 막대(+ 설정 추가·배치 정돈·화면 맞춤) 위에 카드를 놓고, 카드 버튼은 끌기에 먹히지 않는 nodrag이며 각자 콜백만 부른다',()=>{
 const {rows,a}=triangle(),editing=actions()
 render(<Cards rows={rows} editing={editing}/>)
 const flow=flowEl()
 expect(flow.querySelector('.react-flow__background-pattern.dots')).toBeTruthy()
 for(const name of ['확대','축소','화면에 맞추기'])expect(within(flow).getByRole('button',{name})).toBeTruthy()
 expect(within(flow).queryByRole('button',{name:/잠금|interactiv/i})).toBeNull()
 const tools=within(flow).getByRole('toolbar',{name:'관계도 도구'})
 expect(within(tools).getAllByRole('button').map(b=>b.textContent)).toEqual(['+ 설정 추가','배치 정돈','화면 맞춤'])
 const garam=card('가람')
 expect(garam.getAttribute('data-id')).toBe(a.item.id)
 expect(garam.classList.contains('draggable')).toBe(true)
 for(const button of within(garam).getAllByRole('button'))expect(button.closest('.nodrag'),button.textContent??'').toBeTruthy()
 fireEvent.click(within(garam).getByRole('button',{name:'가람 관계 연결'}))
 expect(editing.onConnect).toHaveBeenCalledWith(a.item.id)
 fireEvent.click(within(garam).getByRole('button',{name:'가람 정보 편집'}))
 expect(editing.onSelect).toHaveBeenCalledWith(a.item.id)
 expect(editing.onPick).not.toHaveBeenCalled()
})

it('카드 본문을 누르면 onPick(선택), 더블클릭하면 정보 편집(onSelect)이고, 카드 안 버튼을 누를 때는 onPick을 부르지 않으며 처리 중(busy)에는 아무것도 받지 않는다',()=>{
 const {rows,a,b}=triangle(),editing=actions()
 const {rerender}=render(<Cards rows={rows} editing={editing}/>)
 fireEvent.click(card('가람'))
 expect(editing.onPick).toHaveBeenCalledWith(a.item.id)
 fireEvent.click(within(card('나래')).getByRole('button',{name:'나래 정보 편집'}))
 expect(editing.onPick).toHaveBeenCalledTimes(1)
 fireEvent.doubleClick(card('나래'))
 expect(editing.onSelect).toHaveBeenCalledWith(b.item.id)
 const busy=actions({busy:true})
 rerender(<Cards rows={rows} editing={busy}/>)
 fireEvent.click(card('가람'));fireEvent.doubleClick(card('가람'))
 expect(busy.onPick).not.toHaveBeenCalled();expect(busy.onSelect).not.toHaveBeenCalled()
 expect(within(card('가람')).getByRole<HTMLButtonElement>('button',{name:'가람 관계 연결'}).disabled).toBe(true)
})

it('상대를 고르는 중에는 카드의 상대 선택 버튼과 본문 누르기가 onPick을 부르고 그때는 카드를 끌 수 없으며 연결 시작 카드의 상대 선택은 잠긴다',()=>{
 const {rows,a,b}=triangle(),editing=actions({targetSource:a.item.id})
 render(<Cards rows={rows} editing={editing}/>)
 expect(card('나래').classList.contains('draggable')).toBe(false)
 expect(within(card('가람')).getByRole<HTMLButtonElement>('button',{name:'가람 상대 선택'}).disabled).toBe(true)
 fireEvent.click(within(card('나래')).getByRole('button',{name:'나래 상대 선택'}))
 expect(editing.onPick).toHaveBeenCalledWith(b.item.id)
 expect(within(card('나래')).queryByRole('button',{name:'나래 관계 연결'})).toBeNull()
 fireEvent.click(card('다온'))
 expect(editing.onPick).toHaveBeenCalledTimes(2)
})

it('카드 요약과 말풍선(title)은 본문의 링크 원문 대신 링크 글자만 보이고, 검색도 보이는 요약에 맞춘다 (#485 QA)',()=>{
 const a=newSetting('people'),b=newSetting('people');a.item.title='가람';b.item.title='나래'
 a.item.text='[나래](card:3f95a1c2-0b6d-4c1e-9a77-5e0d2c8b1a10)의 오랜 벗'
 render(<Cards rows={[a,b]} editing={actions()}/>)
 const summary=screen.getByText('나래의 오랜 벗')
 expect(summary.getAttribute('title')).toBe('나래의 오랜 벗')
 expect(document.body.textContent).not.toContain('card:')
 const {result}=renderHook(()=>useWorldMapViewModel([a,b],buildCharacterMap))
 act(()=>result.current.setQuery('3f95a1c2'));expect(result.current.results).toEqual([]) // 링크 주소 조각은 화면에 없으니 찾히지 않는다
 act(()=>result.current.setQuery('오랜 벗'));expect(result.current.results.map(n=>n.id)).toEqual([a.item.id])
})

it('캔버스 상자가 숨겨져 크기가 0이면 React Flow를 그리지 않고(0×0 상자에서는 경고가 반복되고 화면 맞춤이 NaN 좌표를 만든다), 보이게 되면 다시 그리며 끌어 둔 카드 위치 같은 화면 상태는 그대로다',()=>{
 const a=newSetting('people');a.item.title='가람'
 const width=vi.spyOn(Element.prototype,'clientWidth','get').mockReturnValue(0),height=vi.spyOn(Element.prototype,'clientHeight','get').mockReturnValue(0)
 render(<Cards rows={[a]} editing={actions()}/>)
 expect(flowEl().querySelector('.react-flow')).toBeNull()
 expect(screen.queryByRole('group',{name:'가람 인물 카드'})).toBeNull()
 width.mockReturnValue(800);height.mockReturnValue(600);act(()=>notifyResize())
 expect(screen.getByRole('group',{name:'가람 인물 카드'})).toBeTruthy()
 width.mockReturnValue(0);height.mockReturnValue(0);act(()=>notifyResize())
 expect(screen.queryByRole('group',{name:'가람 인물 카드'})).toBeNull()
 width.mockRestore();height.mockRestore()
})

it('고른 카드는 aria-current와 selected, 상대를 고르는 중 다른 카드는 target, 검색에 걸리지 않은 카드는 dim이다',()=>{
 const {rows,b}=triangle(),editing=actions({targetSource:b.item.id})
 function Harness(){const vm=useWorldMapViewModel(rows,buildCharacterMap);return <><button onClick={()=>vm.select(b.item.id)}>고르기</button><button onClick={()=>vm.setQuery('가람')}>검색</button><CharacterCards vm={vm} editing={editing}/></>}
 render(<Harness/>)
 fireEvent.click(screen.getByRole('button',{name:'고르기'}))
 expect(card('나래').getAttribute('aria-current')).toBe('true')
 expect(card('나래').querySelector('.relationship-character-card')!.classList.contains('selected')).toBe(true)
 expect(card('가람').querySelector('.relationship-character-card')!.classList.contains('target')).toBe(true)
 expect(card('나래').querySelector('.relationship-character-card')!.classList.contains('target')).toBe(false)
 fireEvent.click(screen.getByRole('button',{name:'검색'}))
 expect(card('나래').querySelector('.relationship-character-card')!.classList.contains('dim')).toBe(true)
 expect(card('가람').querySelector('.relationship-character-card')!.classList.contains('dim')).toBe(false)
})

it('관계선을 누르면 편집(onRelation), Enter도 편집, Delete·Backspace는 삭제(onDeleteRelation)이고 처리 중(busy)에는 아무것도 받지 않으며 방향이 있는 관계만 화살표(marker)를 가진다',()=>{
 const {rows}=triangle(),editing=actions()
 const {rerender}=render(<Cards rows={rows} editing={editing}/>)
 const ab=hit(/관계선 편집: 가람 · 나래/)
 expect(ab.tabIndex).toBe(0) // 선도 Tab으로 간다
 fireEvent.click(ab)
 expect(editing.onRelation).toHaveBeenCalledTimes(1)
 const id=editing.onRelation.mock.calls[0][0] as string
 fireEvent.keyDown(ab,{key:'Enter'})
 expect(editing.onRelation).toHaveBeenCalledTimes(2)
 fireEvent.keyDown(ab,{key:'Delete'})
 expect(editing.onDeleteRelation).toHaveBeenCalledWith(id)
 fireEvent.keyDown(ab,{key:'Backspace'})
 expect(editing.onDeleteRelation).toHaveBeenCalledTimes(2)
 const busy=actions({busy:true})
 rerender(<Cards rows={rows} editing={busy}/>)
 fireEvent.click(hit(/관계선 편집: 가람 · 나래/));fireEvent.keyDown(hit(/관계선 편집: 가람 · 나래/),{key:'Delete'})
 expect(busy.onRelation).not.toHaveBeenCalled();expect(busy.onDeleteRelation).not.toHaveBeenCalled()
})

it('방향이 있는 관계만 화살표(marker)를 가지고 대칭 관계(친구)에는 없다',()=>{
 const a=newSetting('people'),b=newSetting('people'),c=newSetting('people');a.item.title='가람';b.item.title='나래';c.item.title='다온'
 let rows=putRelation([a,b,c],{subjectId:a.item.id,targetId:b.item.id,predicate:'parent_of',polarity:'asserted'}) // 방향 관계
 rows=putRelation(rows,{subjectId:b.item.id,targetId:c.item.id,predicate:'friend_of',polarity:'asserted'}) // 대칭 관계
 render(<Cards rows={rows} editing={actions()}/>)
 expect(document.querySelectorAll('.react-flow__edges path[marker-end]')).toHaveLength(1)
})

it('선 가운데 위쪽의 작은 편집·삭제 버튼(마우스 올리면 보인다)이 각자 콜백을 부르고 보조기기에는 숨는다(키보드는 선의 Enter·Delete와 메뉴가 맡는다)',()=>{
 const {rows}=triangle(),editing=actions()
 render(<Cards rows={rows} editing={editing}/>)
 const tools=document.querySelectorAll('.relationship-edge-tools')
 expect(tools).toHaveLength(3)
 const first=tools[0] as SVGGElement
 expect(first.getAttribute('aria-hidden')).toBe('true')
 fireEvent.click(first.querySelector('[data-action=edit]')!)
 expect(editing.onRelation).toHaveBeenCalledTimes(1)
 fireEvent.click(first.querySelector('[data-action=delete]')!)
 expect(editing.onDeleteRelation).toHaveBeenCalledTimes(1)
 expect(first.querySelector('[data-action=edit]')!.textContent).toBe('편집')
 expect(first.querySelector('[data-action=delete]')!.textContent).toBe('삭제')
})

it('간선 그림은 카드 아래 층이고, 라벨은 선에 마우스를 올리거나 초점을 둘 때만 그 선 하나에 별도 SVG(카드 위 층, 뷰포트 포털)로 선 방향에 눕는다',()=>{
 const {rows}=triangle()
 render(<Cards rows={rows} editing={actions()}/>)
 expect(labels()).toEqual([])
 const edges=document.querySelector('.react-flow__edges')!,nodes=document.querySelector('.react-flow__nodes')!
 expect(edges.compareDocumentPosition(nodes)&Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
 fireEvent.mouseEnter(hit(/관계선 편집: 가람 · 나래/))
 expect(labels()).toHaveLength(1)
 const label=document.querySelector('text.relationship-edge-label')!
 expect(label.closest('svg')!.classList.contains('relationship-card-labels')).toBe(true)
 expect(label.closest('.react-flow__viewport-portal')).toBeTruthy()
 expect(label.getAttribute('transform')).toMatch(/^rotate\(/)
 fireEvent.mouseLeave(hit(/관계선 편집: 가람 · 나래/))
 expect(labels()).toEqual([])
})

it('카드(버튼)에 키보드 초점이 가면 그 카드에 닿는 선의 라벨이 보이고, 같은 카드 안에서 초점이 옮겨 가도 유지되며 카드를 떠나면 사라진다',()=>{
 const {rows}=triangle()
 render(<Cards rows={rows} editing={actions()}/>)
 const button=within(card('가람')).getByRole('button',{name:'가람 정보 편집'}),other=within(card('가람')).getByRole('button',{name:'가람 관계 연결'})
 fireEvent.focus(button)
 expect(labels()).toHaveLength(2) // 가람에 닿는 선 2개
 fireEvent.blur(button,{relatedTarget:other});fireEvent.focus(other)
 expect(labels()).toHaveLength(2)
 fireEvent.blur(other,{relatedTarget:within(card('나래')).getByRole('button',{name:'나래 정보 편집'})})
 expect(labels()).toEqual([])
})

it('처음에는 모든 카드가 상자 안에 들어오게 화면을 맞추고, 도구 막대와 컨트롤의 화면 맞춤은 끌어 옮기거나 확대한 뒤에도 같은 맞춤으로 되돌린다',async()=>{
 const {rows}=triangle()
 render(<Cards rows={rows} editing={actions()}/>)
 const fitted=zoomOf()
 expect(fitted).toBeLessThanOrEqual(1)
 for(const name of ['가람','나래','다온'])expect(insideCanvas(name),name).toBe(true)
 fireEvent.click(screen.getByRole('button',{name:'확대'}))
 await waitFor(()=>expect(zoomOf()).toBeGreaterThan(fitted))
 fireEvent.click(within(screen.getByRole('toolbar',{name:'관계도 도구'})).getByRole('button',{name:'화면 맞춤'}))
 await waitFor(()=>expect(zoomOf()).toBeCloseTo(fitted,5))
 fireEvent.click(screen.getByRole('button',{name:'확대'}))
 await waitFor(()=>expect(zoomOf()).toBeGreaterThan(fitted))
 fireEvent.click(screen.getByRole('button',{name:'화면에 맞추기'}))
 await waitFor(()=>expect(zoomOf()).toBeCloseTo(fitted,5))
})

it('카드를 끌면 그 카드만 옮겨지고(다른 카드는 그대로) 위치는 저장하지 않으며, 끌고 놓은 직후의 click은 본문 누르기로 치지 않는다',async()=>{
 const a=newSetting('people'),b=newSetting('people');a.item.title='가람';b.item.title='나래'
 const editing=actions()
 render(<Cards rows={[a,b]} editing={editing}/>)
 const garam=card('가람'),beforeA=at('가람'),beforeB=at('나래')
 mouse(garam,'mouseDown',100,100)
 mouse(garam,'mouseMove',130,120) // 문턱(4px)을 넘으면 끌기가 시작되고, 카드는 이 자리부터 손을 따라간다
 mouse(garam,'mouseMove',170,140)
 mouse(garam,'mouseUp',170,140)
 fireEvent.click(garam) // 브라우저는 손을 뗀 바로 그 순간에 click을 보낸다: React Flow가 이 click을 막아 본문 누르기가 되지 않는다
 expect(editing.onPick).not.toHaveBeenCalled()
 await waitFor(()=>expect(at('가람')[0]-beforeA[0]).toBeGreaterThan(30))
 expect(at('가람')[1]-beforeA[1]).toBeGreaterThan(15)
 expect(at('나래')).toEqual(beforeB)
 await new Promise((resolve)=>setTimeout(resolve,0)) // 막는 장치는 다음 순간에 풀린다
 fireEvent.click(garam)
 expect(editing.onPick).toHaveBeenCalledOnce()
 cleanup()
 render(<Cards rows={[a,b]} editing={actions()}/>)
 expect(at('가람')).toEqual(beforeA) // 위치는 화면 상태일 뿐이라 다시 그리면 배치로 돌아간다
})

it('캔버스가 떠 있는 동안에도 Space·Backspace 같은 페이지 키를 가로채지 않는다(React Flow의 기본 단축키는 document의 keydown을 막아 Space로 페이지를 내릴 수 없게 된다)',()=>{
 const a=newSetting('people');a.item.title='가람'
 render(<Cards rows={[a]} editing={actions()}/>)
 for(const init of [{key:' ',code:'Space'},{key:'Backspace',code:'Backspace'}]){
  const event=createEvent.keyDown(document.body,init)
  fireEvent(document.body,event)
  expect(event.defaultPrevented,init.code).toBe(false)
 }
})

it('카드는 Tab 순서에 들어 있고(초점 받음) 카드 자체에 Enter는 정보 편집, Delete·Backspace는 삭제 확인을 부르며 카드 안 버튼의 Enter는 그 버튼만 누른다',()=>{
 const {rows,a}=triangle(),editing=actions()
 render(<Cards rows={rows} editing={editing}/>)
 const garam=card('가람')
 expect(garam.tabIndex).toBe(0)
 expect(garam.hasAttribute('aria-describedby')).toBe(false) // React Flow의 영어 키보드 안내를 잇지 않는다
 fireEvent.keyDown(garam,{key:'Enter'})
 expect(editing.onSelect).toHaveBeenCalledWith(a.item.id)
 fireEvent.keyDown(garam,{key:'Delete'})
 expect(editing.onDeleteCard).toHaveBeenCalledWith(a.item.id)
 fireEvent.keyDown(garam,{key:'Backspace'})
 expect(editing.onDeleteCard).toHaveBeenCalledTimes(2)
 fireEvent.keyDown(within(garam).getByRole('button',{name:'가람 관계 연결'}),{key:'Enter'})
 expect(editing.onSelect).toHaveBeenCalledTimes(1)
 expect(editing.onDeleteCard).toHaveBeenCalledTimes(2)
})

it('처리 중(busy)에는 카드 자체의 Delete·Backspace도 삭제 확인을 부르지 않는다(메뉴의 잠긴 삭제 항목과 같다)',()=>{
  const {rows}=triangle(),busy=actions({busy:true})
  render(<Cards rows={rows} editing={busy}/>)
  fireEvent.keyDown(card('가람'),{key:'Delete'});fireEvent.keyDown(card('가람'),{key:'Backspace'})
  expect(busy.onDeleteCard).not.toHaveBeenCalled()
})

it('카드(노드 래퍼) 자체에 Tab으로 초점이 가도 캔버스 밖이면 가운데로 옮긴다(disableKeyboardA11y라 React Flow의 자동 이동은 꺼져 있다)',async()=>{
  const a=newSetting('people'),b=newSetting('people');a.item.title='가람';b.item.title='나래'
  render(<Cards rows={[a,b]} editing={actions()}/>)
  const box=(left:number,top:number,width:number,height:number)=>({left,top,width,height,right:left+width,bottom:top+height,x:left,y:top,toJSON:()=>({})}) as DOMRect
  const spy=vi.spyOn(Element.prototype,'getBoundingClientRect').mockImplementation(function(this:Element){
   if(this.classList.contains('react-flow'))return box(0,0,800,600)
   if(this.classList.contains('react-flow__node'))return this.textContent?.includes('나래')?box(900,100,200,150):box(100,100,200,150)
   return box(0,0,0,0)
  })
  try{
   const before=viewportOf()
   fireEvent.focus(card('가람'))
   expect(viewportOf()).toEqual(before)
   fireEvent.focus(card('나래'))
   const [nx,ny]=at('나래'),zoom=zoomOf()
   await waitFor(()=>{
    expect(viewportOf()[0]).toBeCloseTo(400-(nx+100)*zoom,1)
    expect(viewportOf()[1]).toBeCloseTo(300-(ny+75)*zoom,1)
   })
  }finally{spy.mockRestore()}
})

it('키보드 초점이 간 카드가 캔버스 밖이면 그 카드가 가운데 오게 옮기고, 이미 보이는 카드는 가만둔다(React Flow는 카드 안 버튼의 초점을 따라가지 않는다)',async()=>{
 const a=newSetting('people'),b=newSetting('people');a.item.title='가람';b.item.title='나래'
 render(<Cards rows={[a,b]} editing={actions()}/>)
 const box=(left:number,top:number,width:number,height:number)=>({left,top,width,height,right:left+width,bottom:top+height,x:left,y:top,toJSON:()=>({})}) as DOMRect
 // jsdom은 화면 배치를 모른다: 캔버스는 800×600, 나래 카드만 그 오른쪽 밖에 있다고 알려 준다.
 const spy=vi.spyOn(Element.prototype,'getBoundingClientRect').mockImplementation(function(this:Element){
  if(this.classList.contains('react-flow'))return box(0,0,800,600)
  if(this.classList.contains('relationship-character-card'))return this.textContent?.includes('나래')?box(900,100,200,150):box(100,100,200,150)
  return box(0,0,0,0)
 })
 try{
  const before=viewportOf()
  fireEvent.focus(screen.getByRole('button',{name:'가람 정보 편집'}))
  expect(viewportOf()).toEqual(before)
  fireEvent.focus(screen.getByRole('button',{name:'나래 정보 편집'}))
  const [nx,ny]=at('나래'),zoom=zoomOf()
  await waitFor(()=>{
   expect(viewportOf()[0]).toBeCloseTo(400-(nx+100)*zoom,1)
   expect(viewportOf()[1]).toBeCloseTo(300-(ny+75)*zoom,1)
  })
  expect(zoomOf()).toBeCloseTo(zoom,5)
 }finally{spy.mockRestore()}
})

it('+ 설정 추가를 누르면 오른쪽 패널(dialog)이 열려 검색 칸으로 초점이 가고 Esc로 닫으면 초점이 그 버튼으로 돌아오며, 빈 캔버스에 초점이 있을 때 Tab으로도 열린다(입력칸에서는 아님)',()=>{
 const {rows}=triangle()
 render(<Cards rows={rows} editing={actions()}/>)
 const open=screen.getByRole('button',{name:'+ 설정 추가'})
 expect(open.getAttribute('aria-expanded')).toBe('false')
 fireEvent.click(open)
 const dialog=screen.getByRole('dialog',{name:'설정 추가'})
 expect(open.getAttribute('aria-expanded')).toBe('true')
 expect(document.activeElement).toBe(within(dialog).getByRole('searchbox'))
 fireEvent.keyDown(within(dialog).getByRole('searchbox'),{key:'Tab'}) // 입력칸의 Tab은 그대로(패널을 다시 열지 않는다)
 expect(screen.getAllByRole('dialog',{name:'설정 추가'})).toHaveLength(1)
 fireEvent.keyDown(dialog,{key:'Escape'})
 expect(screen.queryByRole('dialog',{name:'설정 추가'})).toBeNull()
 expect(document.activeElement).toBe(open)
 const host=flowEl()
 expect(host.tabIndex).toBe(-1) // 빈 곳을 눌러 초점이 올 수 있지만 Tab 순서에는 끼지 않는다
 const tab=createEvent.keyDown(host,{key:'Tab'})
 fireEvent(host,tab)
 expect(tab.defaultPrevented).toBe(true)
 expect(screen.getByRole('dialog',{name:'설정 추가'})).toBeTruthy()
 fireEvent.keyDown(screen.getByRole('dialog',{name:'설정 추가'}),{key:'Escape'})
 expect(document.activeElement).toBe(host)
 const fromCard=createEvent.keyDown(card('가람'),{key:'Tab'}) // 카드·선에서의 Tab은 평소대로 다음 요소로 간다
 fireEvent(card('가람'),fromCard)
 expect(fromCard.defaultPrevented).toBe(false)
})

function Adder({onType,editing}:{onType:(type:string)=>void;editing?:ReturnType<typeof actions>}){
 const [rows,setRows]=useState<Rows>(()=>{const a=newSetting('people'),b=newSetting('people'),c=newSetting('people'),d=newSetting('people');a.item.title='가람';b.item.title='나래';c.item.title='다온';d.item.title='라온';return [a,b,c,d]})
 const base=editing??actions()
 return <Cards rows={rows} editing={{...base,onAdd:vi.fn((type:string)=>{const s=newSetting('people');s.item.title='';setRows((old)=>[...old,s]);onType(type);return s.item.id})}}/>
}
it('패널에서 유형을 고르면 onAdd(유형)로 초안에 더하고, 새 카드를 빈 자리에 놓아 선택(onMark)·확대하며 초점을 주고 기존 카드는 움직이지 않는다',async()=>{
 const onType=vi.fn(),editing=actions()
 render(<Adder onType={onType} editing={editing}/>)
 // 카드 중심: 확대 단계가 바뀌면 상자(점 ↔ 카드)의 왼쪽 위는 달라져도 중심은 같다
 const middle=(name:string)=>{const [x,y]=at(name),el=card(name);return [x+parseFloat(el.style.width)/2,y+parseFloat(el.style.height)/2]}
 const before=Object.fromEntries(['가람','나래','다온','라온'].map(n=>[n,middle(n)]))
 fireEvent.click(screen.getByRole('button',{name:'+ 설정 추가'}))
 fireEvent.click(within(screen.getByRole('dialog',{name:'설정 추가'})).getByRole('button',{name:'장소'}))
 expect(onType).toHaveBeenCalledWith('location')
 expect(screen.queryByRole('dialog',{name:'설정 추가'})).toBeNull() // 고르면 패널이 닫힌다
 const fresh=await screen.findByRole('group',{name:'새 인물 인물 카드'})
 await waitFor(()=>expect(editing.onMark).toHaveBeenCalledWith(fresh.getAttribute('data-id')))
 for(const [name,place] of Object.entries(before)){const now=middle(name);expect(now[0],name).toBeCloseTo(place[0],5);expect(now[1],name).toBeCloseTo(place[1],5)} // 기존 카드는 그대로
 const [x,y]=middle('새 인물')
 for(const place of Object.values(before))expect(Math.abs(place[0]-x)>=200||Math.abs(place[1]-y)>=150).toBe(true) // 겹치지 않는다
 await waitFor(()=>{ // 새 카드가 캔버스(800×600) 한가운데에 온다
  expect(viewportOf()[0]+x*zoomOf()).toBeCloseTo(400,1)
  expect(viewportOf()[1]+y*zoomOf()).toBeCloseTo(300,1)
 })
 expect(zoomOf()).toBeGreaterThanOrEqual(1)
 await waitFor(()=>expect(document.activeElement).toBe(fresh))
})

it('처리 중(busy)이거나 추가가 거절되면(onAdd가 id를 안 줌) 카드를 놓지도 선택하지도 않는다',async()=>{
 const {rows}=triangle(),editing=actions()
 render(<Cards rows={rows} editing={editing}/>)
 fireEvent.click(screen.getByRole('button',{name:'+ 설정 추가'}))
 fireEvent.click(within(screen.getByRole('dialog',{name:'설정 추가'})).getByRole('button',{name:'인물'}))
 expect(editing.onAdd).toHaveBeenCalledWith('character')
 await Promise.resolve()
 expect(editing.onMark).not.toHaveBeenCalled()
 expect(screen.getAllByRole('group',{name:/인물 카드$/})).toHaveLength(3)
})

it('빈 곳을 오른쪽 클릭하면 캔버스 메뉴(여기에 설정 추가 ▸ 8유형·배치 정돈·화면 맞춤)가 열리고 브라우저 기본 메뉴는 막으며, 고른 유형의 카드를 클릭한 자리에 놓는다',async()=>{
 const onType=vi.fn()
 render(<Adder onType={onType}/>)
 const [vx,vy]=viewportOf(),z=zoomOf()
 const pane=document.querySelector('.react-flow__pane')!
 const context=createEvent.contextMenu(pane,{clientX:760,clientY:560})
 fireEvent(pane,context)
 expect(context.defaultPrevented).toBe(true)
 const menu=screen.getByRole('menu',{name:'캔버스 메뉴'})
 expect(within(menu).getAllByRole('menuitem').map(i=>i.textContent)).toEqual(['여기에 설정 추가','배치 정돈','화면 맞춤'])
 fireEvent.click(within(menu).getByRole('menuitem',{name:'여기에 설정 추가'}))
 expect(within(screen.getByRole('menu',{name:'여기에 설정 추가'})).getAllByRole('menuitem').map(i=>i.textContent)).toEqual(['인물','장소','조직','능력','사물','규칙','사건','기타'])
 fireEvent.click(screen.getByRole('menuitem',{name:'조직'}))
 expect(onType).toHaveBeenCalledWith('organization')
 expect(screen.queryByRole('menu')).toBeNull()
 const fresh=await screen.findByRole('group',{name:'새 인물 인물 카드'})
 void fresh
 const [x,y]=at('새 인물')
 expect(x+100).toBeCloseTo((760-vx)/z,0) // 카드 가운데가 오른쪽 클릭한 자리
 expect(y+75).toBeCloseTo((560-vy)/z,0)
})

it('빈 곳 메뉴의 배치 정돈은 끌어 둔 위치를 버리고 처음 배치로 되돌리며 화면을 맞추고, 화면 맞춤은 전체를 보여 준다',async()=>{
 const a=newSetting('people'),b=newSetting('people');a.item.title='가람';b.item.title='나래'
 render(<Cards rows={[a,b]} editing={actions()}/>)
 const home=at('가람'),fitted=zoomOf()
 mouse(card('가람'),'mouseDown',100,100);mouse(card('가람'),'mouseMove',130,120);mouse(card('가람'),'mouseMove',200,200);mouse(card('가람'),'mouseUp',200,200)
 await waitFor(()=>expect(at('가람')).not.toEqual(home))
 fireEvent.contextMenu(document.querySelector('.react-flow__pane')!,{clientX:10,clientY:10})
 fireEvent.click(screen.getByRole('menuitem',{name:'배치 정돈'}))
 await waitFor(()=>expect(at('가람')).toEqual(home))
 for(const name of ['가람','나래'])expect(insideCanvas(name),name).toBe(true) // 화면도 다시 맞춘다
 fireEvent.click(screen.getByRole('button',{name:'확대'}))
 await waitFor(()=>expect(zoomOf()).toBeGreaterThan(fitted))
 fireEvent.contextMenu(document.querySelector('.react-flow__pane')!,{clientX:10,clientY:10})
 fireEvent.click(screen.getByRole('menuitem',{name:'화면 맞춤'}))
 await waitFor(()=>expect(zoomOf()).toBeCloseTo(fitted,5))
})

it('카드를 오른쪽 클릭하면 정보 편집·관계 연결·삭제 메뉴가 열려 각자 콜백을 부르고, 삭제가 잠기면(deleteLock) 이유를 보이며 부르지 않는다',()=>{
 const {rows,a}=triangle(),editing=actions({deleteLock:'설정 삭제는 최신 회차에서 할 수 있어요.'})
 render(<Cards rows={rows} editing={editing}/>)
 const open=()=>fireEvent.contextMenu(card('가람'),{clientX:120,clientY:80})
 open()
 const menu=screen.getByRole('menu',{name:'가람 메뉴'})
 expect(within(menu).getAllByRole('menuitem').map(i=>i.textContent)).toEqual(['정보 편집','관계 연결','삭제'])
 const del=within(menu).getByRole('menuitem',{name:'삭제'})
 expect(del.getAttribute('aria-disabled')).toBe('true')
 expect(within(menu).getByText('설정 삭제는 최신 회차에서 할 수 있어요.')).toBeTruthy()
 fireEvent.click(del)
 expect(editing.onDeleteCard).not.toHaveBeenCalled()
 fireEvent.click(within(menu).getByRole('menuitem',{name:'정보 편집'}))
 expect(editing.onSelect).toHaveBeenCalledWith(a.item.id)
 open();fireEvent.click(screen.getByRole('menuitem',{name:'관계 연결'}))
 expect(editing.onConnect).toHaveBeenCalledWith(a.item.id)
 cleanup()
 const free=actions()
 render(<Cards rows={rows} editing={free}/>)
 fireEvent.contextMenu(card('가람'));fireEvent.click(screen.getByRole('menuitem',{name:'삭제'}))
 expect(free.onDeleteCard).toHaveBeenCalledWith(a.item.id)
})

it('이름 없는 카드의 관계 연결 메뉴 항목과 처리 중(busy)의 편집·삭제 항목은 잠긴다',()=>{
 const a=newSetting('people')
 const editing=actions()
 const {rerender}=render(<Cards rows={[a]} editing={editing}/>)
 fireEvent.contextMenu(card('새 인물'))
 expect(screen.getByRole('menuitem',{name:'관계 연결'}).getAttribute('aria-disabled')).toBe('true')
 fireEvent.keyDown(screen.getByRole('menu'),{key:'Escape'})
 rerender(<Cards rows={[a]} editing={actions({busy:true})}/>)
 fireEvent.contextMenu(card('새 인물'))
 expect(screen.getByRole('menuitem',{name:'삭제'}).getAttribute('aria-disabled')).toBe('true')
})

it('관계선을 오른쪽 클릭하면 관계 편집·관계 삭제 메뉴가 열려 각자 콜백을 부른다',()=>{
 const {rows}=triangle(),editing=actions()
 render(<Cards rows={rows} editing={editing}/>)
 fireEvent.contextMenu(hit(/관계선 편집: 가람 · 나래/))
 const menu=screen.getByRole('menu',{name:'관계선 메뉴'})
 expect(within(menu).getAllByRole('menuitem').map(i=>i.textContent)).toEqual(['관계 편집','관계 삭제'])
 fireEvent.click(within(menu).getByRole('menuitem',{name:'관계 편집'}))
 expect(editing.onRelation).toHaveBeenCalledTimes(1)
 fireEvent.contextMenu(hit(/관계선 편집: 가람 · 나래/));fireEvent.click(screen.getByRole('menuitem',{name:'관계 삭제'}))
 expect(editing.onDeleteRelation).toHaveBeenCalledTimes(1)
})

it('키보드로도 메뉴가 열린다: 초점이 있는 카드·선에서 ContextMenu 키나 Shift+F10, 캔버스 자체에서는 캔버스 메뉴',()=>{
 const {rows}=triangle()
 render(<Cards rows={rows} editing={actions()}/>)
 fireEvent.keyDown(card('가람'),{key:'ContextMenu'})
 expect(screen.getByRole('menu',{name:'가람 메뉴'})).toBeTruthy()
 fireEvent.keyDown(screen.getByRole('menu'),{key:'Escape'})
 fireEvent.keyDown(hit(/관계선 편집: 가람 · 나래/),{key:'F10',shiftKey:true})
 expect(screen.getByRole('menu',{name:'관계선 메뉴'})).toBeTruthy()
 fireEvent.keyDown(screen.getByRole('menu'),{key:'Escape'})
 fireEvent.keyDown(flowEl(),{key:'F10',shiftKey:true})
 expect(screen.getByRole('menu',{name:'캔버스 메뉴'})).toBeTruthy()
})

it('터치는 카드를 길게 누르면(0.6초, 움직이지 않을 때) 카드 메뉴가 열리고 그 뒤 click은 선택으로 치지 않는다',()=>{
 class TouchPointer extends MouseEvent{pointerType:string;constructor(type:string,init:MouseEventInit&{pointerType?:string}={}){super(type,init);this.pointerType=init.pointerType??''}}
 vi.stubGlobal('PointerEvent',TouchPointer)
 vi.useFakeTimers({toFake:['setTimeout','clearTimeout']})
 const {rows}=triangle(),editing=actions()
 render(<Cards rows={rows} editing={editing}/>)
 const body=card('가람').querySelector('.relationship-character-card')!
 fireEvent.pointerDown(body,{pointerType:'touch',clientX:50,clientY:60})
 act(()=>{vi.advanceTimersByTime(599)})
 expect(screen.queryByRole('menu')).toBeNull()
 act(()=>{vi.advanceTimersByTime(2)})
 expect(screen.getByRole('menu',{name:'가람 메뉴'})).toBeTruthy()
 fireEvent.pointerUp(body,{pointerType:'touch'});fireEvent.click(card('가람'))
 expect(editing.onPick).not.toHaveBeenCalled()
 fireEvent.keyDown(screen.getByRole('menu'),{key:'Escape'})
 fireEvent.pointerDown(body,{pointerType:'touch',clientX:50,clientY:60}) // 움직이면 취소
 fireEvent.pointerMove(body,{pointerType:'touch',clientX:90,clientY:60})
 act(()=>{vi.advanceTimersByTime(700)})
 expect(screen.queryByRole('menu')).toBeNull()
 fireEvent.pointerDown(body,{pointerType:'mouse',clientX:50,clientY:60}) // 마우스는 길게 눌러도 메뉴가 없다
 act(()=>{vi.advanceTimersByTime(700)})
 expect(screen.queryByRole('menu')).toBeNull()
})

it('find로 카드를 찾으면 그 카드가 캔버스 가운데에 오게 옮기고(확대는 줄이지 않는다) 없는 카드나 같은 요청은 건드리지 않는다',async()=>{
 const rows=crowd(20)
 const {rerender}=render(<Cards rows={rows} editing={actions()}/>)
 const start=zoomOf()
 rerender(<Cards rows={rows} editing={actions()} find={{id:rows[19].item.id,seq:1}}/>)
 await waitFor(()=>expect(viewportOf()[0]+(at('인물20')[0]+100)*zoomOf()).toBeCloseTo(400,1))
 expect(viewportOf()[1]+(at('인물20')[1]+75)*zoomOf()).toBeCloseTo(300,1)
 expect(zoomOf()).toBeGreaterThanOrEqual(Math.max(start,1)-1e-9)
 const moved=viewportOf()
 rerender(<Cards rows={rows} editing={actions()} find={{id:'없는 카드',seq:2}}/>)
 await Promise.resolve()
 expect(viewportOf()).toEqual(moved)
})

/** 카드 가장자리 점(.source=오른쪽, .target=왼쪽)에서 mousedown → document에서 mousemove·mouseup(React Flow의 끌어 잇기). 좌표는 화면 좌표다. */
function connectDrag(from:Element,to:{x:number;y:number}){
 const rect=from.getBoundingClientRect(),start={x:rect.left+rect.width/2,y:rect.top+rect.height/2}
 fireEvent.mouseDown(from,{clientX:start.x,clientY:start.y,button:0})
 fireEvent.mouseMove(document,{clientX:start.x+10,clientY:start.y+10})
 fireEvent.mouseMove(document,{clientX:to.x,clientY:to.y})
 fireEvent.mouseUp(document,{clientX:to.x,clientY:to.y})
}
const screenCenterOf=(name:string)=>{const [vx,vy]=viewportOf(),z=zoomOf(),[x,y]=at(name);return {x:vx+(x+100)*z,y:vy+(y+75)*z}}
it('카드 오른쪽 점에서 다른 카드로 끌어 놓으면 그 쌍(출발 → 도착)으로 onPair를 부르고, 자기 자신 위나 처리 중에는 부르지 않는다',()=>{
 Object.defineProperty(document,'elementFromPoint',{value:()=>null,configurable:true}) // jsdom에는 없다
 const {rows,a,b}=triangle(),editing=actions()
 const {rerender}=render(<Cards rows={rows} editing={editing}/>)
 const port=(name:string,kind:'source'|'target')=>card(name).querySelector('.react-flow__handle.'+kind)!
 connectDrag(port('가람','source'),screenCenterOf('나래'))
 expect(editing.onPair).toHaveBeenCalledWith(a.item.id,b.item.id)
 editing.onPair.mockClear()
 connectDrag(port('가람','source'),screenCenterOf('가람')) // 자기 자신
 expect(editing.onPair).not.toHaveBeenCalled()
 connectDrag(port('나래','target'),screenCenterOf('가람')) // 왼쪽 점에서 끌면 도착한 카드가 출발(source)이 된다
 expect(editing.onPair).toHaveBeenCalledWith(a.item.id,b.item.id)
 editing.onPair.mockClear()
 const busy=actions({busy:true})
 rerender(<Cards rows={rows} editing={busy}/>)
 expect(port('가람','source').classList.contains('connectable')).toBe(false)
 connectDrag(port('가람','source'),screenCenterOf('나래'))
 expect(busy.onPair).not.toHaveBeenCalled()
 const choosing=actions({targetSource:a.item.id}) // 상대를 고르는 중에는 끌어 잇기가 없다
 rerender(<Cards rows={rows} editing={choosing}/>)
 expect(port('나래','source').classList.contains('connectable')).toBe(false)
 Reflect.deleteProperty(document,'elementFromPoint')
})

// ── 시맨틱 줌(옵시디언식): 멀리서는 점, 가까이서는 카드 ───────────────────────────────────────────────────────────────
/** 첫 인물이 나머지 모두와 이어진 허브 세계(관계 n−1개). */
const hubWorld=(n:number)=>{const rows=crowd(n),hub=rows[0];return {hub,leaf:rows[1],rows:rows.slice(1).reduce((all,row)=>putRelation(all,{subjectId:hub.item.id,targetId:row.item.id,predicate:'friend_of',polarity:'asserted'}),rows)}}
const dots=()=>document.querySelectorAll<HTMLElement>('.relationship-dot')
const wrapperSize=(name:string)=>{const el=card(name);return {w:parseFloat(el.style.width),h:parseFloat(el.style.height)}}
const shownNames=()=>Array.from(document.querySelectorAll('.relationship-dot-name.shown'),el=>el.textContent)

it('카드가 많으면 처음에 전체가 보이게 맞추고 멀리서는 카드 대신 점을 그린다: 유형 색의 점, 카드 버튼·연결 점 없음, 관계가 많은 카드가 더 크고 이름은 관계가 많은 몇 장에만 붙으며 선에는 라벨이 없다',()=>{
  const {rows,hub}=hubWorld(40)
  render(<Cards rows={rows} editing={actions()}/>)
  expect(zoomOf()).toBeLessThan(0.5)
  expect(flowEl().getAttribute('data-level')).toBe('far')
  expect(dots()).toHaveLength(40)
  expect(document.querySelectorAll('.relationship-character-card')).toHaveLength(0)
  expect(document.querySelectorAll('.relationship-port.connectionindicator')).toHaveLength(0) // 끌어 잇기는 가까이서만(점 요소는 React Flow가 선을 그리려고 숨겨 둘 뿐이다)
  expect(document.querySelectorAll('.react-flow__edge')).toHaveLength(39) // 멀리서도 선은 그려진다(눌러 편집할 수 있다)
  expect(within(flowEl()).queryAllByRole('button',{name:/관계 연결|정보 편집|상대 선택/})).toHaveLength(0)
  expect(dots()[0].style.background).not.toBe('') // 유형 색
  expect(wrapperSize('인물1').w).toBeGreaterThan(wrapperSize('인물2').w) // 허브(관계 39개)가 외톨이 쪽보다 크다
  expect(wrapperSize('인물1').w).toBe(wrapperSize('인물1').h) // 점은 원이다
  expect(shownNames()).toHaveLength(4) // 40장의 10%
  expect(shownNames()).toContain(hub.item.title)
  expect(labels()).toEqual([]) // 멀리서는 선 라벨이 없다
  expect(card('인물1').getAttribute('aria-label')).toBe('인물1 인물 카드') // 점도 이름 있는 카드로 읽히고 Tab으로 닿는다
  expect(card('인물1').tabIndex).toBe(0)
})

it('멀리서 점을 누르면 그 카드로 near 바로 아래 배율(0.85)까지 다가가 선택하고(연결 상대 고르기가 아니라) mid에서는 모든 이름과 선 라벨이 보이며, 한 단계 더 확대하면 카드가 된다',async()=>{
  const {rows,leaf}=hubWorld(40),editing=actions()
  render(<Cards rows={rows} editing={editing}/>)
  fireEvent.click(card('인물2'))
  expect(editing.onMark).toHaveBeenCalledWith(leaf.item.id)
  expect(editing.onPick).not.toHaveBeenCalled()
  await waitFor(()=>expect(zoomOf()).toBeCloseTo(0.85,2))
  expect(flowEl().getAttribute('data-level')).toBe('mid')
  const [vx,vy]=viewportOf(),[nx,ny]=at('인물2'),size=wrapperSize('인물2')
  expect(vx+(nx+size.w/2)*0.85).toBeCloseTo(400,0) // 누른 점이 캔버스 가운데에 온다
  expect(vy+(ny+size.h/2)*0.85).toBeCloseTo(300,0)
  expect(shownNames()).toHaveLength(40)
  expect(labels()).toHaveLength(39) // 관계 하나에 라벨 하나
  expect(document.querySelectorAll('.relationship-character-card')).toHaveLength(0)
  fireEvent.click(within(flowEl()).getByRole('button',{name:'확대'}))
  await waitFor(()=>expect(flowEl().getAttribute('data-level')).toBe('near'))
  expect(dots()).toHaveLength(0)
  expect(card('인물2').querySelector('.relationship-character-card')).toBeTruthy()
  expect(card('인물2').querySelectorAll('.relationship-port')).toHaveLength(2)
})

it('연결 상대를 고르는 중에는 멀리서 점을 눌러도 확대하지 않고 상대로 고른다',()=>{
  const {rows,leaf}=hubWorld(40),editing=actions({targetSource:rows[0].item.id})
  render(<Cards rows={rows} editing={editing}/>)
  const before=zoomOf()
  fireEvent.click(card('인물2'))
  expect(editing.onPick).toHaveBeenCalledWith(leaf.item.id)
  expect(zoomOf()).toBe(before)
  expect(document.querySelectorAll('.relationship-dot.target')).toHaveLength(39) // 상대가 될 수 있는 점은 모든 단계에서 표시된다
})

it('선택한 점·흐린 점·메뉴·키보드는 멀리서도 같다: 선택한 점에 selected(aria-current), 이름이 맞지 않는 점에 dim, 오른쪽 클릭 메뉴와 Enter(정보 편집)',()=>{
  const {rows,leaf}=hubWorld(40),editing=actions()
  let vm!:ReturnType<typeof useWorldMapViewModel>
  function Probe(){vm=useWorldMapViewModel(rows,buildCharacterMap);return <CharacterCards vm={vm} editing={editing}/>}
  render(<Probe/>)
  act(()=>vm.select(leaf.item.id))
  expect(card('인물2').getAttribute('aria-current')).toBe('true')
  expect(card('인물2').querySelector('.relationship-dot.selected')).toBeTruthy()
  expect(shownNames()).toContain('인물2') // 고른 점은 멀리서도 이름이 보인다
  act(()=>vm.setQuery('인물3'))
  expect(document.querySelectorAll('.relationship-dot.dim')).toHaveLength(29) // 이름에 '인물3'이 든 11장(인물3·인물30~39)만 밝다
  fireEvent.keyDown(card('인물5'),{key:'Enter'})
  expect(editing.onSelect).toHaveBeenCalledWith(rows[4].item.id)
  fireEvent.contextMenu(card('인물5'))
  expect(screen.getByRole('menu',{name:'인물5 메뉴'})).toBeTruthy()
})

it('선의 가운데 편집·삭제 버튼은 가까이서만 뜬다(캔버스 단계가 CSS에 data-level로 알려진다)',async()=>{
  const {rows}=hubWorld(40)
  render(<Cards rows={rows} editing={actions()}/>)
  expect(flowEl().getAttribute('data-level')).toBe('far')
  fireEvent.click(card('인물2'));fireEvent.click(within(flowEl()).getByRole('button',{name:'확대'}))
  await waitFor(()=>expect(flowEl().getAttribute('data-level')).toBe('near'))
})

it('캔버스는 확대 배율을 --rf-zoom으로 CSS에 알려(이름·선 라벨이 화면에서 늘 같은 크기) 배율이 바뀔 때마다 갱신한다',async()=>{
  const {rows}=hubWorld(40)
  render(<Cards rows={rows} editing={actions()}/>)
  await waitFor(()=>expect(Number(flowEl().style.getPropertyValue('--rf-zoom'))).toBeCloseTo(zoomOf(),2))
  fireEvent.click(card('인물2'))
  await waitFor(()=>expect(Number(flowEl().style.getPropertyValue('--rf-zoom'))).toBeCloseTo(0.85,2))
})

it('배치 정돈은 힘 기반 배치를 다시 계산해 같은 입력이면 처음 열었을 때와 같은 자리로 돌려놓고, 끌어 둔 카드도 그 자리로 간다',async()=>{
  const {rows}=triangle(),editing=actions()
  render(<Cards rows={rows} editing={editing}/>)
  const first=[at('가람'),at('나래'),at('다온')]
  const garam=card('가람'),[x,y]=at('가람')
  mouse(garam,'mouseDown',100,100);mouse(garam,'mouseMove',130,120);mouse(garam,'mouseMove',200,200);mouse(garam,'mouseUp',200,200)
  expect(at('가람')).not.toEqual([x,y])
  await new Promise(done=>setTimeout(done,10)) // 끌기를 마친 직후의 click 하나는 d3-drag가 삼킨다
  fireEvent.click(within(flowEl()).getByRole('button',{name:'배치 정돈'}))
  expect([at('가람'),at('나래'),at('다온')]).toEqual(first)
})

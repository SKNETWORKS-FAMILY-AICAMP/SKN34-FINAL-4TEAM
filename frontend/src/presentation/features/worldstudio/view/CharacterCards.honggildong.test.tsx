// @vitest-environment jsdom
// 실제 시연 세계관 「홍길동전」(카드 57장·관계 146개: 홍길동은 선 54개·이웃 38장인 허브)의 모양으로 관계도의 이웃 강조·첫 화면·이름표를 시험한다.
import '../../../../test/reactFlowStubs'
import { useState } from 'react'
import { cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { HONGGILDONG_CARDS, HONGGILDONG_LINKS, honggildongMap } from '../../../../test/honggildongGraph'
import { useWorldMapViewModel } from '../viewmodel/useWorldMapViewModel'
import CharacterCards from './CharacterCards'
afterEach(()=>{cleanup();vi.unstubAllGlobals()})

const NO_SETTINGS:never[]=[]
const makeEditing=()=>({busy:false,selectedRelations:[] as string[],targetSource:null as string|null,deleteLock:'',onPick:vi.fn(),onSelect:vi.fn(),onConnect:vi.fn(),onPair:vi.fn(),onRelation:vi.fn(),onDeleteCard:vi.fn(),onDeleteRelation:vi.fn(),onAdd:vi.fn(),onMark:vi.fn()})
function Honggildong(){
 const vm=useWorldMapViewModel(NO_SETTINGS,honggildongMap),[editing]=useState(makeEditing),[slot,setSlot]=useState<HTMLElement|null>(null)
 return <><div ref={setSlot}/><CharacterCards vm={vm} editing={editing} toolsSlot={slot}/></>
}
const title=new Map(HONGGILDONG_CARDS.map(([id,name])=>[id,name]))
const idOf=new Map(HONGGILDONG_CARDS.map(([id,name])=>[name,id]))
const nodeEl=(id:string)=>document.querySelector<HTMLElement>('.react-flow__node[data-id="'+id+'"]')!
const opacity=(el:Element)=>Number(getComputedStyle(el).opacity||1)
const viewportOf=()=>/translate\(([-\d.]+)px,\s*([-\d.]+)px\)/.exec(document.querySelector<HTMLElement>('.react-flow__viewport')!.style.transform)!.slice(1).map(Number)
const zoomOf=()=>Number(/scale\(([\d.]+)\)/.exec(document.querySelector<HTMLElement>('.react-flow__viewport')!.style.transform)?.[1])
/** 화면에 그려진 선(눌리는 경로의 aria 이름 '관계선 편집: 가 · 나 · 관계')마다 두 끝 카드 id. 이웃 계산이 쓰는 입력과 따로, DOM에서 읽는다. */
const renderedLines=()=>[...document.querySelectorAll<SVGPathElement>('.relationship-edge-hit')].map(hit=>{
 const [a,b]=hit.getAttribute('aria-label')!.replace('관계선 편집: ','').split(' · ')
 return {hit,ends:[idOf.get(a)!,idOf.get(b)!] as [string,string]}
})
/** 지금 밝은(opacity 1) 카드 id. */
const brightNodes=()=>[...document.querySelectorAll<HTMLElement>('.react-flow__node')].filter(el=>opacity(el)===1).map(el=>el.getAttribute('data-id')!)

it('시연 세계관의 모양: 카드 57장·선 146개가 모두 그려지고 홍길동은 선 54개·서로 다른 이웃 38장이다(선 하나가 같은 쌍 사이 여럿일 수 있다)',()=>{
 render(<Honggildong/>)
 expect(document.querySelectorAll('.react-flow__node')).toHaveLength(57)
 const lines=renderedLines()
 expect(lines).toHaveLength(146)
 const mine=lines.filter(l=>l.ends.includes('gildong'))
 expect(mine).toHaveLength(54)
 expect(new Set(mine.flatMap(l=>l.ends).filter(id=>id!=='gildong')).size).toBe(38)
})

it('카드 A에 올리면 A와 A에 닿는 선(DOM의 선 이름으로 센)의 서로 다른 반대쪽 카드만 밝다: 선 N개의 이웃 수는 중복을 뺀 값이고 어느 카드에서도 같다(57장 전부)',()=>{
 render(<Honggildong/>)
 const lines=renderedLines()
 for(const [id] of HONGGILDONG_CARDS){
  const touching=lines.filter(l=>l.ends.includes(id)),expected=new Set([id,...touching.flatMap(l=>l.ends)])
  fireEvent.mouseOver(nodeEl(id))
  expect(new Set(brightNodes()),title.get(id)).toEqual(expected)
  fireEvent.mouseOut(nodeEl(id),{relatedTarget:document.body})
 }
})

it('홍길동에 올리면 홍길동과 이웃 38장(39)이 밝고, 닿는 선 54개만 또렷하며 나머지 선 92개는 선 래퍼·선 그룹·눌리는 경로 어느 층을 재도 흐리다(선 흐림이 안 보이던 문제)',()=>{
 render(<Honggildong/>)
 fireEvent.mouseOver(nodeEl('gildong'))
 expect(brightNodes()).toHaveLength(39)
 expect(document.querySelector('.relationship-focus-style')!.getAttribute('data-focus')).toBe('gildong')
 const lines=renderedLines(),touching=lines.filter(l=>l.ends.includes('gildong')),others=lines.filter(l=>!l.ends.includes('gildong'))
 expect(others).toHaveLength(92)
 const layers=(hit:Element)=>[hit.closest('.react-flow__edge')!,hit.closest('.relationship-edge')!,hit]
 for(const {hit} of touching)for(const layer of layers(hit))expect(opacity(layer),layer.getAttribute('class')??'').toBe(1)
 for(const {hit} of others)for(const layer of layers(hit))expect(opacity(layer),layer.getAttribute('class')??'').toBeLessThan(0.5)
 const edgeVisible=(hit:Element)=>opacity(hit.closest('.react-flow__edge')!)*opacity(hit.closest('.relationship-edge')!)
 for(const {hit} of others)expect(edgeVisible(hit)).toBeLessThanOrEqual(0.2) // 눈에 보이는 선은 겹쳐 20% 이하
})

it('이웃이 정확히 둘인 사건 카드(홍길동의 이업 농락)에 올리면 그 카드·홍길동·이업 셋만 밝다: 홍길동에 올렸을 때의 39장과 다르다',()=>{
 render(<Honggildong/>)
 fireEvent.mouseOver(nodeEl('ev-05-2'))
 expect(new Set(brightNodes())).toEqual(new Set(['ev-05-2','gildong','iup']))
})

it('처음 열면 전체가 한 화면에 맞아 무리가 가운데에 오고(이어지지 않은 카드 3장이 멀리 달아나 배율을 줄이지 않는다) 점으로 시작한다',()=>{
 render(<Honggildong/>)
 expect(document.querySelector('.relationship-flow')!.getAttribute('data-level')).toBe('far')
 const z=zoomOf(),[vx,vy]=viewportOf()
 expect(z).toBeGreaterThanOrEqual(0.2) // 800×600 캔버스에서 외톨이가 멀리 있던 때는 0.09였다
 expect(z).toBeLessThan(0.5)
 const rects=[...document.querySelectorAll<HTMLElement>('.react-flow__node')].map(el=>{const m=/translate\(([-\d.]+)px,\s*([-\d.]+)px\)/.exec(el.style.transform)!,cx=Number(m[1])+parseFloat(el.style.width)/2,cy=Number(m[2])+parseFloat(el.style.height)/2;return {l:vx+(cx-100)*z,r:vx+(cx+100)*z,t:vy+(cy-75)*z,b:vy+(cy+75)*z}})
 const left=Math.min(...rects.map(r=>r.l)),right=Math.max(...rects.map(r=>r.r)),top=Math.min(...rects.map(r=>r.t)),bottom=Math.max(...rects.map(r=>r.b))
 expect(left).toBeGreaterThanOrEqual(71);expect(right).toBeLessThanOrEqual(777);expect(top).toBeGreaterThanOrEqual(23);expect(bottom).toBeLessThanOrEqual(513) // 여백: 왼쪽 72·오른쪽 24·위 24·아래 88
 expect(Math.abs((left+right)/2-424)).toBeLessThanOrEqual(40) // 여백을 뺀 영역(72~776)의 가운데
 expect(Math.abs((top+bottom)/2-268)).toBeLessThanOrEqual(30) // (24~512)의 가운데
})

it('멀리 보는 첫 화면에서도 관계 상위 카드의 이름이 보이고 가장 큰 홍길동이 맨 앞이다(8장 이상)',()=>{
 render(<Honggildong/>)
 const names=[...document.querySelectorAll('.relationship-name')].map(el=>el.textContent)
 expect(names[0]).toBe('홍길동')
 expect(names.length).toBeGreaterThanOrEqual(8)
 expect(names.length).toBeLessThanOrEqual(12)
 expect(names).toEqual(expect.arrayContaining(['홍길동','길현','홍문']))
})

it('시연 그래프가 맞는지: 원본 관계 146개의 두 끝은 모두 카드 키이고 같은 쌍이 여러 번 나온다',()=>{
 const keys=new Set(HONGGILDONG_CARDS.map(([id])=>id))
 expect(HONGGILDONG_LINKS.every(([s,t])=>keys.has(s)&&keys.has(t))).toBe(true)
 expect(new Set(HONGGILDONG_LINKS.map(([s,t])=>s+'>'+t)).size).toBeLessThan(HONGGILDONG_LINKS.length)
})

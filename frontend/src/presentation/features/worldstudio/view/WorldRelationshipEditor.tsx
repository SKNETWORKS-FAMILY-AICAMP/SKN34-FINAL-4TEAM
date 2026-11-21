import CharacterCards from './CharacterCards'
import { buildSettingRelationshipMap, cardTypeCounts, defaultAnchor, hideCardTypes, mapNeighbors, toggleHiddenType } from '../viewmodel/characterMap'
import { mapEndpoint } from '../viewmodel/useWorldMapViewModel'
import { pageItems } from '../../../shared/pageItems'
import { PageControls } from '../../../shared/PageControls'
import { Sheet } from '../../../shared/Sheet'
import { pickRelationNode } from '../viewmodel/relationPick'
import { useWorldMapViewModel } from '../viewmodel/useWorldMapViewModel'
import './world-map.css'
import { cardTypeOf, cardTypes, type CardType } from '../../../../domain/entities/studioCards'
import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { RelationPairEditor } from './RelationPairEditor'
import { DELETED_CARD_NAME, relationLabel } from '../../../../domain/entities/studioRelations'
import type { useWorldStudioViewModel } from '../viewmodel/useWorldStudioViewModel'
type VM = ReturnType<typeof useWorldStudioViewModel>

/** 중심 카드 보기에서 한 쪽에 보이는 이웃 수: 가운데 카드 둘레 원 위에 겹치지 않게 놓을 수 있는 만큼이다(`ringLayout`). */
const NEIGHBORS = 12

/** 관계 주체·대상 선택지와 중심 설정 칩의 한 쪽 크기: native select와 가로 스크롤 칩 줄은 200개를 감당해, 57장 세계관에서도 '다음 쪽'을 눌러야 51번째 이후 설정을 고르던 일이 없다(그래프 쪽·관계 목록은 그대로 50). */
const CHOICES = 200

/** 범례의 선 모양: 실선(구조 관계), 점선(감정), 화살표(방향이 있는 관계). 색은 그래프 간선과 같은 토큰이다. */
const LineKey = ({ tone, dashed, arrow }: { tone: 'edge' | 'emotion'; dashed?: boolean; arrow?: boolean }) => (
  <svg className={'relationship-key ' + tone} viewBox="0 0 28 10" width="28" height="10" aria-hidden="true">
    <line x1="1" y1="5" x2={arrow ? 21 : 27} y2="5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeDasharray={dashed ? '4 3' : undefined} />
    {arrow && <path d="M21 1.5 27 5 21 8.5z" fill="currentColor" />}
  </svg>
)

/**
 * 관계 연결 단계. 그래프는 공개 인물관계도와 같은 어두운 면 위의 인물·설정 카드 그래프(React Flow 캔버스 `CharacterCards`, 범례·관계 라벨)이고(작성 모드는 그래프 | 폼 2열, 관리 모드의 관계도 보기는 캔버스가 내용 열 전체 폭이고 폼·목록이 그 아래 한 열이다, `world-studio.css`), 카드를 차례로 두 번 누르면 '관계 추가' 폼의
 * 주체·대상이 채워지며 관계 작성이 열린다(`pickRelationNode`). 오른쪽에는 관계 추가 폼과 관계 목록 표(편집·삭제)가 있고, 관계 작성 패널은 가운데에 뜨는 시트(720px, `Sheet`)다.
 * 그래프는 처음에 **중심 카드 보기**다(`defaultAnchor`: 관계가 가장 많은 인물): 그 카드를 가운데에 두고 이웃 12장을 둘레 원 위에 놓으며(`ringLayout`, 카드 크기는 그대로이고 캔버스의 화면 맞춤이 한눈에 들어오게 한다) 선 라벨은 중심 카드에 닿는 선에만 있다(전체 보기는 선에 마우스를 올리거나 초점을 둘 때만). `전체 관계도로`가 모든 카드를 격자에 까는 전체 보기로 바꾸고(그래프 쪽 이동은 이때만), `중심 카드로 보기`가 되돌린다.
 * 관계는 기존 초안·적용 흐름 그대로 '편집본에 적용'으로 반영하고 세계관 저장으로 서버에 저장한다.
 * 누른 버튼이 사라지는 동작 뒤에는 초점을 이어 준다(`focusTo`): 관계 작성 패널을 닫으면 '관계 작성' 버튼(잠겨 있으면 관계 주체 선택), 목록의 관계를 지우면 관계 목록, 지운 인물을 되돌리면 관계 주체 선택이다.
 * 인물 삭제는 이 화면에 없다(편집 화면의 '카드 삭제'로 일원화): 거기서 지운 인물의 되돌리기만 알림으로 남고, 고른·연결 중이던 카드가 지워지면 그 선택을 푼다.
 * 그래프 위 도구 묶음(`.relationship-bar`: 제목·인물 추가·배치 정돈 → `중심: [검색 콤보]`·이웃 쪽 이동·`전체 관계도로` → 유형 필터, 키보드 순서도 같다)이 줄바꿈만 하며 중심을 바꾸고(`<input list>`: 이름을 쓰거나 목록에서 고르면 그 카드), '관계 추가' 폼은 접힌 `<details>`(그래프에서 두 카드를 고르는 길이 기본, 고른 설정이 채워지면 펼침)다.
 * 안내문('카드 두 개를 차례로 누르면…', 연결 중이면 연결 취소)과 범례는 캔버스 감싸개(`.relationship-canvas`) 안에 있어, 작성 모드는 캔버스 위·아래 줄이고 관리 모드 관계도 보기는 둘 다 캔버스 위에 겹친 작은 글이다(`world-studio.css`). 관계 기준 회차 칸은 이 편집기 바깥(`WorldStudioPage`)이라 편집기가 다시 열려도 초점이 남는다.
 * 관계 목록은 중심 보기 동안 기본으로 중심 카드의 관계만이고 `전체 N개 보기`로 전체를 보며, 중심을 바꾸면 다시 그 카드의 관계만이다.
 * 그래프 위의 유형 필터(`관계도 유형 필터`)는 이 화면에서만 쓰는 보기 상태라 주소·초안·저장과 무관하고, 숨긴 유형의 카드와 그 카드에 닿는 관계선만 그래프에서 뺀다
 * (관계 주체·대상 선택지와 관계 목록은 거르지 않는다). 선택했거나 연결을 시작한 카드가 숨겨지면 그 선택·연결 모드를 풀어 숨은 카드에 관계를 잇지 못하게 한다.
 */
export function WorldRelationshipEditor({ studio }: { studio: VM }) {
  const map = useWorldMapViewModel(studio.editing!.settings, buildSettingRelationshipMap)
  const [choosing, setChoosing] = useState(false)
  const [hidden, setHidden] = useState<ReadonlySet<CardType>>(() => new Set())
  const shown = hideCardTypes(map.graph, hidden)
  const [graphPage, setGraphPage] = useState(0), [edgePage, setEdgePage] = useState(0), [relationPage, setRelationPage] = useState(0)
  const [typed, setTyped] = useState<string | null>(null), [anchor, setAnchor] = useState(() => defaultAnchor(shown)), [neighborPage, setNeighborPage] = useState(0), [expandedFor, setExpandedFor] = useState('')
  // 중심 칸의 선택지(datalist): 쓰는 글이 이름에 들어 있는 설정을 한 쪽 CHOICES개까지(글이 없으면 앞의 CHOICES개).
  const choices = shown.nodes.filter((n) => n.name.toLocaleLowerCase().includes((typed ?? '').trim().toLocaleLowerCase())).slice(0, CHOICES)
  const centerList = useId()
  const anchorNode = shown.nodes.find((n) => n.id === anchor)
  const neighbors = new Set(shown.links.filter((l) => mapEndpoint(l.source) === anchor || mapEndpoint(l.target) === anchor).map((l) => mapEndpoint(l.source) === anchor ? mapEndpoint(l.target) : mapEndpoint(l.source)))
  const neighborPages = pageItems([...neighbors], neighborPage, NEIGHBORS)
  const backToCenter = defaultAnchor(shown) // 전체 보기에서 되돌아갈 중심 카드(관계가 하나도 없으면 ''이라 버튼이 없다)
  const graphNodes = pageItems(shown.nodes, graphPage, 50)
  const focused = anchorNode ? mapNeighbors(shown, anchor, neighborPages.page, NEIGHBORS) : null
  const graphIds = new Set(graphNodes.items.map((n) => n.id))
  const graphEdges = pageItems(focused ? focused.links : shown.links.filter((l) => graphIds.has(mapEndpoint(l.source)) && graphIds.has(mapEndpoint(l.target))), edgePage, 300)
  const graph = { ...shown, nodes: focused?.nodes ?? graphNodes.items, links: graphEdges.items }
  const types = cardTypeCounts(map.graph.nodes), present = types.map((t) => t.id)
  const section = useRef<HTMLElement>(null), cancelConnect = useRef<HTMLButtonElement>(null)
  const returnFocus = useRef('')
  useEffect(() => {
    if (choosing) cancelConnect.current?.focus()
    else if (returnFocus.current) {
      section.current?.querySelector<HTMLButtonElement>(`[data-id="${returnFocus.current}"] button[aria-label$="관계 연결"]`)?.focus()
      returnFocus.current = ''
    }
  }, [choosing])
  const [layoutVersion, setLayoutVersion] = useState(0)
  const people = studio.editing!.settings.filter((s) =>
    cardTypes.some((type) => type.id === cardTypeOf(s.item))
  )
  const [source, setSource] = useState(''),
    [target, setTarget] = useState(''),
    [open, setOpen] = useState(false)
  const [sourceQuery, setSourceQuery] = useState(''), [targetQuery, setTargetQuery] = useState('')
  const [sourcePage, setSourcePage] = useState(0), [targetPage, setTargetPage] = useState(0)
  const options = (query: string, page: number, selected: string) => {
    const found = people.filter((s) => s.item.title.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()))
    const result = pageItems(found, page, CHOICES)
    const current = people.find((s) => s.item.id === selected)
    return { ...result, items: current && !result.items.includes(current) ? [current, ...result.items] : result.items }
  }
  const sourceOptions = options(sourceQuery, sourcePage, source), targetOptions = options(targetQuery, targetPage, target)
  const [focusRequest, setFocusRequest] = useState<{ id: string; seq: number } | null>(null)
  const handledRequest = useRef(0)
  const [focusTo, setFocusTo] = useState<'' | 'write' | 'list' | 'source'>('')
  const [formOpen, setFormOpen] = useState(false) // '관계 추가' 폼은 처음에 접혀 있다(그래프에서 두 카드를 고르는 길이 기본). 고른 설정이 폼에 채워지면 펼친다(selectPair).
  const writeButton = useRef<HTMLButtonElement>(null), sourceSelect = useRef<HTMLSelectElement>(null), list = useRef<HTMLElement>(null)
  // 화면이 바뀐 뒤(버튼이 사라지고 새 버튼이 생긴 뒤)에 옮겨야 하므로 렌더 뒤에 처리한다.
  useEffect(() => {
    if (!focusTo) return
    const target = focusTo === 'list' ? list.current : focusTo === 'write' && !writeButton.current?.disabled ? writeButton.current : sourceSelect.current
    target?.focus()
    setFocusTo('')
  }, [focusTo])
  const selectPair = useCallback((nextSource: string, nextTarget: string, nextOpen: boolean) => {
    // 열린 패널과 같은 두 인물(방향 무관)을 다시 고르면 작성 중인 초안을 그대로 둔다.
    if (open && nextOpen && nextSource === target && nextTarget === source) return true
    if (open && (nextSource !== source || nextTarget !== target) && !studio.confirmRelationDiscard()) return false
    setSource(nextSource)
    setTarget(nextTarget)
    setOpen(nextOpen)
    setChoosing(false)
    if (nextOpen || nextSource) setFormOpen(true)
    map.select(nextSource || null)
    return true
  }, [open, source, target, studio])
  useEffect(() => {
    const request = studio.relationRequest
    if (!request || request.seq === handledRequest.current) return
    handledRequest.current = request.seq
    const item = studio.editing?.settings.find((row) => row.item.id === request.id && row.item.kind === 'relation')?.item
    if (!item?.subjectId || !item.targetId) return
    const samePair = open && (item.subjectId === source && item.targetId === target || item.subjectId === target && item.targetId === source)
    if (samePair || selectPair(item.subjectId, item.targetId, true)) setFocusRequest(request)
  }, [studio.relationRequest, studio.editing?.settings, open, source, target, selectPair])
  const stopChoosing = () => { returnFocus.current = source; setChoosing(false) }
  // 그래프의 카드 본문을 누를 때: 첫 번째는 주체, 두 번째는 대상(폼이 채워지고 관계 작성이 열린다). 열린 초안은 selectPair가 확인을 거친다.
  const pick = (id: string) => {
    const next = pickRelationNode({ source, choosing }, id)
    if (selectPair(next.source, next.target, next.open)) setChoosing(next.choosing)
  }
  // 유형 필터의 새 숨김 집합을 적용한다. 선택한 카드나 연결을 시작한 카드의 유형이 숨겨지면 그 선택·연결 모드를 푼다(숨은 카드에는 상대 선택·관계 연결을 할 수 없다).
  const applyHidden = (next: ReadonlySet<CardType>) => {
    setHidden(next)
    const gone = (id?: string) => { const type = map.graph.nodes.find((n) => n.id === id)?.type; return !!type && next.has(type) }
    if (gone(map.selected?.id)) map.select(null)
    if (choosing && gone(source)) setChoosing(false)
    if (gone(anchor)) { setAnchor(''); setEdgePage(0) }
  }
  // 관계 작성 시트를 닫는다(닫기·Esc·배경). 입력한 변경이 있으면 버릴지 먼저 묻고, 닫은 뒤 초점은 '관계 작성'(잠겼으면 관계 주체 선택)으로 간다.
  const closePair = () => { if (studio.confirmRelationDiscard()) { setOpen(false); setFocusTo('write') } }
  // 목록에서 지우는 것도 '편집본에 적용'과 같은 경로(applyRelations)다. 저장 전까지는 서버에 닿지 않는다. 열린 초안이 있으면 버릴지 먼저 묻고 패널을 닫는다.
  const removeRelation = (id: string, label: string) => {
    if (open && !studio.confirmRelationDiscard()) return
    if (!window.confirm(`${label} 관계를 삭제할까요? 세계관을 저장해야 반영돼요.`)) return
    if (studio.applyRelations([], [id])) { setOpen(false); setChoosing(false); setFocusTo('list') }
  }
  const { settings, deletedTitles } = studio.editing!
  const relations = settings.filter((s) => s.item.kind === 'relation')
  // 중심 보기 동안 목록은 기본으로 중심 카드의 관계만이고(`전체 N개 보기`로 전체), 전체 보기에서는 전체다. 중심이 바뀌면 다시 중심 카드의 관계만이다.
  const centered = anchorNode ? relations.filter((s) => s.item.subjectId === anchor || s.item.targetId === anchor) : []
  const scoped = !!anchorNode && expandedFor !== anchor
  const listed = scoped ? centered : relations
  const listedRelations = pageItems(listed, relationPage, 50)
  const peopleById = new Map(people.map((s) => [s.item.id, s]))
  const existingIds = new Set(settings.filter((s) => s.item.kind !== 'relation').map((s) => s.item.id))
  const name = (id: string | null) => {
    if (id !== null && !existingIds.has(id)) {
      const title = deletedTitles?.[id]
      return title ? `${DELETED_CARD_NAME}: ${title}` : DELETED_CARD_NAME
    }
    return (id ? peopleById.get(id)?.item.title : '') || '선택 안 함'
  }
  // 지난 회차 관계는 그 뒤에 삭제한 설정을 끝점으로 가질 수 있다(DEC-51). 관계도에는 그릴 곳이 없어 목록에서 읽기 전용으로만 보이고, 저장하면 그대로 보낸다.
  const readOnly = (s: (typeof relations)[number]) => (s.item.subjectId !== null && !existingIds.has(s.item.subjectId)) || (s.item.targetId !== null && !existingIds.has(s.item.targetId))
  const readOnlyReason = useId()
  // 다른 화면(편집 화면의 카드 삭제)에서 고른 카드가 지워지면 그 카드를 가리키던 선택·연결 모드·작성 패널을 풀어 지워진 카드에 관계를 잇지 못하게 한다.
  const stale = (!!source && !existingIds.has(source)) || (!!target && !existingIds.has(target))
  useEffect(() => {
    if (stale) { setSource(''); setTarget(''); setOpen(false); setChoosing(false) }
  }, [stale])
  return (
    <section ref={section} className='world-map relationship-editor' aria-label='관계 편집' onKeyDown={(e) => { if (choosing && e.key === 'Escape') stopChoosing() }}>
      <fieldset className='world-fields' disabled={studio.busy}>
        <legend className='sr-only'>관계 대상 선택</legend>
        <div className='relationship-service-layout'>
          <div className='relationship-stage'>
            <div className='relationship-bar'>
              <div className='relationship-toolbar'>
                <h4>관계도</h4>
                <button className='btn sm' type='button' onClick={()=>{if(!studio.confirmRelationDiscard())return;const id=studio.addCard('character');if(id)studio.editCard(id)}}>인물 추가</button>
                <button className='btn sm' type='button' onClick={()=>setLayoutVersion(v=>v+1)}>배치 정돈</button>
              </div>
              <div className='relationship-focus'>
                <label className='relationship-center'>
                  중심
                  <input
                    type='search'
                    role='combobox'
                    list={centerList}
                    className='inp'
                    autoComplete='off'
                    value={typed ?? anchorNode?.name ?? ''}
                    placeholder={anchorNode ? anchorNode.name : '카드 이름으로 찾기'}
                    onFocus={() => setTyped('')}
                    onBlur={() => setTyped(null)}
                    onChange={(e) => {
                      const value = e.target.value
                      setTyped(value)
                      const hit = shown.nodes.find((n) => n.name === value) // 목록에서 고르거나 이름을 그대로 쓰면 그 카드가 중심이다
                      if (hit) { setAnchor(hit.id); setNeighborPage(0); setEdgePage(0) }
                    }}
                  />
                </label>
                <datalist id={centerList}>{choices.map((node) => <option key={node.id} value={node.name} />)}</datalist>
                {anchorNode
                  ? <><PageControls label="이웃" page={neighborPages.page} pages={neighborPages.pages} onPage={(next) => { setNeighborPage(next); setEdgePage(0) }} /><button type='button' className='btn sm' onClick={() => { setAnchor(''); setEdgePage(0) }}>전체 관계도로</button></>
                  : <>{backToCenter && <button type='button' className='btn sm' onClick={() => { setAnchor(backToCenter); setNeighborPage(0); setEdgePage(0) }}>중심 카드로 보기</button>}<PageControls label="그래프" page={graphNodes.page} pages={graphNodes.pages} onPage={(next) => { setGraphPage(next); setEdgePage(0) }} /></>}
                {graphEdges.pages > 1 && <><p className='small muted'>현재 카드의 관계를 페이지별로 보여요.</p><PageControls label="연결선" page={graphEdges.page} pages={graphEdges.pages} onPage={setEdgePage} /></>}
              </div>
              {types.length > 0 && (
                <div className='relationship-filter' role='group' aria-label='관계도 유형 필터'>
                  <button className='btn sm' type='button' aria-pressed={!present.some((t) => hidden.has(t))} onClick={() => applyHidden(new Set())}>전체</button>
                  {types.map(({ id, label, count }) => {
                    const next = toggleHiddenType(hidden, id, present)
                    // 보이는 유형이 하나뿐이면 그 버튼은 잠긴다(toggleHiddenType이 같은 집합을 돌려줌): 그래프가 비지 않게.
                    return <button key={id} className='btn sm' type='button' aria-pressed={!hidden.has(id)} disabled={next === hidden} onClick={() => applyHidden(next)}>{label} {count}</button>
                  })}
                </div>
              )}
            </div>
            <div className='relationship-canvas'>
              <CharacterCards key={layoutVersion} vm={{...map,graph}} center={focused?anchor:undefined} editing={{busy:studio.busy,selectedRelations:open?studio.editing!.settings.filter(s=>s.item.kind==='relation'&&((s.item.subjectId===source&&s.item.targetId===target)||(s.item.subjectId===target&&s.item.targetId===source))).map(s=>s.item.id):[],targetSource:choosing?source:null,onPick:pick,onSelect:id=>{if(choosing){selectPair(source,id,true)}else if(studio.confirmRelationDiscard()){studio.editCard(id)}},onConnect:id=>{if(selectPair(id,'',false))setChoosing(true)},onRelation:id=>studio.editRelation(id)}}/>
              <div className='relationship-hint' role='status'>{choosing?<>{name(source)}의 연결 상대를 고르세요.<button ref={cancelConnect} className='btn sm' type='button' onClick={stopChoosing}>연결 취소</button></>:'카드 두 개를 차례로 누르면 관계를 이어요.'}</div>
              <ul className='relationship-legend' aria-label='범례'>
                <li><LineKey tone='edge' />구조 관계</li>
                <li><LineKey tone='emotion' dashed />감정(방향별)</li>
                <li><LineKey tone='edge' arrow />방향이 있는 관계</li>
              </ul>
            </div>
          </div>
          <div className='relationship-service-form'>
            {studio.deletedCard?.person && (
              <p role='status' className='world-delete-notice'>
                <span>‘{studio.deletedCard.title || '이름 없는 설정'}’ 인물이 삭제됐어요. 저장해야 반영돼요.</span>
                <button
                  className='btn sm'
                  type='button'
                  onClick={() => {
                    if (open && !studio.confirmRelationDiscard()) return
                    const id = studio.undoCardDeletion()
                    if (id) { setSource(id); setOpen(false); setChoosing(false); setFormOpen(true); setFocusTo('source') }
                  }}
                >
                  인물 삭제 되돌리기
                </button>
              </p>
            )}
            <details className='relationship-add' open={formOpen} onToggle={(e) => setFormOpen(e.currentTarget.open)}>
              <summary>관계 추가</summary>
              <div className='relationship-add-body'>
                <div className='world-form-row'>
                  <div className='field'>
                    <label>관계 주체 검색<input className='inp' type='search' value={sourceQuery} onChange={(e) => { setSourceQuery(e.target.value); setSourcePage(0) }} /></label>
                    <label>관계 주체<select
                      ref={sourceSelect}
                      className='inp'
                      value={source}
                      onChange={(e) => selectPair(e.target.value, target, false)}
                    >
                      <option value=''>선택하세요</option>
                      {sourceOptions.items.map((s) => (
                        <option key={s.item.id} value={s.item.id}>
                          {s.item.title || '이름 없는 설정'}
                        </option>
                      ))}
                    </select></label>
                    <PageControls page={sourceOptions.page} pages={sourceOptions.pages} onPage={setSourcePage} />
                  </div>
                  <div className='field'>
                    <label>관계 대상 검색<input className='inp' type='search' value={targetQuery} onChange={(e) => { setTargetQuery(e.target.value); setTargetPage(0) }} /></label>
                    <label>관계 대상<select
                      className='inp'
                      value={target}
                      onChange={(e) => selectPair(source, e.target.value, false)}
                    >
                      <option value=''>선택하세요</option>
                      {targetOptions.items.map((s) => (
                        <option key={s.item.id} value={s.item.id}>
                          {s.item.title || '이름 없는 설정'}
                        </option>
                      ))}
                    </select></label>
                    <PageControls page={targetOptions.page} pages={targetOptions.pages} onPage={setTargetPage} />
                  </div>
                </div>
                <div className='relationship-actions'>
                  <button ref={writeButton} className='btn pri' type='button' disabled={!source || !target || source === target} onClick={() => setOpen(true)}>관계 작성</button>
                </div>
                {people.length < 2 && (
                  <p className='small muted'>설정 카드에서 설정 두 개를 먼저 추가하세요. 관계 없이도 저장할 수 있어요.</p>
                )}
              </div>
            </details>
            <section ref={list} tabIndex={-1} className='relationship-list' aria-label='관계 목록'>
              <h4>관계 목록 <span className='small muted'>{scoped && anchorNode ? `${anchorNode.name}의 관계 ${listed.length}개` : `${relations.length}개`}</span></h4>
              {anchorNode && relations.length > 0 && (
                <button type='button' className='btn sm' onClick={() => { setExpandedFor(scoped ? anchor : ''); setRelationPage(0) }}>
                  {scoped ? `전체 ${relations.length}개 보기` : `${anchorNode.name}의 관계만 ${centered.length}개 보기`}
                </button>
              )}
              {!relations.length
                ? <p>아직 연결한 관계가 없어요.</p>
                : !listed.length
                ? <p>{anchorNode?.name}에 이어진 관계가 없어요. 전체 관계는 위 버튼으로 볼 수 있어요.</p>
                : (
                  <div className='adm-scroll'>
                  <table className='relationship-table world-compact'>
                    <caption className='sr-only'>저장할 관계 목록</caption>
                    <thead>
                      <tr><th scope='col' className='col-subject'>주체</th><th scope='col'>관계</th><th scope='col' className='col-target'>대상</th>{studio.relationFrom && <th scope='col' className='col-from'>시작 회차</th>}<th scope='col'><span className='sr-only'>편집·삭제</span></th></tr>
                    </thead>
                    <tbody>
                      {listedRelations.items.map((s) => {
                        const label = relationLabel(s.item), full = `${name(s.item.subjectId)} · ${label} · ${name(s.item.targetId)}`
                        return (
                          <tr key={s.item.id} aria-describedby={readOnly(s) ? readOnlyReason : undefined}>
                            <td>{!readOnly(s) && s.item.subjectId && peopleById.has(s.item.subjectId) ? <button type='button' className='relationship-card-link' onClick={() => { if (studio.confirmRelationDiscard()) studio.editCard(s.item.subjectId!) }}>{name(s.item.subjectId)}</button> : name(s.item.subjectId)}</td>
                            <td>{label}</td>
                            <td>{!readOnly(s) && s.item.targetId && peopleById.has(s.item.targetId) ? <button type='button' className='relationship-card-link' onClick={() => { if (studio.confirmRelationDiscard()) studio.editCard(s.item.targetId!) }}>{name(s.item.targetId)}</button> : name(s.item.targetId)}</td>
                            {studio.relationFrom && <td>{s.item.fromEpisode === undefined ? '—' : `${s.item.fromEpisode}화부터`}</td>}
                            <td className='relationship-row-actions'>
                              {readOnly(s)
                                ? <span className='small muted'>읽기 전용</span>
                                : (
                                  <>
                                    <button className='btn sm' type='button' aria-label={`${full} 편집`} onClick={() => selectPair(s.item.subjectId ?? '', s.item.targetId ?? '', true)}>편집</button>
                                    <button className='btn sm' type='button' aria-label={`${full} 삭제`} onClick={() => removeRelation(s.item.id, full)}>삭제</button>
                                  </>
                                )}
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                  </div>
                )}
              <PageControls page={listedRelations.page} pages={listedRelations.pages} onPage={setRelationPage} />
              {listed.some(readOnly) && <p id={readOnlyReason} className='small muted'>삭제된 설정과 이어진 관계는 읽기 전용이에요. 관계도에는 그리지 않고, 저장하면 그대로 유지돼요.</p>}
            </section>
          </div>
        </div>
      </fieldset>
      {open && (
        <Sheet sid="W01" label={`${name(source)} ↔ ${name(target)} 관계`} panelClass="sheet world-sheet relationship-sheet" onClose={closePair}>
          <div className="world-sheet-head"><h3>{name(source)} ↔ {name(target)} 관계</h3><button type="button" className="btn sm" onClick={closePair}>닫기</button></div>
          <fieldset className="world-fields" disabled={studio.busy}>
            <legend className="sr-only">관계 작성</legend>
            <div className="relationship-pair">
              <RelationPairEditor
                key={source + '|' + target}
                studio={studio}
                source={source}
                target={target}
                focusRequest={focusRequest}
                onClose={() => { setOpen(false); setFocusTo('write') }}
              />
            </div>
          </fieldset>
        </Sheet>
      )}
    </section>
  )
}

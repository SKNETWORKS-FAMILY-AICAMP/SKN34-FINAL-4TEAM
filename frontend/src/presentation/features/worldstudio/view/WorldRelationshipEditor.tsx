import RelationGraph from './RelationGraph'
import { buildSettingRelationshipMap, cardTypeCounts, hideCardTypes, toggleHiddenType } from '../viewmodel/characterMap'
import { clearFilter, loadFilter, saveFilter } from '../viewmodel/relationPrefs'
import { defaultRelationView, hideRelationKinds, localGraph, relationKinds } from '../viewmodel/relationView'
import { Sheet } from '../../../shared/Sheet'
import { useWorldMapViewModel } from '../viewmodel/useWorldMapViewModel'
import './world-map.css'
import { cardTypeOf, cardTypes, type CardType } from '../../../../domain/entities/studioCards'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { CardDeletionConfirm } from './CardDeletionConfirm'
import { RelationPairEditor } from './RelationPairEditor'
import { DELETED_CARD_NAME, relationLabel } from '../../../../domain/entities/studioRelations'
import type { Filters } from './GraphSettingsPanel'
import type { useWorldStudioViewModel } from '../viewmodel/useWorldStudioViewModel'
type VM = ReturnType<typeof useWorldStudioViewModel>

/** 설정 찾기 선택지(datalist)의 크기: native 선택지는 200개를 감당해, 57장 세계관에서도 목록을 쪽으로 나누지 않는다. */
const CHOICES = 200

/**
 * 관계 연결 단계(관리 모드의 관계도 보기·작성 모드 3단계). 관계도 캔버스(`RelationGraph`, react-force-graph, 옵시디언 그래프 뷰처럼 점과 이름뿐)에서만 조작한다: 설정을 더하고(`+ 설정 추가` 패널·오른쪽 클릭),
 * 노드·선을 오른쪽 클릭 메뉴·더블클릭·키보드 목록으로 고치고 이어 지운다. 하단의 '관계 추가' 폼과 관계 목록 표는 없다. 관계를 만들거나 고치는 곳은 모두 가운데에 뜨는 관계 작성 시트(`RelationPairEditor`, 720px)다.
 * 설정 찾기(`<input list>`: 이름을 쓰거나 목록에서 고르면 그 설정이 선택되고 캔버스 가운데로 옮겨 간다, 쓰는 동안 이름에 맞지 않는 노드는 흐려진다)와 유형 필터(체크박스)는 캔버스의 설정 패널(톱니)의 필터 칸에 있다.
 * 둘 다 이 화면에서만 쓰는 보기 상태라 주소·초안·저장과 무관하고, 숨긴 유형의 카드와 그 카드에 닿는 관계선만 그래프에서 뺀다(보이는 유형이 하나뿐이면 그 체크박스는 잠긴다). 선택했거나 연결을 시작한 카드가 숨겨지면 그 선택·연결 모드를 푼다. 패널을 닫으면 설정 찾기 글은 지워진다.
 * 관계 종류 필터(같은 이름끼리 묶음, 끈 종류의 선은 그리지 않는다)와 유형 필터는 이 기기(localStorage)에 세계관별로 기억하고(`relationPrefs`), 처음 여는 세계관은 기본 보기(인물이 둘 이상이면 인물만, 알고 있음·전해 들음·목격 끔)다. 필터 초기화는 기억을 지운다. 노드 중심(로컬) 보기(`center`: 노드 메뉴의 '이 설정 중심으로 보기', 깊이 1·2)는 기억하지 않는 화면 상태다.
 * 캔버스 위 한 줄(`.relationship-bar`)은 알림이 있을 때만 그려진다: 삭제된 설정과 이어진 지난 회차 관계 수, 삭제 되돌리기.
 * 연결 모드: 노드의 '관계 연결' 메뉴로 주체를 정하면 안내문에 '연결 취소'가 뜨고(Esc도 취소) 다음에 누른 노드가 상대가 되어 시트가 열린다. 선 클릭·편집(`studio.editRelation`)도 같은 시트로 간다. 취소하면 초점은 메뉴를 열기 전 자리로 돌아간다.
 * 카드 삭제는 설정집 편집 화면과 같은 확인(`CardDeletionConfirm`: 함께 지워지는 관계·참조 막힘)을 시트로 열고, 회차를 고른 동안(`studio.deleteLock`)은 잠긴다. 지우면 되돌리기 알림이 뜬다. 관계 삭제는 확인 뒤 '편집본에 적용'과 같은 경로(applyRelations)이고 저장해야 서버에 닿는다.
 * 삭제된 설정과 이어진 지난 회차 관계(DEC-51)는 그릴 곳이 없어 개수만 한 줄로 알린다(저장하면 그대로 유지된다).
 * 안내문('연결 취소' 포함)은 캔버스 감싸개(`.relationship-canvas`) 안에 있어, 작성 모드는 캔버스 위 줄이고 관리 모드 관계도 보기는 캔버스 아래 가운데에 겹친 작은 글이다(`world-studio.css`). 관계 기준 회차 칸은 이 편집기 바깥(`WorldStudioPage`)이라 편집기가 다시 열려도 초점이 남는다.
 */
export function WorldRelationshipEditor({ studio }: { studio: VM }) {
  const map = useWorldMapViewModel(studio.editing!.settings, buildSettingRelationshipMap)
  const [choosing, setChoosing] = useState(false)
  const worldId = studio.editing!.id
  // 필터(끈 유형·관계 종류): 이 기기에 세계관별로 기억한 값, 없으면 기본 보기(인물이 둘 이상이면 인물만, 정보 관계는 끔). 사용자가 바꿀 때만 기억한다.
  const [filter, setFilter] = useState(() => { const base = loadFilter(worldId) ?? defaultRelationView(map.graph); return { hidden: new Set<CardType>(base.hiddenTypes) as ReadonlySet<CardType>, hiddenKinds: new Set(base.hiddenKinds) as ReadonlySet<string> } })
  const types = cardTypeCounts(map.graph.nodes), present = types.map((t) => t.id), presentKey = present.join()
  // 기억한 필터가 보이는 유형을 모두 끈 상태면(세계관이 바뀐 경우) 모든 유형을 켠 것으로 본다.
  const hidden = useMemo(() => (present.length && present.every((t) => filter.hidden.has(t)) ? new Set<CardType>() : filter.hidden), [filter.hidden, presentKey]) // eslint-disable-line react-hooks/exhaustive-deps -- present는 presentKey로 본다
  const [center, setCenter] = useState<{ id: string; depth: 1 | 2 } | null>(null)
  const centerNode = center && map.graph.nodes.find((n) => n.id === center.id)
  const byTypes = useMemo(() => hideCardTypes(map.graph, hidden), [map.graph, hidden])
  const kinds = useMemo(() => relationKinds(byTypes.links), [byTypes])
  const byKinds = useMemo(() => hideRelationKinds(byTypes, filter.hiddenKinds), [byTypes, filter.hiddenKinds])
  const shown = useMemo(() => (center && centerNode ? localGraph(byKinds, center.id, center.depth) : byKinds), [byKinds, center, centerNode])
  const [typed, setTyped] = useState(''), [find, setFind] = useState<{ id: string; seq: number } | null>(null)
  // 설정 찾기의 선택지(datalist): 쓰는 글이 이름에 들어 있는 카드를 한 쪽 CHOICES개까지(글이 없으면 앞의 CHOICES개).
  const choices = shown.nodes.filter((n) => n.name.toLocaleLowerCase().includes(typed.trim().toLocaleLowerCase())).slice(0, CHOICES)
  const section = useRef<HTMLElement>(null), cancelConnect = useRef<HTMLButtonElement>(null)
  // 연결 모드를 시작한 자리(메뉴를 열기 전에 초점이 있던 요소): 연결을 취소하면 초점이 그리로 돌아간다.
  const connectOpener = useRef<HTMLElement | null>(null), returnFocus = useRef(false)
  useEffect(() => {
    if (choosing) cancelConnect.current?.focus()
    else if (returnFocus.current) {
      returnFocus.current = false
      const back = connectOpener.current
      ;(back?.isConnected ? back : section.current?.querySelector<HTMLElement>('.relationship-flow'))?.focus()
    }
  }, [choosing])
  const people = studio.editing!.settings.filter((s) => cardTypes.some((type) => type.id === cardTypeOf(s.item)))
  const [source, setSource] = useState(''), [target, setTarget] = useState(''), [open, setOpen] = useState(false)
  const [deleting, setDeleting] = useState('') // 삭제를 확인 중인 카드 id
  const [focusRequest, setFocusRequest] = useState<{ id: string; seq: number } | null>(null)
  const handledRequest = useRef(0)
  const selectPair = useCallback((nextSource: string, nextTarget: string, nextOpen: boolean) => {
    // 열린 패널과 같은 두 설정(방향 무관)을 다시 고르면 작성 중인 초안을 그대로 둔다.
    if (open && nextOpen && nextSource === target && nextTarget === source) return true
    if (open && (nextSource !== source || nextTarget !== target) && !studio.confirmRelationDiscard()) return false
    setSource(nextSource)
    setTarget(nextTarget)
    setOpen(nextOpen)
    setChoosing(false)
    map.select(nextSource || null)
    return true
  }, [open, source, target, studio, map])
  useEffect(() => {
    const request = studio.relationRequest
    if (!request || request.seq === handledRequest.current) return
    handledRequest.current = request.seq
    const item = studio.editing?.settings.find((row) => row.item.id === request.id && row.item.kind === 'relation')?.item
    if (!item?.subjectId || !item.targetId) return
    const samePair = open && (item.subjectId === source && item.targetId === target || item.subjectId === target && item.targetId === source)
    if (samePair || selectPair(item.subjectId, item.targetId, true)) setFocusRequest(request)
  }, [studio.relationRequest, studio.editing?.settings, open, source, target, selectPair])
  const stopChoosing = () => { returnFocus.current = true; setChoosing(false) }
  // 노드를 누를 때: 연결 모드면 상대(주체를 다시 누르면 연결 취소), 아니면 선택만 한다. 열린 초안은 selectPair가 확인을 거친다.
  const pick = (id: string) => {
    if (!choosing) { map.select(id); return }
    if (id === source) stopChoosing()
    else selectPair(source, id, true)
  }
  // 유형 필터의 새 숨김 집합을 적용한다. 선택한 카드나 연결을 시작한 카드의 유형이 숨겨지면 그 선택·연결 모드를 푼다(숨은 카드에는 상대 선택·관계 연결을 할 수 없다).
  const applyHidden = (next: ReadonlySet<CardType>) => {
    setFilter({ ...filter, hidden: next })
    saveFilter(worldId, { hiddenTypes: [...next], hiddenKinds: [...filter.hiddenKinds] })
    release(next)
  }
  // 새 숨김 집합이 숨기는 카드를 고른 상태·연결 시작 카드로 두지 않는다(숨은 카드에는 상대 선택·관계 연결을 할 수 없다).
  const release = (next: ReadonlySet<CardType>) => {
    const gone = (id?: string) => { const type = map.graph.nodes.find((n) => n.id === id)?.type; return !!type && next.has(type) }
    if (gone(map.selected?.id)) map.select(null)
    if (choosing && gone(source)) setChoosing(false)
  }
  const chooseFound = (value: string) => {
    setTyped(value)
    map.setQuery(value) // 쓰는 동안 이름에 맞지 않는 노드는 흐려진다
    const hit = shown.nodes.find((n) => n.name === value) // 목록에서 고르거나 이름을 그대로 쓰면 그 카드를 찾은 것이다
    if (!hit) return
    map.select(hit.id)
    setFind((previous) => ({ id: hit.id, seq: (previous?.seq ?? 0) + 1 }))
  }
  // 관계 종류를 켜고 끈다(이름 여러 개를 한꺼번에: 하나라도 보이면 모두 끄고, 모두 꺼져 있으면 모두 켠다).
  const toggleKinds = (names: readonly string[]) => {
    const next = new Set(filter.hiddenKinds), hide = names.some((name) => !next.has(name))
    for (const name of names) { if (hide) next.add(name); else next.delete(name) }
    setFilter({ ...filter, hiddenKinds: next })
    saveFilter(worldId, { hiddenTypes: [...filter.hidden], hiddenKinds: [...next] })
  }
  const resetFilter = () => {
    clearFilter(worldId)
    const base = defaultRelationView(map.graph)
    setFilter({ hidden: new Set(base.hiddenTypes), hiddenKinds: new Set(base.hiddenKinds) })
    release(new Set(base.hiddenTypes))
  }
  const filters: Filters = {
    typed, onTyped: chooseFound, choices,
    kinds, hiddenKinds: filter.hiddenKinds, onToggleKind: toggleKinds, onReset: resetFilter,
    center: center && centerNode ? { id: center.id, name: centerNode.name, depth: center.depth } : null,
    onDepth: (depth) => setCenter((old) => old && { ...old, depth }),
    onClearCenter: () => setCenter(null),
    // 보이는 유형이 하나뿐이면 그 체크박스는 잠긴다(toggleHiddenType이 같은 집합을 돌려줌): 그래프가 비지 않게.
    types: types.map((t) => ({ ...t, locked: toggleHiddenType(hidden, t.id, present) === hidden })),
    hidden, onToggleType: (id) => applyHidden(toggleHiddenType(hidden, id, present)),
  }
  // 관계 작성 시트를 닫는다(닫기·Esc·배경). 입력한 변경이 있으면 버릴지 먼저 묻는다. 닫은 뒤 초점은 시트가 연 요소(캔버스)로 돌려준다.
  const closePair = () => { if (studio.confirmRelationDiscard()) setOpen(false) }
  const { settings, deletedTitles } = studio.editing!
  const relations = settings.filter((s) => s.item.kind === 'relation')
  const peopleById = new Map(people.map((s) => [s.item.id, s]))
  const existingIds = new Set(settings.filter((s) => s.item.kind !== 'relation').map((s) => s.item.id))
  const name = (id: string | null) => {
    if (id !== null && !existingIds.has(id)) {
      const title = deletedTitles?.[id]
      return title ? DELETED_CARD_NAME + ': ' + title : DELETED_CARD_NAME
    }
    return (id ? peopleById.get(id)?.item.title : '') || '선택 안 함'
  }
  // 지난 회차 관계는 그 뒤에 삭제한 설정을 끝점으로 가질 수 있다(DEC-51). 관계도에는 그릴 곳이 없고 저장하면 그대로 보낸다.
  const orphaned = relations.filter((s) => (s.item.subjectId !== null && !existingIds.has(s.item.subjectId)) || (s.item.targetId !== null && !existingIds.has(s.item.targetId))).length
  // 관계 삭제도 '편집본에 적용'과 같은 경로(applyRelations)다. 저장 전까지는 서버에 닿지 않는다. 열린 초안이 있으면 버릴지 먼저 묻고 패널을 닫는다.
  const removeRelation = (id: string) => {
    const row = relations.find((s) => s.item.id === id)
    if (!row) return
    if (open && !studio.confirmRelationDiscard()) return
    const label = name(row.item.subjectId) + ' · ' + relationLabel(row.item) + ' · ' + name(row.item.targetId)
    if (!window.confirm(label + ' 관계를 삭제할까요? 세계관을 저장해야 반영돼요.')) return
    if (studio.applyRelations([], [id])) {
      setOpen(false)
      setChoosing(false)
      section.current?.querySelector<HTMLElement>('.relationship-flow')?.focus() // 지운 선이 사라지니 초점은 캔버스로 간다
    }
  }
  // 카드 삭제는 확인 시트를 거친다(설정집 편집 화면의 '카드 삭제'와 같은 확인). 회차를 고른 동안은 잠겨 이유를 오류로 알린다.
  const askDeleteCard = (id: string) => {
    if (studio.busy) return
    if (studio.deleteLock) { studio.deleteCard(id); return }
    if (open && !studio.confirmRelationDiscard()) return
    setDeleting(id)
  }
  const undoDeletion = () => { const id = studio.undoCardDeletion(); if (id) map.select(id) }
  // 다른 화면(편집 화면의 카드 삭제)에서 고른 카드가 지워지면 그 카드를 가리키던 선택·연결 모드·작성 패널을 풀어 지워진 카드에 관계를 잇지 못하게 한다.
  const stale = (!!source && !existingIds.has(source)) || (!!target && !existingIds.has(target))
  useEffect(() => {
    if (stale) { setSource(''); setTarget(''); setOpen(false); setChoosing(false) }
  }, [stale])
  const deletion = deleting && existingIds.has(deleting) ? studio.cardDeletionInfo(deleting) : null
  const deletedNoun = studio.deletedCard?.person ? '인물' : '설정'
  return (
    <section ref={section} className='world-map relationship-editor' aria-label='관계 편집' onKeyDown={(e) => { if (choosing && e.key === 'Escape') stopChoosing() }}>
      <fieldset className='world-fields' disabled={studio.busy}>
        <legend className='sr-only'>관계 대상 선택</legend>
        <div className='relationship-stage'>
          {(orphaned > 0 || studio.deletedCard) && (
            <div className='relationship-bar'>
              {orphaned > 0 && <p className='relationship-orphans small muted'>삭제된 설정과 이어진 관계 {orphaned}개는 저장 시 그대로 유지돼요</p>}
              {studio.deletedCard && (
                <p role='status' className='world-delete-notice'>
                  <span>‘{studio.deletedCard.title || '이름 없는 설정'}’ {deletedNoun}이 삭제됐어요. 저장해야 반영돼요.</span>
                  <button className='btn sm' type='button' onClick={undoDeletion}>삭제 되돌리기</button>
                </p>
              )}
            </div>
          )}
          <div className='relationship-canvas'>
            <RelationGraph
              vm={{ graph: shown, selected: map.selected, visible: map.visible }}
              find={find}
              filters={filters}
              editing={{
                busy: studio.busy,
                selectedRelations: open ? relations.filter((s) => (s.item.subjectId === source && s.item.targetId === target) || (s.item.subjectId === target && s.item.targetId === source)).map((s) => s.item.id) : [],
                targetSource: choosing ? source : null,
                deleteLock: studio.deleteLock,
                onPick: pick,
                onSelect: (id) => { if (studio.confirmRelationDiscard()) studio.editCard(id) },
                onConnect: (id) => {
                  connectOpener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
                  if (selectPair(id, '', false)) setChoosing(true)
                },
                onRelation: (id) => studio.editRelation(id),
                onDeleteCard: askDeleteCard,
                onDeleteRelation: removeRelation,
                onAdd: (type) => studio.addCard(type),
                onMark: (id) => map.select(id),
                onCenter: (id) => setCenter({ id, depth: 1 }),
              }}
            />
            <div className='relationship-notes'>
              <div className='relationship-hint' role='status'>{choosing ? <>{name(source)}의 연결 상대를 고르세요.<button ref={cancelConnect} className='btn sm' type='button' onClick={stopChoosing}>연결 취소</button></> : shown.nodes.length ? '노드를 누르면 이웃을 강조해요. 더블클릭은 정보 편집, 오른쪽 클릭은 메뉴(관계 연결·삭제)예요.' : '설정 카드가 없어요. + 설정 추가나 오른쪽 클릭으로 첫 카드를 더해 보세요.'}</div>
            </div>
          </div>
        </div>
      </fieldset>
      {open && (
        <Sheet sid="W01" label={name(source) + ' ↔ ' + name(target) + ' 관계'} panelClass="sheet world-sheet relationship-sheet" onClose={closePair}>
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
                onClose={() => setOpen(false)}
              />
            </div>
          </fieldset>
        </Sheet>
      )}
      {deletion && (
        <Sheet sid="W02" label="설정 삭제 확인" panelClass="sheet world-sheet" onClose={() => setDeleting('')}>
          <CardDeletionConfirm deletion={deletion} onDelete={() => { if (studio.deleteCard(deleting)) { setDeleting(''); map.select(null) } }} onCancel={() => setDeleting('')} />
        </Sheet>
      )}
    </section>
  )
}

import { Fragment, useEffect, useId, useRef, useState } from 'react'

import { cardTypeOf, cardTypes } from '../../../../domain/entities/studioCards'
import { cardRevealEpisode, invalidReveal, REVEAL_EPISODE_ERROR, type StudioSetting } from '../../../../domain/entities/studioWorld'
import { revealEpisodeInput } from '../../../../domain/entities/worldStudioWriting'
import type { CardStatus } from '../../../../domain/entities/worldReview'
import { Go } from '../../../shared/Go'
import { KindChip } from '../../../shared/KindChip'
import { type BoardRow } from '../../../shared/worldBoard'
import { PageControls } from '../../../shared/PageControls'
import { pageItems } from '../../../shared/pageItems'
import { publishAllCards, revealLabel, setCardReveal, visibleSelection } from '../viewmodel/cardVisibility'
import { importedSource } from '../../../shared/importCards'
import { labelOf } from '../viewmodel/settingBoard'
import type { CardPane } from '../viewmodel/cardPanels'
import { BOARD_SORTS, useCardBoard } from '../viewmodel/useCardBoard'
import type { CardImages } from '../viewmodel/useCardImages'
import type { useWorldStudioViewModel } from '../viewmodel/useWorldStudioViewModel'
import { cardPath } from '../../worlds/worldDetail'
import { CardThumb } from './WorldCardImage'
import { CardWikiPreview } from './WorldCardPreview'
import { NewCardMenu } from './NewCardMenu'
import { WorldImportSheet } from './WorldImportSheet'

type VM = ReturnType<typeof useWorldStudioViewModel>

/** 상태 칩 하나: 보이는 글, 읽는 이름, 눌렀을 때 그 카드의 편집 화면이 열릴 본문 화면(활동 막대의 탭). */
type StatusChip = { text: string; name: string; pane: CardPane }
/** 원고로 세계관을 만들거나 업데이트할 때 이름이 같은 카드가 둘 이상이라 작가 확인을 남긴 카드(`needsReview`)의 칩이다. 보완 상태(`CardStatus`)가 아니라 카드의 표시값이라 상태가 없는 카드에도 붙는다. */
const reviewChip = (title: string): StatusChip => ({ text: '확인 필요', name: `${title} 확인 필요 보기`, pane: 'doc' })
const statusChips = (title: string, status: CardStatus): StatusChip[] => [
  ...(status.cleanup ? [{ text: '정리 필요', name: `${title} 정리 필요 보기`, pane: 'doc' as const }] : []),
  ...(status.unlinked ? [{ text: '연결 필요', name: `${title} 연결 필요 보기`, pane: 'relations' as const }] : []),
  ...(status.order ? [{ text: `공개 순서 ${status.order}`, name: `${title} 공개 순서 ${status.order}건 보기`, pane: 'order' as const }] : []),
  ...(status.opinions ? [{ text: `AI 의견 ${status.opinions}`, name: `${title} AI 의견 ${status.opinions}건 보기`, pane: 'doc' as const }] : []),
]

/** 상태 칸의 칩들(눌러서 그 카드의 편집 화면을 칩에 맞는 화면으로 연다). 줄까지 올라가 미리보기를 여닫지 않게 누름은 줄에 닿지 않는다. */
function StatusChips({ chips, onOpen }: { chips: StatusChip[]; onOpen: (pane: CardPane) => void }) {
  return (
    <span className="world-status">
      {chips.map((chip) => <button key={chip.text} type="button" className="world-todo world-status-chip" aria-label={chip.name} onClick={(e) => { e.stopPropagation(); onOpen(chip.pane) }}>{chip.text}</button>)}
    </span>
  )
}

/**
 * 게시판 한 줄. 줄(마우스)이나 제목 버튼(키보드·주 컨트롤)을 누르면 그 줄 바로 아래에 미리보기가 열리고 닫힌다(관리자 표의 행 선택과 같은 `tr.click`·`tr.sel`). 편집 화면은 미리보기의 `수정하기`가 연다. 제목 옆 `[n]`은 공개 설정집과 같은 관계·연결 수다(넓은 표에서는 연결 칸이 같은 수를 보이므로 CSS가 가리고, 읽는 사람에게는 글로 남는다).
 * 맨 앞 체크박스는 공개 설정을 한 번에 바꿀 카드를 고르고(미리보기를 열지 않는다), `공개` 칸은 그 카드의 공개 설정이다(`N화부터`·`작가 전용`, 소설이 연결되지 않은 세계관의 1화는 `공개`, DEC-53). 다른 세계관에서 가져온 카드는 `가져옴`과 출처를 제목 아래에 보인다.
 * 보완 상태는 제목 옆이 아니라 `상태` 칸에 칩으로 모인다(알리기만 하고 이 표시 때문에 저장·확정이 막히지는 않는다, 없으면 —): 인물의 필수 문서(IDENTITY.md·SOUL.md, GOAL.md는 선택) 가운데 비어 있는 것이 있으면 `정리 필요`,
 * 사건·사물이 어느 인물과도 승인된 관계로 이어지지 않았으면 `연결 필요`, 이 카드의 글에 더 늦게 공개되는 카드의 이름이 나오면 `공개 순서 N`(DEC-53, N은 경고 건수), 마지막 AI 검토가 남긴 지적이 있으면 `AI 의견 N`, 원고로 세계관을 만들거나 업데이트할 때 이름이 같은 카드가 둘 이상이라 작가 확인을 남긴 카드(`needsReview`: 보완 상태가 아니라 카드의 표시값이라 `보완 필요` 필터·건수에는 들어가지 않는다)는 `확인 필요`다.
 * 칩을 누르면 미리보기를 거치지 않고 그 카드의 편집 화면이 칩에 맞는 화면(활동 막대 탭: 정리 필요·AI 의견·확인 필요는 문서, 연결 필요는 관계, 공개 순서는 공개 순서)으로 열린다.
 * 본문이 좁으면 번호·분류·요약·연결 칸이 숨는다(world-studio.css의 컨테이너 규칙). 그때 분류와 요약을 잃지 않도록 제목 아래 한 줄(`.world-row-sub`)에도 두고, 넓은 본문에서는 CSS가 그 줄을 숨긴다.
 * 760px 이하에서는 상태 칸도 숨고 같은 칩이 제목 아래 한 줄(`.world-row-status`)로 보인다(`.world-row-sub`처럼 CSS만으로 둘 중 하나만 보이므로 브라우저의 접근성 트리에는 늘 한 벌이다. 화면 테스트는 CSS가 없어 두 벌이 다 있으니 상태 칸에서 칩을 찾는다).
 */
function Row({ row, setting, status, images, picked, linked, previewing, previewId, onPick, onOpen, onToggle }: { row: BoardRow; setting?: StudioSetting; status?: CardStatus; images: CardImages; picked: boolean; linked: boolean; previewing: boolean; previewId: string; onPick: (id: string, on: boolean) => void; onOpen: (id: string, pane: CardPane) => void; onToggle: (id: string) => void }) {
  const reveal = setting && cardRevealEpisode(setting)
  const chips = [...(status ? statusChips(row.title, status) : []), ...(setting?.needsReview ? [reviewChip(row.title)] : [])]
  // 줄 전체가 미리보기를 여닫으므로, 자기 일이 따로 있는 컨트롤(체크박스·상태 칩)은 줄까지 올라가지 않게 한다(관리자 표의 행 선택과 같은 방식).
  const open = (pane: CardPane) => onOpen(row.cardId, pane)
  return (
    <tr className={'click' + (previewing ? ' sel' : '')} onClick={() => onToggle(row.cardId)}>
      <td className="col-pick" onClick={(e) => e.stopPropagation()}><label className="world-pick"><input type="checkbox" checked={picked} onChange={(e) => onPick(row.cardId, e.target.checked)} /><span className="sr-only">{row.title} 선택</span></label></td>
      <td className="col-no">{row.no || '–'}</td>
      <td className="col-kind"><KindChip kind={row.kind} label={row.type} /></td>
      <td className="col-title">
        <CardThumb images={images} imageId={setting?.imageId} />
        <button type="button" data-card={row.cardId} aria-label={`${row.title} ${row.type}`} aria-expanded={previewing} aria-controls={previewing ? previewId : undefined} onClick={(e) => { e.stopPropagation(); onToggle(row.cardId) }}>{row.title}</button>
        {row.badge > 0 && <span className="worlds-badge"><span className="world-count" aria-hidden="true">[{row.badge}]</span><span className="sr-only">{row.kind === '인물' ? '관계' : '연결'} {row.badge}개</span></span>}
        {setting?.importedFrom && <><span className="worlds-badge">가져옴</span><small className="world-imported-from">{importedSource(setting.importedFrom)}</small></>}
        {chips.length > 0 && <span className="world-row-status"><StatusChips chips={chips} onOpen={open} /></span>}
        <span className="world-row-sub"><KindChip kind={row.kind} label={row.type} />{row.text && <span>{row.text}</span>}</span>
      </td>
      <td className="col-status">{chips.length > 0 ? <StatusChips chips={chips} onOpen={open} /> : <><span aria-hidden="true">—</span><span className="sr-only">없음</span></>}</td>
      <td className="col-sum">{row.text}</td>
      <td className="col-vis" data-public={reveal !== undefined}>{revealLabel(reveal, linked)}</td>
      <td className="col-num">{row.connections}</td>
    </tr>
  )
}

/**
 * 고른 줄 바로 아래에 펼쳐지는 미리보기(한 칸짜리 줄): 공개 카드 페이지와 같은 위키 모양의 문서(`CardWikiPreview`: 정보 상자·번호 목차·접이식 본문·카드별 관계도·접힌 관계 자세히 보기, 지금 초안의 값이라 작가 전용 카드도 그대로)와
 * `수정하기`(편집 화면 `?card=`), `공개 화면 보기`(공개된 설정이고 세계관이 공개 목록에 있을 때만, 새 탭), `닫기`다. 문서 안의 설정 링크·관계도 이웃은 그 카드의 편집 화면을 연다([onOpen]).
 * 모든 폭에서 줄 바로 아래 인라인이라 오른쪽 AI 채팅 레일과 다투지 않고 표 폭도 줄지 않는다. 표의 행이 아니라 줄 안의 덩어리라 `presentation`이다(표 읽기 쪽은 데이터 줄만 센다).
 * 열릴 때 한 번 그 구획이 화면에 들어오게 가장 가까운 만큼만 스크롤한다(줄이 첫 화면 아래쪽이면 `수정하기`가 화면 밖이라 눌러도 반응이 없는 것처럼 보였다). 긴 문서는 CSS가 높이를 제한해 문서 안에서 스크롤하므로 버튼은 늘 보인다.
 * `Esc`는 미리보기 안 어디서든 닫고 제목으로 초점을 돌려준다(`닫기`와 같다).
 * ponytail: 게시판 폭이 1,000px 이상(채팅 닫힘 + 사이드바 접힘 + 1440px 이상)일 때의 옆 패널(표 | 미리보기)은 만들지 않는다. 필요해지면 `@container worlds-board (min-width:1000px)`에서 이 줄을 sticky 옆 칸으로 옮긴다.
 */
function RowPreview({ id, row, setting, settings, linked, publicPath, images, onOpen, onClose }: { id: string; row: BoardRow; setting?: StudioSetting; settings: readonly StudioSetting[]; linked: boolean; publicPath: string | null; images: CardImages; onOpen: (id: string) => void; onClose: () => void }) {
  const section = useRef<HTMLElement>(null)
  useEffect(() => { section.current?.scrollIntoView?.({ block: 'nearest' }) }, []) // 미리보기는 열릴 때마다 새로 그려진다(jsdom에는 scrollIntoView가 없다)
  return (
    <tr className="world-row-preview" role="presentation">
      <td colSpan={8} role="presentation">
        <section ref={section} id={id} className="world-preview" aria-label={`${row.title} 미리보기`} onKeyDown={(e) => { if (e.key === 'Escape') onClose() }}>
          {setting && <CardWikiPreview settings={settings} setting={setting} row={row} linked={linked} images={images} onOpen={onOpen} />}
          <div className="world-preview-actions">
            <button type="button" className="btn pri sm" onClick={() => onOpen(row.cardId)}>수정하기</button>
            {publicPath && <Go to={publicPath} target="_blank" rel="noopener noreferrer" className="btn sm">공개 화면 보기</Go>}
            <button type="button" className="btn sm" onClick={onClose}>닫기</button>
          </div>
        </section>
      </td>
    </tr>
  )
}

/**
 * 설정집 게시판(관리 모드의 설정집 보기, 작성 모드의 설정 카드 단계). 공개 설정집과 같은 게시판으로, 왼쪽 분류 메뉴 + 오른쪽 검색·정렬·결과 수·`다른 세계관에서 가져오기`·`+ 새 설정`을 둔 도구줄 아래 표(선택·번호·분류·제목[연결 수]·상태·요약·공개·연결, 8칸)다.
 * `onPreviewEdit`은 미리보기의 `수정하기`로 편집 화면에 들어갈 때 그 카드 id를 알려, 편집기가 미리보기 탭으로 시작하게 한다(레일·새 설정 같은 다른 입구는 알리지 않는다).
 * 내용 편집은 여기서 하지 않는다: 행(제목)을 누르면 그 줄 아래에 미리보기가 열리고(한 번에 하나, 편집 화면에 다녀와도 열린 채), 미리보기의 `수정하기`나 새 설정을 만들면 집필실 같은 편집 화면(`WorldCardStudio`, 주소 `?card=`)이 열리고, 삭제도 거기서 한다.
 * 편집 화면에서 돌아오면 그 카드의 행 제목에 초점이 가고, 미리보기를 닫으면 제목으로 초점이 돌아온다.
 * 설정 카드는 기본 작가 전용이고(DEC-53) 공개 설정만은 게시판에서 한 번에 바꾼다: 이 줄은 접힌 `공개 범위 한 번에 바꾸기` 한 줄로 시작해 행을 고르면 펼쳐지고, 행을 골라 `선택 공개`·`선택 비공개`, 또는 `전체 공개`로 바꾼다. 소설이 연결된 세계관이면 회차를 한 번 입력받아(기본 1화) 고른 카드 모두에 같은 'N화부터 공개'를 정하고,
 * 연결되지 않은 세계관은 `공개`(1화)다. 초안 변경이라 저장과 확정 버전을 거쳐야 공개 화면에 반영된다.
 * 바꾸면 한 일을 상태 문구로 알리고(`설정 N개를 공개로 뒀어요.`), 고른 것이 풀리거나 모두 공개가 돼 누른 버튼이 잠기므로 초점은 표 머리의 `보이는 설정 모두 선택`으로 옮긴다. 일부만 고른 동안 그 체크박스는 중간 상태다.
 * `다른 세계관에서 가져오기`는 가져오기 시트(`WorldImportSheet`)를 연다(닫히면 시트가 초점을 이 버튼으로 돌려준다).
 * 카드가 하나도 없으면 안내는 표 안 한 줄뿐이다. 카드가 아닌 기존 항목(관계·메모·분류 확인)은 표 아래 접힌 목록에서 열 수 있다.
 */
export function WorldCardBoard({ vm, onPreviewEdit }: { vm: VM; onPreviewEdit?: (id: string) => void }) {
  const world = vm.editing!
  const board = useCardBoard(vm, { showEmptyKinds: true })
  const emptyType = cardTypes.find((type) => type.label === board.emptyKind)
  const addFirstCard = () => {
    if (!emptyType) return
    const id = vm.addCard(emptyType.id)
    if (id) {
      vm.setCardQuery('')
      vm.editCard(id)
    }
  }
  const search = useRef<HTMLInputElement>(null)
  const table = useRef<HTMLTableSectionElement>(null)
  const byId = new Map(world.settings.map((s) => [s.item.id, s]))
  // 고른 카드는 지금 보이는 줄에서만 센다(필터로 가려진 줄을 모르는 채 바꾸지 않는다). 공개 범위를 바꾸면 고른 것을 푼다.
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set())
  // 일괄 공개 줄은 접혀 시작한다. 줄을 고르면 펼쳐지고(고른 것이 풀려도 접지 않아 한 일의 알림이 남는다) 직접 여닫을 수도 있다.
  const [bulkOpen, setBulkOpen] = useState(false)
  const picked = visibleSelection(board.paged.items, selected)
  const visiblePicked = picked.length
  const selectionText = `현재 페이지 ${picked.length}개 선택${selected.size > picked.length ? ` · 다른 페이지·필터 ${selected.size - picked.length}개 선택` : ''}`
  // 방금 한 일괄 변경의 결과 문구. 그 변경이 만든 초안 그대로일 때만 보이고(다른 수정·저장으로 초안이 바뀌면 낡은 말이 된다), 다시 고르면 지운다.
  const [done, setDone] = useState<{ text: string; settings: StudioSetting[] } | null>(null)
  const head = useRef<HTMLInputElement>(null)
  const select = (next: (current: ReadonlySet<string>) => ReadonlySet<string>, opens = false) => {
    setDone(null)
    if (opens) setBulkOpen(true)
    setSelected(next)
  }
  const pick = (id: string, on: boolean) => select((current) => new Set(on ? [...current, id] : [...current].filter((other) => other !== id)), on)
  // 일괄 공개의 회차: 소설이 연결된 세계관은 한 번 입력받고(기본 1화), 연결되지 않은 세계관은 '공개'(1화)다. 쓸 수 없는 값이면 공개 버튼이 잠긴다.
  const linked = !!vm.linkedWorkId
  const episodeId = useId()
  const [episodeText, setEpisodeText] = useState('1')
  const typed = linked ? revealEpisodeInput(episodeText) : 1
  const episode = typed !== undefined && !invalidReveal({ revealFromEpisode: typed }) ? typed : undefined
  const change = (on: boolean) => {
    const next = setCardReveal(world.settings, new Set(picked), on ? episode : undefined)
    if (next !== world.settings) vm.patch({ settings: next })
    setDone({ text: `현재 페이지 설정 ${picked.length}개를 ${on ? (linked ? `${episode}화부터 공개` : '공개') : '비공개'}로 뒀어요.`, settings: next })
    setSelected((current) => { const next = new Set(current); for (const id of picked) next.delete(id); return next })
    head.current?.focus()
  }
  const allPublic = episode === undefined ? world.settings : publishAllCards(world.settings, episode)
  const publishAll = () => {
    vm.patch({ settings: allPublic })
    setDone({ text: linked ? `모든 설정을 ${episode}화부터 공개로 뒀어요.` : '모든 설정을 공개로 뒀어요.', settings: allPublic })
    head.current?.focus()
  }
  // 일부만 고른 상태는 속성이 없어 DOM에 직접 표시한다.
  useEffect(() => {
    if (head.current) head.current.indeterminate = visiblePicked > 0 && visiblePicked < board.paged.items.length
  })
  const [importing, setImporting] = useState(false)
  // 미리보기는 한 번에 한 줄이고, 게시판은 편집 화면 뒤에서도 지우지 않아 편집 화면에 다녀와도 열린 채다.
  const [preview, setPreview] = useState('')
  const previewBase = useId()
  const toggle = (id: string) => setPreview((current) => (current === id ? '' : id))
  const closePreview = (id: string) => {
    setPreview('')
    table.current?.querySelector<HTMLElement>(`[data-card="${id}"]`)?.focus()
  }
  // 미리보기의 수정하기·본문의 설정 링크·관계도의 이웃은 같은 입구다: 읽던 글에서 넘어가므로 편집기가 미리보기 탭으로 시작한다(onPreviewEdit).
  const openFromPreview = (id: string) => { onPreviewEdit?.(id); vm.editCard(id) }
  const reveal = (id: string) => { const setting = byId.get(id); return setting && cardRevealEpisode(setting) }
  // 편집 화면을 보는 동안 그 카드를 기억했다가, 돌아오면(또는 되돌리기로 카드가 돌아오면) 그 행으로 초점을 옮긴다. 행이 없으면(필터 밖·삭제) 검색 칸으로 옮긴다.
  const back = useRef('')
  useEffect(() => {
    if (vm.selected) { back.current = vm.selected; return }
    const id = back.current
    if (!id) return
    const index = board.rows.findIndex((row) => row.cardId === id)
    if (index >= 0 && Math.floor(index / 50) !== board.paged.page) { board.setPage(Math.floor(index / 50)); return }
    back.current = ''
    ;(table.current?.querySelector<HTMLElement>(`[data-card="${id}"]`) ?? search.current)?.focus()
  })
  const legacy = world.settings.filter((s) => ['relation', 'review', 'note'].includes(cardTypeOf(s.item)))
  const [legacyPage, setLegacyPage] = useState(0)
  const legacyItems = pageItems(legacy, legacyPage, 50)
  const undo = () => {
    const id = vm.undoCardDeletion()
    if (id) back.current = id
  }
  return (
    <fieldset className="world-fields" disabled={vm.busy}>
      <legend className="sr-only">설정집</legend>
      {vm.deletedCard && (
        <p role="status" className="world-delete-notice">
          <span>‘{vm.deletedCard.title || '이름 없는 설정'}’ 설정이 삭제됐어요. 저장해야 반영돼요.</span>
          <button type="button" className="btn sm" onClick={undo}>되돌리기</button>
        </p>
      )}
      <div className="world-card-library">
        <div className="worlds-board">
          <nav className="worlds-cats" aria-label="설정 분류">
            <ul>
              <li><button type="button" aria-current={board.kind || board.todo ? undefined : 'true'} onClick={() => board.pickKind()}>전체 <span>{board.total}</span></button></li>
              {board.counts.map(({ kind, count }) => (
                <li key={kind}><button type="button" aria-current={board.kind === kind ? 'true' : undefined} onClick={() => board.pickKind(kind)}>{kind} <span>{count || '비어 있음'}</span></button></li>
              ))}
              {board.todoCount > 0 && <li><button type="button" aria-current={board.todo ? 'true' : undefined} onClick={board.pickTodo}>보완 필요 <span>{board.todoCount}</span></button></li>}
            </ul>
          </nav>
          <div className="worlds-board-main">
            {emptyType && <div className="world-empty world-board-empty">
              <p role="status">아직 {emptyType.label} 설정이 없어요.</p>
              <button type="button" className="btn pri sm" onClick={addFirstCard}>+ {emptyType.label} 설정 추가</button>
            </div>}
            <div className="worlds-board-tools world-compact">
              {!emptyType && <>
                <label className="worlds-search">
                  <span className="sr-only">설정 검색</span>
                  <input ref={search} type="search" className="inp" placeholder="제목·본문·태그 검색" value={vm.cardQuery} onChange={(e) => { vm.setCardQuery(e.target.value); board.setPage(0) }} />
                </label>
                <label className="worlds-sort">
                  <span>정렬</span>
                  <select className="inp" value={board.sort} onChange={(e) => board.selectSort(e.target.value)}>
                    {BOARD_SORTS.map(([key, label]) => <option key={key} value={key}>{label}</option>)}
                  </select>
                </label>
                {/* 검색·분류·보완 필터가 걸린 동안에만 결과 수를 알린다. */}
                <p className="muted small" role="status">{vm.cardQuery || board.kind || board.todo ? `설정 ${board.rows.length}개` : ''}</p>
              </>}
              <button type="button" className="btn sm" aria-haspopup="dialog" onClick={() => setImporting(true)}>다른 세계관에서 가져오기</button>
              {!emptyType && <NewCardMenu vm={vm} className="world-new-menu" trigger={<><span aria-hidden="true">+</span> 새 설정</>} before={board.reset} />}
            </div>
            {!emptyType && <details className="world-bulk" open={bulkOpen} onToggle={(e) => setBulkOpen(e.currentTarget.open)}>
              <summary>공개 범위 한 번에 바꾸기</summary>
              <div className="world-bulk-body">
                <p className="small muted">작가 전용 설정은 독자에게 보이지 않아요. 저장 후 확정 버전을 남겨야 반영돼요.</p>
                <span className="small" role="status">{done?.settings === world.settings ? done.text : selectionText}</span>
                {done?.settings === world.settings && <span className="small">{selectionText}</span>}
                {linked && (
                  <>
                    <label className="world-reveal">
                      일괄 공개 회차
                      <input type="text" inputMode="numeric" pattern="[0-9]*" autoComplete="off" className="inp" aria-invalid={episode === undefined} aria-describedby={episode === undefined ? `${episodeId}-error` : undefined} value={episodeText} onChange={(e) => setEpisodeText(e.target.value.replace(/\D/g, ''))} />
                      화부터 공개
                    </label>
                    {episode === undefined && <p id={`${episodeId}-error`} role="alert" className="small world-field-error">{REVEAL_EPISODE_ERROR}</p>}
                  </>
                )}
                <button type="button" className="btn sm" disabled={!picked.length || episode === undefined} onClick={() => change(true)}>선택 공개</button>
                <button type="button" className="btn sm" disabled={!picked.length} onClick={() => change(false)}>선택 비공개</button>
                <button type="button" className="btn sm" disabled={allPublic === world.settings} onClick={publishAll}>전체 공개</button>
              </div>
            </details>}
            {!emptyType && <div className="world-board-scroll">
              <table className="worlds-board-table">
                <caption className="sr-only">설정 카드 목록</caption>
                <thead>
                  <tr>
                    <th scope="col" className="col-pick"><label className="world-pick"><input ref={head} type="checkbox" disabled={!board.paged.items.length} checked={board.paged.items.length > 0 && visiblePicked === board.paged.items.length} onChange={(e) => { const on = e.target.checked; select((current) => { const next = new Set(current); for (const row of board.paged.items) { if (on) next.add(row.cardId); else next.delete(row.cardId) } return next }, on) }} /><span className="sr-only">보이는 설정 모두 선택</span></label></th>
                    <th scope="col" className="col-no">번호</th><th scope="col" className="col-kind">분류</th><th scope="col" className="col-title">제목</th><th scope="col" className="col-status">상태</th>
                    <th scope="col" className="col-sum">요약</th><th scope="col" className="col-vis">공개</th><th scope="col" className="col-num">연결</th>
                  </tr>
                </thead>
                <tbody ref={table}>
                  {board.paged.items.map((row) => {
                    const previewId = `${previewBase}-${row.cardId}`
                    return (
                      <Fragment key={row.cardId}>
                        <Row row={row} setting={byId.get(row.cardId)} status={board.statuses.get(row.cardId)} images={vm.cardImages} picked={selected.has(row.cardId)} linked={linked} previewing={preview === row.cardId} previewId={previewId} onPick={pick} onOpen={vm.editCard} onToggle={toggle} />
                        {preview === row.cardId && <RowPreview id={previewId} row={row} setting={byId.get(row.cardId)} settings={world.settings} linked={linked} publicPath={vm.publicHref && reveal(row.cardId) !== undefined ? cardPath(world.id, row.cardId) : null} images={vm.cardImages} onOpen={openFromPreview} onClose={() => closePreview(row.cardId)} />}
                      </Fragment>
                    )
                  })}
                  {!board.rows.length && <tr><td colSpan={8} className="muted">{board.total ? '조건에 맞는 설정이 없어요.' : '설정을 추가해 시작해 보세요.'}</td></tr>}
                </tbody>
              </table>
              <PageControls page={board.paged.page} pages={board.paged.pages} onPage={board.setPage} />
            </div>}
          </div>
        </div>
        {!!legacy.length && (
          <details className="world-legacy-list">
            <summary>기존 설정·관계 {legacy.length}개</summary>
            <nav aria-label="기존 설정과 관계">
              {legacyItems.items.map((s) => <button type="button" data-card={s.item.id} key={s.item.id} onClick={() => vm.editCard(s.item.id)}>{s.item.title || '이름 없는 설정'}<small>{labelOf(s)}</small></button>)}
            </nav>
            <PageControls page={legacyItems.page} pages={legacyItems.pages} onPage={setLegacyPage} />
          </details>
        )}
      </div>
      {importing && <WorldImportSheet vm={vm} onClose={() => setImporting(false)} onImported={board.reset} />}
    </fieldset>
  )
}

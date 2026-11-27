import { Suspense, useEffect, useId, useRef, useState } from 'react'

import { presentationPortrait } from '../../../../app/presentationPortraits'
import { categoryChoices, categoryIcon, categoryName } from '../../../../domain/entities/cardCategory'
import { cardTypeOf, isCard, settingAreas, type CardType } from '../../../../domain/entities/studioCards'
import { identityBodyOf, relationDefinitions } from '../../../../domain/entities/studioRelations'
import { cardRevealEpisode, invalidReveal, REVEAL_EPISODE_ERROR, studioLabelCleanup, type SettingItem } from '../../../../domain/entities/studioWorld'
import { newRevealBeyondNovel, revealEpisodeInput } from '../../../../domain/entities/worldStudioWriting'
import { BackChev, ComposeIcon, MoreVerticalIcon } from '../../../shared/icons'
import { LazyMarkdownEditor } from '../../../shared/LazyMarkdownEditor'
import { McpChangeBanner, type McpChangeState } from '../../../shared/McpChangeBanner'
import { PopMenu } from '../../../shared/PopMenu'
import { ThemeButton } from '../../../shared/shell/ThemeButton'
import { ScreenTour, type TourStep } from '../../../shared/tour/ScreenTour'
import { VersionGraph } from '../../studio/view/VersionGraph'
import '../../studio/view/writing.css'
import { revealBadge, setCardReveal } from '../viewmodel/cardVisibility'
import { importedSource } from '../../../shared/importCards'
import { cardRelationEntries } from '../viewmodel/cardRelationEntries'
import { paneBadges } from '../viewmodel/cardPanels'
import { KNOWLEDGE_KINDS } from '../viewmodel/relationView'
import { kinds, labelOf } from '../viewmodel/settingBoard'
import { kindOf } from '../../../shared/worldBoard'
import { useCardBoard } from '../viewmodel/useCardBoard'
import { CardRelationMap } from '../../../shared/CardRelationMap'
import { PageControls } from '../../../shared/PageControls'
import { pageItems } from '../../../shared/pageItems'
import { useCharacterDocs } from '../viewmodel/useCharacterDocs'
import type { useWorldRevisions } from '../viewmodel/useWorldRevisions'
import type { useWorldStudioViewModel } from '../viewmodel/useWorldStudioViewModel'
import { worldVersionRows } from '../viewmodel/worldVersionGraph'
import { CardActivityBar } from './CardActivityBar'
import { CardCategoryNotice } from './CardCategoryNotice'
import { CardDeletionConfirm } from './CardDeletionConfirm'
import { CardImageControl, CardThumb } from './WorldCardImage'
import { WorldCardAttachments } from './WorldCardAttachments'
import { CharacterDocs } from './CharacterDocs'
import { NewCardMenu } from './NewCardMenu'
import { WorldCardFindings } from './WorldCardFindings'
import { WorldCardOrder } from './WorldCardOrder'
import { useWorldChatPage } from '../viewmodel/useWorldChatPage'
import { MANAGE_VIEWS } from '../viewmodel/worldStudioFlow'
import { WorldChat } from './WorldChat'
import { WorldSaveBar } from './WorldSaveBar'

type VM = ReturnType<typeof useWorldStudioViewModel>

// 사용법 투어(#971): 설정 카드 작성의 차별점만 한 문장씩. 대상은 활동 막대의 탭 아이콘(data-tour="card-<화면>")이라 어느 화면에 있어도 보인다. 이 화면은 카드를 골라야 열려 대상이 늘 있다.
const tour: TourStep[] = [
  { target: 'card-overview', title: '공개 범위', text: '카드는 작가만 보는 게 기본이고, 소설을 연결한 세계관에서는 개요에서 몇 화부터 보일지 정해요.' },
  { target: 'card-order', title: '공개 순서', text: '카드 글에 그 글이 보일 때 아직 공개되지 않은 설정의 이름이 나오면 스포일러일 수 있어 알려 주고, 저장은 막지 않아요.' },
  { target: 'card-relations', title: '사건 시점·연관 설정', text: '사건 카드에 적은 시점과 연관 설정은 시간선에, 카드의 관계는 관계도에 나타나요.' },
]

const BODY_MAX = 3000

/**
 * 설정 카드 편집 화면(주소 `?card=<id>`): 집필실(`WritingStudio`)과 같은 3단 인터페이스다. 집필실의 클래스·`VersionGraph`·`PopMenu`·AI 채팅 레일을 그대로 쓰고 세계관 전용 스타일은 최소다.
 * - 왼쪽: 활동 막대(VS Code식 세로 아이콘 `CardActivityBar`). 맨 위 목록 아이콘은 설정 카드 목록 패널을 펴고 접는 토글이고(가운데 화면과 따로, 데스크톱은 펼친 채·900px 이하는 접힌 채 시작) 구분선 아래 탭 아이콘 다섯은 가운데 본문 전체를 그 화면으로 바꾼다.
 *   고른 화면은 주소의 `?pane=`이 정본이다(`vm.pane`·`vm.setPane`: 문서가 기본이라 주소에 없고, 바꿀 때 기록을 쌓지 않는다). 배지는 관계 수·확정 버전 수(저장하지 않은 변경이 있으면 점)·공개 순서 문제 수다(`paneBadges`).
 *   · 설정 카드 목록 패널: 카드 목록(검색·분류 필터, 지금 카드 강조, 눌러서 다른 카드로, `+ 새 설정`, 항목 ⋮ 메뉴의 삭제)과 메모·분류 확인 같은 기존 항목(기존 관계는 섞지 않는다. 쪽 이동 둘은 `설정 카드`·`기존 항목`으로 이름이 다르다).
 *   · 개요: 대표 이미지 타일(`CardImageControl`)·유형(+가져온 출처)·공개 범위(DEC-53)·설정 영역·내 분류·별칭·태그. 문서: 설명 편집기와 상세 설정(사건 시점·기존 관계 유형). 관계: 관계도와 관계 종류별 묶음 목록(`알고 있음 (23)` 같은 조용한 종류는 기본 접힘)·`관계 편집`.
 *   · 버전: 버전 그래프(작업 초안 + 확정 버전, 확정 버전을 누르면 읽기 전용 시트). 확정 버전 목록·시트는 설정집 화면의 `확정 버전 남기기`와 같은 것이라 페이지가 갖고 `revisions`·`openVersions`로 넘긴다. 공개 순서: '공개 순서 확인'(같은 카드 이름이 되풀이되는 경고는 카드별 한 줄, 펼치면 경고마다).
 * - 가운데: 머리는 이름 입력 하나(모든 화면 위에 고정, 개요는 큰 제목·나머지는 작은 제목이고 공개 순서 문제가 있을 때만 이름 아래 `공개 순서 확인 N` 배지가 공개 순서 화면으로 간다) 아래에 고른 화면(탭 패널): 문서는 설명(마크다운 편집기 `MarkdownEditor`: Toast UI Editor, 쓰기·미리보기 탭, 편집 화면에서만 `React.lazy`로 늦게 불러온다) 등 기존 필드 · 한 줄 하단 바(글자 수·저장 상태·카드 삭제). 위 상단 바에는 `← 설정집`(들어온 보기의 이름: 관계도·시간선 같은 보기에서 열었으면 그 이름)과 상시 저장 영역, 사용법 버튼(작가 도구 투어, #971), 그 옆 끝에 테마 전환 버튼이 있다(집필실처럼 떠 있는 테마 버튼은 GlobalChrome이 이 화면에서 뺀다).
 *   설명은 마크다운 문자열 그대로 저장한다(`#`·`##`·`###` 제목이 공개 카드 페이지의 문단·목차가 된다). 편집기는 글자 수 제한이 없어 3000자를 넘으면 글자 수가 경고로 바뀌고 저장은 기존 검증이 막는다.
 *   글자 수 줄은 입력마다 바뀌므로 라이브 영역에 두지 않고, 3000자를 넘는 순간만 따로 둔 상태 문구로 한 번 알린다.
 *   저장 중에는 편집기를 `inert`로 잠가(글자 입력은 `fieldset disabled`가 닿지 않는다) 그사이 입력이 초안과 어긋나지 않게 한다. 편집기는 처음 값만 읽으므로 `key`로 카드마다(인물 카드는 문서마다), 그리고 초안을 서버 값으로 다시 읽을 때마다(`vm.relationKey`: 다른 곳(MCP)에서 바뀐 알림의 `refresh`·확정 버전 되돌리기) 다시 만든다.
 *   인물 카드는 설명 하나 대신 문서 네 종류로 쓴다(`CharacterDocs`·`useCharacterDocs`): 설명 자리에 문서 탭 줄(정체성 IDENTITY.md = 카드 본문 · 성격·말투 SOUL.md · '목표 · 선택' GOAL.md · 회차 기억 memory/NN회차.md)과 고른 문서의 같은 편집기를 두고,
 *   글자 수·3,000자 초과 알림은 고른 문서의 것이다. 인물이 아닌 유형으로 바꾼 카드에 문서가 남아 있으면 저장하지 않는다고 알린다(인물로 되돌리면 그대로다).
 *   개요 화면의 공개 범위(DEC-53): 소설이 연결된 세계관은 `공개 회차 N화부터 공개`(비우면 작가 전용, 기본)이다. 연결된 소설에 없는 회차는 정할 수 없다(결정 5): 소설의 마지막 회차(`vm.episodeLimit`)를 넘는 새 값은 `이 소설은 N화까지 있어요.`로 알리고(`role="alert"`·`aria-invalid`) 저장을 막으며(저장된 값은 오류도 저장 잠금도 없이 배지 `작가 전용 · N화는 아직 없어요`로만 보인다), 소설에 회차가 없으면 입력 없이 `회차를 쓰면 공개 회차를 정할 수 있어요.`만 보인다(회차 수를 읽기 전에 정한 새 값이 남아 있으면 그 이유(`role="alert"`)와 `작가 전용으로 바꾸기`가 함께 보여 지울 수 있다).
 *   소설이 연결되지 않은 세계관은 지우지 않은 카드가 모두 공개라 공개 설정을 할 수 없다(저장된 값은 지우지 않고 무시한다, DEC-53 보완): 배지 `공개`와 읽기 전용 안내만 보인다.
 *   회차 입력은 숫자만 받는 글자 칸이다(`type="number"`는 휠·스핀 버튼으로 값이 바뀌고 `e` 같은 글자를 받으면 보이는 값과 초안이 어긋난다). 0처럼 쓸 수 없는 값은 입력 바로 아래에 이유를 글로 보이고 입력의 설명으로 잇는다.
 *   바꾸면 `revealFromEpisode`만 정하고 `visibility`는 회차가 있으면 public, 없으면 지워 맞춘다(`setCardReveal`). 건드리지 않은 카드는 다시 쓰지 않는다(옛 공개 카드는 1화로 보인다).
 *   초안 값이라 저장과 확정 버전을 거쳐야 반영된다. 다른 세계관에서 가져온 카드는 유형 옆에 `가져옴`과 출처를 보인다.
 *   마지막 설정집 AI 검토가 이 카드에 지적을 남겼으면 편집기 맨 위에 'AI 검토 의견'(`WorldCardFindings`)이 보이고, 수정안을 `초안에 반영`하면 편집기를 지금 초안의 글로 다시 만든다(`docs.reload`).
 *   이 카드의 글에 더 늦게 공개되는 카드의 이름이 나오면 공개 순서 화면의 '공개 순서 확인'(`WorldCardOrder`, DEC-53)이 어느 글에 어떤 이름이 나오는지 알린다(모델 없이 초안에서 계산하며 저장·확정을 막지 않는다). 문제가 없으면 공개 범위 칸에 한 줄 '공개 순서 문제 없음'만 있다.
 *   카드 본문(인물은 IDENTITY.md) 편집기에는 `설정 링크` 버튼이 있어 같은 세계관 카드를 이름·별칭으로 찾아 `[글자](card:<id>)`를 커서 위치에 넣고, 미리보기의 링크를 누르면 그 카드의 편집 화면으로 간다. 관계 화면의 목록에는 본문 링크로 이어진 카드도 들어간다.
 * - 오른쪽: AI 채팅(전송은 연결 전이라 '준비 중').
 * 삭제는 초안 변경이라 확인(함께 지워질 관계 수)을 거친 뒤 설정집으로 돌아가고 되돌릴 수 있으며, 세계관 저장으로 서버에 반영한다.
 * 관계 기준 회차를 고른 동안(`vm.deleteLock`)은 삭제가 최신 저장에서만 되므로 하단 삭제와 설정 카드 목록 패널의 ⋮ 삭제를 잠그고 이유를 하단에 보인다(잠긴 메뉴 항목의 설명도 같은 글).
 */
export function WorldCardStudio({ vm, mcp, revisions, openVersions, chatOpen, onChatOpenChange, previewFirst = false }: { vm: VM; mcp: McpChangeState; revisions: ReturnType<typeof useWorldRevisions>; openVersions: () => void; chatOpen: boolean; onChatOpenChange: (open: boolean) => void; previewFirst?: boolean }) {
  const world = vm.editing!
  const setting = world.settings.find((s) => s.item.id === vm.selected)!
  const { item } = setting
  const board = useCardBoard(vm)
  // 유형 선택지·이름은 운영자가 관리하는 카드 카테고리다. 이미 쓰는 숨긴 카테고리는 그대로 남는다(새로 고를 수는 없다).
  // 목록을 읽는 동안·읽지 못했을 때는 기본 8종으로 대신하지 않고 선택을 잠근다(실패는 아래에서 다시 시도로 알린다). 목록은 게시판 훅과 같은 읽기 결과다.
  const { categories, isLoading, isError, retry } = board.cardCategories
  const typeChoices = categoryChoices(categories ?? [], cardTypeOf(item))
  const pane = vm.pane // 활동 막대에서 고른 본문 화면(개요·문서·관계·버전·공개 순서): 주소의 pane이 정본이다
  const [listOpen, setListOpen] = useState(() => window.matchMedia?.('(min-width: 901px)').matches ?? true) // 설정 카드 목록 패널: 데스크톱은 펼친 채, 좁은 화면은 접힌 채 시작한다
  const [confirm, setConfirm] = useState('') // 삭제를 확인 중인 카드 id
  const listId = useId()
  const deleteReason = `${listId}-delete-lock`
  const paneId = listId + '-pane'
  const panelId = listId + '-panel'
  const demo = import.meta.env.MODE === 'mockup'
  const nameField = useRef<HTMLInputElement>(null)
  // 편집 화면에 들어올 때와 레일에서 새 설정을 더했을 때만 이름 입력으로 초점을 옮긴다(레일에서 카드를 옮길 때는 목록의 초점을 지킨다).
  const focusName = useRef(true)
  useEffect(() => {
    if (!focusName.current) return
    focusName.current = false
    nameField.current?.focus()
  }, [item.id])
  // 레일의 '기존 항목'은 메모·분류 확인뿐이다: 기존 관계는 수백 개가 카드 아래에 섞여 쪽만 늘리므로 뺀다(관계도의 목록·게시판의 접힌 목록에서 계속 연다). 지금 열려 있는 항목은 어느 것이든 남겨 위치를 보인다.
  const legacy = world.settings.filter((s) => ['review', 'note'].includes(cardTypeOf(s.item)) || (s.item.id === item.id && cardTypeOf(s.item) === 'relation'))
  const [legacyPage, setLegacyPage] = useState(0)
  const legacyItems = pageItems(legacy, legacyPage, 50)
  const entries = cardRelationEntries(world.settings, item.id)
  const relationCount = entries.filter((e) => !e.id.startsWith('link:')).length
  // 설정 링크(DEC-53)로 고를 수 있는 같은 세계관의 카드(편집 중인 카드와 카드가 아닌 기존 항목은 뺀다)와 이 카드에서 나온 공개 순서 경고
  const linkChoices = world.settings.flatMap((s) => (s.item.id !== item.id && isCard(s.item) ? [{ id: s.item.id, title: s.item.title || '이름 없는 설정', type: labelOf(s, categories), aliases: s.aliases }] : []))
  const orderIssues = board.orderIssues.filter((issue) => issue.cardId === item.id)
  const badges = paneBadges({ relations: relationCount, versions: revisions.rows.length, dirty: vm.dirty, issues: orderIssues.length })
  const openLinked = (id: string) => { setConfirm(''); focusName.current = true; vm.editCard(id) }
  const identityBody = identityBodyOf(world.settings, item.id) // 이 카드가 「동일 인물」의 다른 이름 카드면 그 본체 카드(#485)
  const docs = useCharacterDocs(vm, setting) // 편집 중인 글: 인물 카드는 고른 문서, 그 밖은 카드 본문
  const chatPage = useWorldChatPage(vm, docs.doc) // AI 채팅이 싣는 저장하지 않은 편집 내용도 고른 문서의 글이다(#638)
  // 게시판 미리보기의 `수정하기`로 들어왔으면(previewFirst) 그때 처음 만들어지는 편집기만 미리보기 탭으로 연다: 원문 링크 `[글자](card:<id>)`가 먼저 보이지 않게. 같은 카드의 다른 문서·레일의 다른 카드·새 설정은 쓰는 중이라 쓰기 탭이다. 이 화면을 나가면 잊는다.
  const editorKey = `${docs.editorKey}:${vm.relationKey}`
  const [entryKey, setEntryKey] = useState(() => (previewFirst ? editorKey : ''))
  useEffect(() => { if (entryKey && entryKey !== editorKey) setEntryKey('') }, [entryKey, editorKey]) // 다른 문서·카드로 옮기면 잊는다: 돌아와도 이미 쓰기 시작한 화면이라 쓰기 탭이다
  const over = docs.text.length > BODY_MAX
  const linked = !!vm.linkedWorkId
  const limit = vm.episodeLimit // 연결된 소설의 마지막 회차(결정 5): 회차 수를 읽는 중·실패면 undefined라 상한을 보지 않는다
  const reveal = cardRevealEpisode(setting)
  // 상한 초과 오류는 사용자가 이 카드의 공개 회차를 새로 정한 때만 보인다(저장 잠금과 같은 규칙, `newRevealBeyondNovel`). 손대지 않은 저장값은 배지의 '작가 전용 · N화는 아직 없어요'만 알린다.
  const revealError = invalidReveal(setting) ? REVEAL_EPISODE_ERROR : newRevealBeyondNovel(vm.saved ?? undefined, limit)(setting)
  const reachBadge = revealBadge(reveal, linked, limit) // 공개 안내는 이 배지 한 곳과 관계도의 회차 탭에 모은다
  const unlinkedHelp = demo ? '데모에서는 소설 연결을 지원하지 않아 모든 설정이 공개돼요.' : '소설을 연결하기 전에는 모든 설정이 공개돼요. 소설을 연결하면 설정마다 N화부터 공개를 정할 수 있어요.'
  const portrait = cardTypeOf(item) === 'character' ? presentationPortrait(item.title) : undefined
  const deletion = confirm === item.id ? vm.cardDeletionInfo(item.id) : null
  const bodyEditor = (
    <div className="world-card-editor" inert={vm.busy}>
      <Suspense fallback={<div className="world-card-editor-loading" aria-live="polite">편집기를 불러오고 있어요.</div>}>
        <LazyMarkdownEditor key={editorKey} startTab={entryKey === editorKey ? 'preview' : undefined} label={docs.person ? docs.name : '설정 본문'} initialValue={docs.text} placeholder={docs.person ? undefined : '어떤 인물인가요? 무엇이 중요한 장소인가요? 떠오르는 내용을 자유롭게 적어 보세요.'} onChange={docs.write} cardLinks={docs.doc === 'identity' ? { cards: linkChoices, open: openLinked } : undefined} />
      </Suspense>
    </div>
  )
  const imageOf = new Map(world.settings.map((s) => [s.item.id, s.imageId]))
  const reviewIds = new Set(world.settings.flatMap((s) => (s.needsReview ? [s.item.id] : [])))
  const rail = (id: string, title: string, sub: string) => {
    const on = id === item.id, review = reviewIds.has(id)
    return (
      <div className="writing-episode-row" key={id}>
        <button type="button" className={`writing-episode${on ? ' on' : ''}`} aria-pressed={on} aria-label={`${title} ${sub}${review ? ' 확인 필요' : ''}`} disabled={vm.busy} onClick={() => { setConfirm(''); if (!on) vm.editCard(id) }}>
          <CardThumb images={vm.cardImages} imageId={imageOf.get(id)} />
          <strong>{title}</strong><small>{sub}{review && <span className="world-review-flag">확인 필요</span>}</small>
        </button>
        {/* 항목마다 그 카드를 대상으로 하는 메뉴. 카드를 먼저 연 뒤 같은 삭제 확인을 보인다. */}
        <PopMenu className="writing-episode-more" label={`${title} 더보기`} icon={<MoreVerticalIcon />}>
          <button type="button" role="menuitem" className="danger" disabled={vm.busy || !!vm.deleteLock} aria-describedby={vm.deleteLock ? deleteReason : undefined} onClick={() => { if (!on) vm.editCard(id); setConfirm(id) }}>삭제</button>
        </PopMenu>
      </div>
    )
  }
  return (
    <div className="calm rd studio writing-studio world-card-studio" data-pane={pane} data-list={listOpen ? 'open' : 'closed'}>
      <header className="sbar">
        <div className="writing-bar">
          <button type="button" className="back rback" onClick={vm.closeCard}><BackChev />{MANAGE_VIEWS.find(([id]) => id === vm.view)?.[1]}</button>
          <h1 className="t">설정 편집</h1>
        </div>
        <div className="writing-bar writing-bar-end"><WorldSaveBar vm={vm} /><ScreenTour screen="card" steps={tour} className="btn sm" /><ThemeButton className="btn sm" /></div>
      </header>
      {vm.error && <p role="alert" className="ep-alert">{vm.error}</p>}
      {vm.message && <p role="status" className="writing-message">{vm.message}</p>}
      <McpChangeBanner {...mcp} />
      <main id="main" tabIndex={-1} className="studio-workspace">
        <div className="sgrid writing-grid">
          <div className="world-card-side">
            <CardActivityBar pane={pane} paneId={paneId} badges={badges} onPane={vm.setPane} listOpen={listOpen} listId={panelId} onList={() => setListOpen(!listOpen)} />
            {listOpen && (
              <div id={panelId} className="writing-rail world-panel">
                <div className="writing-rail-head">
                  <h2>설정 카드</h2>
                  <NewCardMenu vm={vm} className="world-rail-new" trigger={<ComposeIcon />} before={() => { board.reset(); focusName.current = true }} />
                </div>
                <div className="world-rail-tools">
                  <label className="sr-only" htmlFor={`${listId}-q`}>설정 검색</label>
                  <input id={`${listId}-q`} type="search" className="inp" placeholder="설정 검색" value={vm.cardQuery} onChange={(e) => { vm.setCardQuery(e.target.value); board.setPage(0) }} />
                  <div className="world-rail-kinds" role="group" aria-label="설정 분류">
                    <button type="button" aria-pressed={!board.kind} onClick={() => board.pickKind()}>전체</button>
                    {board.counts.map(({ kind, count }) => <button key={kind} type="button" aria-pressed={board.kind === kind} onClick={() => board.pickKind(kind)}>{kind} {count}</button>)}
                  </div>
                </div>
                <div className="writing-rail-split">
                  <nav id={listId} className="seps writing-episodes" aria-label="설정 카드 목록">
                    {board.paged.items.map((row) => rail(row.cardId, row.title, row.type))}
                    {legacyItems.items.map((s) => rail(s.item.id, s.item.title || '이름 없는 설정', labelOf(s, categories)))}
                    {!board.rows.length && !legacy.length && <p className="small muted world-rail-empty">조건에 맞는 설정이 없어요.</p>}
                  </nav>
                  <PageControls label="설정 카드" page={board.paged.page} pages={board.paged.pages} onPage={board.setPage} />
                  <PageControls label="기존 항목" page={legacyItems.page} pages={legacyItems.pages} onPage={setLegacyPage} />
                </div>
              </div>
            )}
          </div>
          <div className="editor writing-editor" role="region" aria-label="선택한 설정 편집">
            <WorldCardFindings key={item.id} vm={vm} cardId={item.id} onOpenCard={openLinked} onApplied={docs.reload} />
            <fieldset className="world-fields" disabled={vm.busy}>
              <legend className="sr-only">설정 카드 작성</legend>
              {/* Chromium: fieldset의 직접 자식이 바뀌면(인물 ↔ 그 밖의 문서 구조, 편집기 교체) 같은 fieldset 안 컨테이너 쿼리 컨테이너(.world-card-header)의 하위가 레이아웃에서 빠져 머리가 0×0이 된다(#466). 내용은 이 래퍼 하나 안에서만 바뀌게 하고 래퍼에 key를 주지 않는다. */}
              <div>
                <div className="world-card-header">
                  <input ref={nameField} className="et writing-title" aria-label="설정 이름" required value={item.title} maxLength={200} placeholder="이 설정의 이름은 무엇인가요?" onChange={(e) => vm.update(item.id, { title: e.target.value })} />
                  {orderIssues.length > 0 && <button type="button" className="chip wait world-order-badge" onClick={() => vm.setPane('order')}>공개 순서 확인 {orderIssues.length}</button>}
                </div>
                <div id={paneId} role="tabpanel" aria-labelledby={paneId + '-tab-' + pane} className="world-pane">
                  {pane === 'overview' && (
                    <div className="world-overview">
                      <CardImageControl vm={vm} cardId={item.id} title={item.title} imageId={setting.imageId} portrait={portrait} />
                      <div className="world-overview-fields">
                        <label className="field world-type">유형
                          <select className="inp" value={cardTypeOf(item)} disabled={!categories} onChange={(e) => vm.changeCardType(item.id, e.target.value as CardType)}>
                            {typeChoices.map((c) => <option key={c.code} value={c.code}>{categoryIcon(c)}</option>)}
                            {isCard(item) && !typeChoices.some((c) => c.code === cardTypeOf(item)) && <option value={cardTypeOf(item)}>{categoryName(categories ?? [], cardTypeOf(item)) + (isLoading ? ' · 불러오는 중…' : '')}</option>}
                            {['relation', 'review', 'note'].includes(cardTypeOf(item)) && <option value={cardTypeOf(item)}>{kinds[item.kind]} · 기존 의미 유지</option>}
                          </select>
                        </label>
                        <CardCategoryNotice isError={isError} retry={retry} />
                        {setting.importedFrom && <p className="small muted world-card-source"><span className="chip">가져옴</span>{importedSource(setting.importedFrom)}</p>}
                        {item.kind !== 'relation' && (
                          <section className="world-card-reach" aria-label="공개 범위">
                            <h4>공개 범위 <span className="chip world-reach-badge">{reachBadge}</span></h4>
                            {linked ? (
                              <>
                                {limit === 0 ? (
                                  <>
                                    <p className="small muted">회차를 쓰면 공개 회차를 정할 수 있어요.</p>
                                    {/* 회차 수를 읽기 전에 정한 새 값이 남아 있으면 입력칸이 없어도 그 이유를 알리고 지울 수 있게 한다(아니면 저장이 잠긴 채 고칠 방법이 없다). */}
                                    {revealError && (
                                      <>
                                        <p role="alert" className="small world-field-error">{revealError}</p>
                                        <button type="button" className="btn sm" onClick={() => vm.patch({ settings: setCardReveal(world.settings, new Set([item.id]), undefined) })}>작가 전용으로 바꾸기</button>
                                      </>
                                    )}
                                  </>
                                ) : (
                                  <>
                                    <label className="world-reveal">
                                      공개 회차
                                      <input type="text" inputMode="numeric" pattern="[0-9]*" autoComplete="off" className="inp" aria-invalid={revealError !== ''} aria-describedby={`${revealError ? `${listId}-reveal-error ` : ''}${listId}-reveal`} value={reveal ?? ''} onChange={(e) => vm.patch({ settings: setCardReveal(world.settings, new Set([item.id]), revealEpisodeInput(e.target.value)) })} />
                                      화부터 공개
                                    </label>
                                    {revealError && <p id={`${listId}-reveal-error`} role="alert" className="small world-field-error">{revealError}</p>}
                                    <p id={`${listId}-reveal`} className="small muted">비워 두면 작가 전용이에요.</p>
                                  </>
                                )}
                                {!orderIssues.length && <p className="small muted">공개 순서 문제 없음</p>}
                                <p className="small muted">저장 후 ‘확정 버전 남기기’를 해야 반영돼요.</p>
                              </>
                            ) : (
                              <p className="small muted">{unlinkedHelp}</p>
                            )}
                          </section>
                        )}
                        <label className="field">설정 영역
                          <select className="inp" value={item.category} onChange={(e) => vm.changeArea(item.id, e.target.value as SettingItem['category'])}>
                            {settingAreas.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}
                          </select>
                        </label>
                        <label className="field">내 분류<input className="inp" value={setting.userCategory} maxLength={50} onChange={(e) => vm.update(item.id, {}, { userCategory: e.target.value })} /></label>
                        <label className="field">별칭<input className="inp" aria-describedby={`${listId}-alias`} value={setting.aliases?.join(',') ?? ''} onChange={(e) => vm.update(item.id, {}, { aliases: e.target.value.split(',') })} onBlur={() => { const aliases = studioLabelCleanup(setting.aliases); if (aliases) vm.update(item.id, {}, { aliases }) }} /></label>
                        <p id={`${listId}-alias`} className="small muted">별칭은 쉼표로 구분하며 저장 시 다른 카드 정보와 함께 서버에 보존해요.</p>
                        <label className="field">태그 (쉼표로 구분)<input className="inp" value={setting.tags.join(',')} onChange={(e) => vm.update(item.id, {}, { tags: e.target.value.split(',') })} onBlur={() => { const tags = studioLabelCleanup(setting.tags); if (tags) vm.update(item.id, {}, { tags }) }} /></label>
                      </div>
                    </div>
                  )}
                  {pane === 'overview' && <WorldCardAttachments vm={vm} cardId={item.id} />}
                  {pane === 'doc' && (
                    <>
                      {docs.orphaned && <p role="status" className="small world-doc-orphaned">인물이 아닌 설정에는 SOUL.md·GOAL.md·회차별 기억을 저장하지 않아요. 유형을 인물로 되돌리면 이어 쓸 수 있고, 이대로 저장하면 사라져요.</p>}
                      {docs.person && identityBody && <p className="small muted world-card-help">이 카드는 {identityBody.item.title}의 다른 이름이에요. 성격·목표·회차 기억은 본체 카드에 적어 주세요. 이 카드의 것은 시뮬레이션에서 읽지 않아요.</p>}
                      {docs.person ? <CharacterDocs docs={docs}>{bodyEditor}</CharacterDocs> : bodyEditor}
                                      {docs.doc === 'identity' && <p className="small muted world-card-help"># · ## · ### 제목은 공개 페이지 목차에 나와요.</p>}
                      {(item.kind === 'event' || item.kind === 'relation') && (
                        <details className="world-additional" key={item.id}>
                          <summary>상세 설정 · 선택</summary>
                          {item.kind === 'event' && <label className="field">사건 시점<input className="inp" value={item.timeText} onChange={(e) => vm.update(item.id, { timeText: e.target.value })} /></label>}
                          {item.kind === 'relation' && (
                            <>
                              <label className="field">기존 관계 유형
                                <select className="inp" value={item.predicate ?? 'trusts'} onChange={(e) => vm.update(item.id, { predicate: e.target.value })}>
                                  {Object.entries(relationDefinitions).map(([id, r]) => <option key={id} value={id}>{r.label}</option>)}
                                </select>
                              </label>
                              {(['subjectId', 'targetId'] as const).map((key, i) => (
                                <label className="field" key={key}>{i ? '관계 대상' : '관계 주체'}
                                  <select className="inp" value={item[key] ?? ''} onChange={(e) => vm.update(item.id, { [key]: e.target.value || null })}>
                                    <option value="">선택하세요</option>
                                    {world.settings.filter((s) => s.item.kind === 'entity').map((s) => <option key={s.item.id} value={s.item.id}>{s.item.title}</option>)}
                                  </select>
                                </label>
                              ))}
                            </>
                          )}
                        </details>
                      )}
                    </>
                  )}
                  {pane === 'relations' && (
                    <>
                      <div className="world-pane-head">
                        <h2>연관 설정·관계 <span className="small muted">관계 {relationCount}</span></h2>
                        <button className="btn sm world-relation-link" type="button" onClick={() => vm.openRelations(item.id)}>관계 편집</button>
                      </div>
                      <section className="world-card-links" aria-label="연관 설정">
                        <CardRelationMap center={{ id: item.id, title: item.title || '이름 없는 설정', kind: kindOf(cardTypeOf(item)) }} badge={reachBadge} entries={entries} revealEpisode={linked ? (reveal ?? null) : null} onOpen={openLinked} emptyAction={<button type="button" className="btn sm" onClick={() => vm.openRelations(item.id)}>관계 추가</button>} quietKinds={KNOWLEDGE_KINDS} />
                      </section>
                    </>
                  )}
                  {pane === 'versions' && (
                    <section className="writing-graph" aria-label="버전 그래프">
                      <h2>버전 그래프</h2>
                      <div className="world-graph-actions">
                        <button type="button" className="btn sm" aria-haspopup="dialog" disabled={!revisions.supported} onClick={openVersions}>확정 버전 남기기</button>
                      </div>
                      <VersionGraph rows={worldVersionRows(revisions.rows, vm.dirty, vm.saved?.currentRevisionId)} selectedId={revisions.detail?.revisionId ?? ''} disabled={revisions.busy} onPick={(id) => { void revisions.open(id); openVersions() }} />
                      <p className="small muted world-graph-note">{revisions.supported ? '관계는 회차별로 기록해요(확정 버전에는 포함되지 않음).' : '목업에서는 확정 버전을 지원하지 않아요. 관계는 현재 상태만 보관해요.'}</p>
                    </section>
                  )}
                  {pane === 'order' && (
                    <>
                      <div className="world-pane-head"><h2>공개 순서</h2></div>
                      {orderIssues.length
                        ? <WorldCardOrder issues={orderIssues} limit={limit} relationTitle={(id) => world.settings.find((s) => s.item.id === id)?.item.title || '이름 없는 관계'} onOpenCard={openLinked} />
                        : <p className="small muted">공개 순서 문제 없음</p>}
                    </>
                  )}
                </div>
              </div>
            </fieldset>
            {deletion && <CardDeletionConfirm deletion={deletion} onDelete={() => { if (vm.deleteCard(item.id)) setConfirm('') }} onCancel={() => setConfirm('')} />}
            <footer className="writing-foot">
              <p className={`small ${over ? 'world-over' : 'muted'}`}>{docs.person && `${docs.name} `}{docs.text.length.toLocaleString('ko-KR')} / {BODY_MAX.toLocaleString('ko-KR')}자{over && ' · 3,000자를 넘으면 저장할 수 없어요'}</p>
              <p role="status" className="sr-only">{over && (docs.person ? `${docs.name}가 3,000자를 넘었어요.` : '설명이 3,000자를 넘었어요.')}</p>
              {vm.deleteLock && <p id={deleteReason} className="small muted">{vm.deleteLock}</p>}
              <div className="writing-foot-actions">
                <button type="button" className="btn sm world-danger" disabled={vm.busy || !!vm.deleteLock} aria-describedby={vm.deleteLock ? deleteReason : undefined} onClick={() => setConfirm(item.id)}>카드 삭제</button>
              </div>
            </footer>
          </div>
        </div>
        <WorldChat variant="writing" open={chatOpen} onOpenChange={onChatOpenChange} linkedWorkId={vm.linkedWorkId} onWorldApplied={() => void vm.aiDraftChanged().then((reread) => { if (reread) docs.reload() })} {...chatPage} />
      </main>
    </div>
  )
}

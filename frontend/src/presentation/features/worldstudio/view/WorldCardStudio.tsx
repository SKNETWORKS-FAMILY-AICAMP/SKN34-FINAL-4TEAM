import { Suspense, useEffect, useId, useRef, useState } from 'react'

import { presentationPortrait } from '../../../../app/presentationPortraits'
import { cardTypeOf, cardTypes, settingAreas, type CardType } from '../../../../domain/entities/studioCards'
import { relationDefinitions } from '../../../../domain/entities/studioRelations'
import { invalidReveal, REVEAL_EPISODE_ERROR, studioLabelCleanup, type SettingItem } from '../../../../domain/entities/studioWorld'
import { revealEpisodeInput } from '../../../../domain/entities/worldStudioWriting'
import { BackChev, ComposeIcon, MoreVerticalIcon } from '../../../shared/icons'
import { LazyMarkdownEditor } from '../../../shared/LazyMarkdownEditor'
import { PopMenu } from '../../../shared/PopMenu'
import { ResizeSeparator } from '../../studio/view/ResizeSeparator'
import { VersionGraph } from '../../studio/view/VersionGraph'
import '../../studio/view/writing.css'
import { setCardVisibility } from '../viewmodel/cardVisibility'
import { importedSource } from '../../../shared/importCards'
import { kinds, labelOf, settingLinks } from '../viewmodel/settingBoard'
import { useCardBoard } from '../viewmodel/useCardBoard'
import { useCharacterDocs } from '../viewmodel/useCharacterDocs'
import type { useWorldRevisions } from '../viewmodel/useWorldRevisions'
import type { useWorldStudioViewModel } from '../viewmodel/useWorldStudioViewModel'
import { worldVersionRows } from '../viewmodel/worldVersionGraph'
import { CardDeletionConfirm } from './CardDeletionConfirm'
import { CharacterDocs } from './CharacterDocs'
import { NewCardMenu } from './NewCardMenu'
import { WorldChat } from './WorldChat'
import { WorldSaveBar } from './WorldSaveBar'

type VM = ReturnType<typeof useWorldStudioViewModel>

const BODY_MAX = 3000

/**
 * 설정 카드 편집 화면(주소 `?card=<id>`): 집필실(`WritingStudio`)과 같은 3단 인터페이스다. 집필실의 클래스·`VersionGraph`·`ResizeSeparator`·`PopMenu`·AI 채팅 레일을 그대로 쓰고 세계관 전용 스타일은 최소다.
 * - 왼쪽 레일: 설정 카드 목록(검색·분류 필터, 지금 카드 강조, 눌러서 다른 카드로, `+ 새 설정`, 항목 ⋮ 메뉴의 삭제) → 크기 조절선 → 버전 그래프(작업 초안 + 확정 버전, 확정 버전을 누르면 읽기 전용 시트).
 *   확정 버전 목록·시트는 설정집 화면의 `확정 버전 남기기`와 같은 것이라 페이지가 갖고 `revisions`·`openVersions`로 넘긴다.
 * - 가운데: 큰 이름 입력 · 유형 · 설명(마크다운 편집기 `MarkdownEditor`: Toast UI Editor, 쓰기·미리보기 탭, 편집 화면에서만 `React.lazy`로 늦게 불러온다) 등 기존 필드 · 한 줄 하단 바(글자 수·저장 상태·삭제). 위 상단 바에는 `← 설정집`과 상시 저장 영역이 있다.
 *   설명은 마크다운 문자열 그대로 저장한다(`## 제목`이 공개 카드 페이지의 문단·목차가 된다). 편집기는 글자 수 제한이 없어 3000자를 넘으면 글자 수가 경고로 바뀌고 저장은 기존 검증이 막는다.
 *   글자 수 줄은 입력마다 바뀌므로 라이브 영역에 두지 않고, 3000자를 넘는 순간만 따로 둔 상태 문구로 한 번 알린다.
 *   저장 중에는 편집기를 `inert`로 잠가(글자 입력은 `fieldset disabled`가 닿지 않는다) 그사이 입력이 초안과 어긋나지 않게 한다. 편집기는 처음 값만 읽으므로 `key`로 카드마다(인물 카드는 문서마다) 다시 만든다.
 *   인물 카드는 설명 하나 대신 문서 네 종류로 쓴다(`CharacterDocs`·`useCharacterDocs`): 설명 자리에 문서 목록(IDENTITY.md = 카드 본문 · SOUL.md · MEMORY.md · memory/NN회차.md)과 고른 문서의 같은 편집기를 두고,
 *   글자 수·3,000자 초과 알림은 고른 문서의 것이다. 인물이 아닌 유형으로 바꾼 카드에 문서가 남아 있으면 저장하지 않는다고 알린다(인물로 되돌리면 그대로다).
 *   설명 아래 공개 범위(DEC-46): `이 설정 공개`(기본 비공개, 공개 세계관 화면에는 공개 카드만 보인다)와 `독자 공개 N화부터`(연결된 소설의 독자 설정 위키에 보이기 시작하는 회차, 비우면 숨김, 소설을 연결해야 켜진다).
 *   회차 입력은 숫자만 받는 글자 칸이다(`type="number"`는 휠·스핀 버튼으로 값이 바뀌고 `e` 같은 글자를 받으면 보이는 값과 초안이 어긋난다). 0처럼 쓸 수 없는 값은 입력 바로 아래에 이유를 글로 보이고 입력의 설명으로 잇는다.
 *   둘 다 초안 값이라 저장과 확정 버전을 거쳐야 반영된다. 다른 세계관에서 가져온 카드는 유형 옆에 `가져옴`과 출처를 보인다.
 * - 오른쪽: AI 채팅(전송은 연결 전이라 '준비 중').
 * 삭제는 초안 변경이라 확인(함께 지워질 관계 수)을 거친 뒤 설정집으로 돌아가고 되돌릴 수 있으며, 세계관 저장으로 서버에 반영한다.
 */
export function WorldCardStudio({ vm, revisions, openVersions, chatOpen, onChatOpenChange }: { vm: VM; revisions: ReturnType<typeof useWorldRevisions>; openVersions: () => void; chatOpen: boolean; onChatOpenChange: (open: boolean) => void }) {
  const world = vm.editing!
  const setting = world.settings.find((s) => s.item.id === vm.selected)!
  const { item } = setting
  const board = useCardBoard(vm)
  const [split, setSplit] = useState(50) // 레일에서 카드 목록이 차지하는 높이 비율(%). 새로 열면 처음으로 돌아온다.
  const [confirm, setConfirm] = useState('') // 삭제를 확인 중인 카드 id
  const listId = useId()
  const demo = import.meta.env.MODE === 'mockup'
  const nameField = useRef<HTMLInputElement>(null)
  // 편집 화면에 들어올 때와 레일에서 새 설정을 더했을 때만 이름 입력으로 초점을 옮긴다(레일에서 카드를 옮길 때는 목록의 초점을 지킨다).
  const focusName = useRef(true)
  useEffect(() => {
    if (!focusName.current) return
    focusName.current = false
    nameField.current?.focus()
  }, [item.id])
  const legacy = world.settings.filter((s) => ['relation', 'review', 'note'].includes(cardTypeOf(s.item)))
  const links = settingLinks(world.settings, item.id)
  const docs = useCharacterDocs(vm, setting) // 편집 중인 글: 인물 카드는 고른 문서, 그 밖은 카드 본문
  const over = docs.text.length > BODY_MAX
  const revealError = invalidReveal(setting)
  const portrait = cardTypeOf(item) === 'character' ? presentationPortrait(item.title) : undefined
  const deletion = confirm === item.id ? vm.cardDeletionInfo(item.id) : null
  const bodyEditor = (
    <div className="world-card-editor" inert={vm.busy}>
      <Suspense fallback={<div className="world-card-editor-loading" aria-live="polite">편집기를 불러오고 있어요.</div>}>
        <LazyMarkdownEditor key={docs.editorKey} label={docs.person ? docs.name : '설정 본문'} initialValue={docs.text} placeholder={docs.person ? undefined : '어떤 인물인가요? 무엇이 중요한 장소인가요? 떠오르는 내용을 자유롭게 적어 보세요.'} onChange={docs.write} />
      </Suspense>
    </div>
  )
  const rail = (id: string, title: string, sub: string) => {
    const on = id === item.id
    return (
      <div className="writing-episode-row" key={id}>
        <button type="button" className={`writing-episode${on ? ' on' : ''}`} aria-pressed={on} aria-label={`${title} ${sub}`} disabled={vm.busy} onClick={() => { setConfirm(''); if (!on) vm.editCard(id) }}>
          <strong>{title}</strong><small>{sub}</small>
        </button>
        {/* 항목마다 그 카드를 대상으로 하는 메뉴. 카드를 먼저 연 뒤 같은 삭제 확인을 보인다. */}
        <PopMenu className="writing-episode-more" label={`${title} 더보기`} icon={<MoreVerticalIcon />}>
          <button type="button" role="menuitem" className="danger" disabled={vm.busy} onClick={() => { if (!on) vm.editCard(id); setConfirm(id) }}>삭제</button>
        </PopMenu>
      </div>
    )
  }
  return (
    <div className="calm rd studio writing-studio world-card-studio">
      <header className="sbar">
        <div className="writing-bar">
          <button type="button" className="back rback" onClick={vm.closeCard}><BackChev />설정집</button>
          <h1 className="t">설정 편집</h1>
        </div>
        <div className="writing-bar writing-bar-end"><WorldSaveBar vm={vm} /></div>
      </header>
      {vm.error && <p role="alert" className="ep-alert">{vm.error}</p>}
      {vm.message && <p role="status" className="writing-message">{vm.message}</p>}
      <main id="main" tabIndex={-1} className="studio-workspace">
        <div className="sgrid writing-grid">
          <div className="writing-rail">
            <div className="writing-rail-head">
              <h2>설정 카드</h2>
              <NewCardMenu vm={vm} className="world-rail-new" trigger={<ComposeIcon />} before={() => { board.reset(); focusName.current = true }} />
            </div>
            <div className="world-rail-tools">
              <label className="sr-only" htmlFor={`${listId}-q`}>설정 검색</label>
              <input id={`${listId}-q`} type="search" className="inp" placeholder="설정 검색" value={vm.cardQuery} onChange={(e) => vm.setCardQuery(e.target.value)} />
              <div className="world-rail-kinds" role="group" aria-label="설정 분류">
                <button type="button" aria-pressed={!board.kind} onClick={() => board.pickKind()}>전체</button>
                {board.counts.map(({ kind, count }) => <button key={kind} type="button" aria-pressed={board.kind === kind} onClick={() => board.pickKind(kind)}>{kind} {count}</button>)}
              </div>
            </div>
            <div className="writing-rail-split">
              <nav id={listId} className="seps writing-episodes" aria-label="설정 카드 목록" style={{ flexBasis: `${split}%` }}>
                {board.rows.map((row) => rail(row.cardId, row.title, row.type))}
                {legacy.map((s) => rail(s.item.id, s.item.title || '이름 없는 설정', labelOf(s)))}
                {!board.rows.length && !legacy.length && <p className="small muted world-rail-empty">조건에 맞는 설정이 없어요.</p>}
              </nav>
              <ResizeSeparator label="설정 카드 목록과 버전 그래프 크기 조절" controls={listId} value={split} min={20} max={80} onChange={setSplit} />
              <section className="writing-graph" aria-label="버전 그래프">
                <h2>버전 그래프</h2>
                <div className="world-graph-actions">
                  <button type="button" className="btn sm" aria-haspopup="dialog" disabled={!revisions.supported} onClick={openVersions}>확정 버전 남기기</button>
                </div>
                <VersionGraph rows={worldVersionRows(revisions.rows, vm.dirty, vm.saved?.currentRevisionId)} selectedId={revisions.detail?.revisionId ?? ''} disabled={revisions.busy} onPick={(id) => { void revisions.open(id); openVersions() }} />
                <p className="small muted world-graph-note">{revisions.supported ? '관계는 현재 상태만 보관해요(버전에 포함되지 않음).' : '목업에서는 확정 버전을 지원하지 않아요. 관계는 현재 상태만 보관해요.'}</p>
              </section>
            </div>
          </div>
          <div className="editor writing-editor" role="region" aria-label="선택한 설정 편집">
            <fieldset className="world-fields" disabled={vm.busy}>
              <legend className="sr-only">설정 카드 작성</legend>
              <input ref={nameField} className="et writing-title" aria-label="설정 이름" required value={item.title} maxLength={200} placeholder="이 설정의 이름은 무엇인가요?" onChange={(e) => vm.update(item.id, { title: e.target.value })} />
              <div className="world-card-meta">
                {portrait && <img src={portrait} alt={`${item.title} 인물 이미지`} width={56} height={56} />}
                <label className="field world-type">유형
                  <select className="inp" value={cardTypeOf(item)} onChange={(e) => vm.changeCardType(item.id, e.target.value as CardType)}>
                    {cardTypes.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
                    {['relation', 'review', 'note'].includes(cardTypeOf(item)) && <option value={cardTypeOf(item)}>{kinds[item.kind]} · 기존 의미 유지</option>}
                  </select>
                </label>
                {setting.importedFrom && <p className="small muted world-card-source"><span className="chip">가져옴</span>{importedSource(setting.importedFrom)}</p>}
              </div>
              {docs.orphaned && <p role="status" className="small world-doc-orphaned">인물이 아닌 설정에는 SOUL.md·MEMORY.md·회차별 기억을 저장하지 않아요. 유형을 인물로 되돌리면 이어 쓸 수 있고, 이대로 저장하면 사라져요.</p>}
              {docs.person ? <CharacterDocs docs={docs}>{bodyEditor}</CharacterDocs> : bodyEditor}
              {docs.doc === 'identity' && <p className="small muted world-card-help">## 제목으로 문단을 나누면 공개 페이지 목차에 나와요.</p>}
              {item.kind !== 'relation' && (
                <section className="world-card-reach" aria-label="공개 범위">
                  <h4>공개 범위</h4>
                  <label className="world-consent">
                    <input type="checkbox" role="switch" checked={setting.visibility === 'public'} aria-describedby={`${listId}-public`} onChange={(e) => vm.patch({ settings: setCardVisibility(world.settings, new Set([item.id]), e.target.checked ? 'public' : 'private') })} />
                    이 설정 공개
                  </label>
                  <p id={`${listId}-public`} className="small muted">세계관을 공개하면 누구나 이 설정을 볼 수 있고, 로그인한 사람은 자기 세계관으로 가져갈 수 있어요.</p>
                  <label className="world-reveal">
                    독자 공개
                    <input type="text" inputMode="numeric" pattern="[0-9]*" autoComplete="off" className="inp" disabled={!vm.linkedWorkId} aria-invalid={revealError} aria-describedby={`${revealError ? `${listId}-reveal-error ` : ''}${listId}-reveal`} value={setting.revealFromEpisode ?? ''} onChange={(e) => vm.update(item.id, {}, { revealFromEpisode: revealEpisodeInput(e.target.value) })} />
                    화부터
                  </label>
                  {revealError && <p id={`${listId}-reveal-error`} role="alert" className="small world-field-error">{REVEAL_EPISODE_ERROR}</p>}
                  <p id={`${listId}-reveal`} className="small muted">{vm.linkedWorkId ? '연결된 소설의 독자 설정 위키에 이 회차부터 보여요. 비워 두면 독자에게 보이지 않아요.' : demo ? '데모에서는 소설 연결을 지원하지 않아 설정할 수 없어요.' : '소설을 연결하면 설정할 수 있어요.'}</p>
                  <p className="small muted">저장한 뒤 ‘확정 버전 남기기’를 해야 공개 세계관 화면과 독자 설정 위키에 반영돼요.</p>
                </section>
              )}
              {cardTypeOf(item) === 'character' && <button className="btn sm world-relation-link" type="button" onClick={() => vm.openRelations(item.id)}>관계 연결로 이동</button>}
              <section className="world-card-links" aria-label="연관 설정">
                <h4>연관 설정·관계 <span className="small muted">읽기 전용</span></h4>
                {links.length
                  ? <ul>{links.map((l) => <li key={`${l.id}:${l.label}`}><button type="button" className="world-card-link" onClick={() => { setConfirm(''); focusName.current = true; vm.editCard(l.id) }}>{l.title} <small>{l.label}</small></button></li>)}</ul>
                  : <p className="small muted">이어진 설정이 없어요. 인물은 관계 연결에서 서로 이을 수 있어요.</p>}
              </section>
              <details className="world-additional" key={item.id}>
                <summary>상세 설정 · 선택</summary>
                <label className="field">설정 영역
                  <select className="inp" value={item.category} onChange={(e) => vm.changeArea(item.id, e.target.value as SettingItem['category'])}>
                    {settingAreas.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}
                  </select>
                </label>
                <label className="field">태그 (쉼표로 구분)<input className="inp" value={setting.tags.join(',')} onChange={(e) => vm.update(item.id, {}, { tags: e.target.value.split(',') })} onBlur={() => { const tags = studioLabelCleanup(setting.tags); if (tags) vm.update(item.id, {}, { tags }) }} /></label>
                <label className="field">별칭<input className="inp" aria-describedby={`${listId}-alias`} value={setting.aliases?.join(',') ?? ''} onChange={(e) => vm.update(item.id, {}, { aliases: e.target.value.split(',') })} onBlur={() => { const aliases = studioLabelCleanup(setting.aliases); if (aliases) vm.update(item.id, {}, { aliases }) }} /></label>
                <p id={`${listId}-alias`} className="small muted">별칭은 쉼표로 구분하며 저장 시 다른 카드 정보와 함께 서버에 보존해요.</p>
                <label className="field">내 분류<input className="inp" value={setting.userCategory} maxLength={50} onChange={(e) => vm.update(item.id, {}, { userCategory: e.target.value })} /></label>
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
                <p className="small muted">이미지 첨부는 이 화면에서 지원하지 않아요.</p>
              </details>
            </fieldset>
            {deletion && <CardDeletionConfirm deletion={deletion} onDelete={() => { if (vm.deleteCard(item.id)) setConfirm('') }} onCancel={() => setConfirm('')} />}
            <footer className="writing-foot">
              <p className={`small ${over ? 'world-over' : 'muted'}`}>{docs.person && `${docs.name} `}{docs.text.length.toLocaleString('ko-KR')} / {BODY_MAX.toLocaleString('ko-KR')}자 · {over ? '3,000자를 넘으면 저장할 수 없어요' : vm.dirty ? '저장 전 수정이 있어요' : '저장된 상태예요'}</p>
              <p role="status" className="sr-only">{over && (docs.person ? `${docs.name}가 3,000자를 넘었어요.` : '설명이 3,000자를 넘었어요.')}</p>
              <div className="writing-foot-actions">
                <button type="button" className="btn sm world-danger" disabled={vm.busy} onClick={() => setConfirm(item.id)}>삭제</button>
              </div>
            </footer>
          </div>
        </div>
        <WorldChat variant="writing" open={chatOpen} onOpenChange={onChatOpenChange} />
      </main>
    </div>
  )
}

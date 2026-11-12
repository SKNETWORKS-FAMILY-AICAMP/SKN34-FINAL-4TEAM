import { useRef } from 'react'

import { presentationPortrait } from '../../../../app/presentationPortraits'
import { cardTypeOf, cardTypes, settingAreas, type CardType } from '../../../../domain/entities/studioCards'
import { relationDefinitions } from '../../../../domain/entities/studioRelations'
import { studioLabelCleanup, type SettingItem, type StudioSetting } from '../../../../domain/entities/studioWorld'
import { KindChip } from '../../../shared/KindChip'
import { BOOK_SORTS, CARD_KIND, type BoardRow } from '../../../shared/worldBoard'
import { kinds, labelOf, settingLinks } from '../viewmodel/settingBoard'
import { useCardBoard } from '../viewmodel/useCardBoard'
import type { useWorldStudioViewModel } from '../viewmodel/useWorldStudioViewModel'

type VM = ReturnType<typeof useWorldStudioViewModel>

function SettingIcon({ setting }: { setting: StudioSetting }) {
  const person = cardTypeOf(setting.item) === 'character'
  return (
    <svg aria-hidden="true" className="world-setting-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
      {person ? <><circle cx="12" cy="8" r="4" /><path d="M4 22v-3a8 8 0 0 1 16 0v3" /></> : <path d="M5 3h10l4 4v14H5zM14 3v5h5M8 12h8M8 16h5" />}
    </svg>
  )
}

/** 게시판 한 줄. 제목 버튼이 선택하는 주 컨트롤이다(줄 전체를 누르게 하지 않는다). 제목 옆 `[n]`은 공개 설정집과 같은 관계·연결 수다. */
function Row({ row, current, note, onSelect }: { row: BoardRow; current: boolean; note?: string; onSelect: (id: string) => void }) {
  return (
    <tr className={current ? 'selected' : undefined}>
      <td className="col-no">{row.no || '–'}</td>
      <td className="col-kind"><KindChip kind={row.kind} label={row.type} /></td>
      <td className="col-title">
        <button type="button" aria-label={`${row.title} ${row.type}`} aria-current={current ? 'true' : undefined} onClick={() => onSelect(row.cardId)}>{row.title}</button>
        {row.badge > 0 && <span className="worlds-badge"><span aria-hidden="true">[{row.badge}]</span><span className="sr-only">{row.kind === '인물' ? '관계' : '연결'} {row.badge}개</span></span>}
        {note && <small className="world-row-note">{note}</small>}
      </td>
      <td className="col-sum">{row.text}</td>
      <td className="col-num">{row.connections}</td>
    </tr>
  )
}

/**
 * 설정 카드 화면(관리 모드의 설정집 탭, 작성 모드의 설정 카드 단계). 공개 세계관의 설정집과 같은 게시판(왼쪽 분류 메뉴, 검색·정렬, 번호·분류·제목[연결 수]·요약·연결 표)에서 카드를 고르고,
 * 고른 카드만 오른쪽 패널에서 같은 편집 필드로 고친다(고르기 전에는 패널이 없어 표가 넓게 보이고, 좁은 화면은 표 아래, 더 좁으면 목록과 패널을 번갈아 보인다). 패널 아래에는 이 카드에 이어진 설정·관계를 읽기 전용으로 요약한다.
 * 카드가 하나도 없으면 안내는 표 안 한 줄뿐이다.
 * 필터 때문에 표에 없는 카드를 편집 중이면 표 맨 위에 그 카드를 따로 보인다.
 */
export function WorldCardBoard({ vm }: { vm: VM }) {
  const world = vm.editing!
  const field = useRef<HTMLInputElement>(null)
  const board = useCardBoard(vm)
  const find = (id: string) => world.settings.find((s) => s.item.id === id)
  const setting = find(vm.selected)
  const legacy = world.settings.filter((s) => ['relation', 'review', 'note'].includes(cardTypeOf(s.item)))
  const outside = setting && !board.rows.some((r) => r.cardId === setting.item.id) ? board.entry(setting.item.id) : undefined
  const links = setting ? settingLinks(world.settings, setting.item.id) : []
  const type = setting && cardTypes.find((t) => t.id === cardTypeOf(setting.item))
  const select = (id: string) => { vm.editCard(id); requestAnimationFrame(() => field.current?.focus()) }
  const add = () => { board.reset(); vm.addCard(vm.newCardType); vm.setCardDetail(true); requestAnimationFrame(() => field.current?.focus()) }
  return (
    <fieldset className="world-fields" disabled={vm.busy}>
      <legend className="sr-only">설정 카드 작성</legend>
      <div className="world-card-intro">
        <p className="muted">인물이나 장소 등 세계의 설정을 자유롭게 작성해 보세요.</p>
        <div className="world-add world-compact">
          <label className="sr-only" htmlFor="new-setting-type">추가할 설정 유형</label>
          <select id="new-setting-type" className="inp" value={vm.newCardType} onChange={(e) => vm.setNewCardType(e.target.value as CardType)}>
            {cardTypes.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
          </select>
          <button type="button" className="btn pri" onClick={add}><span aria-hidden="true">+</span> 새 설정</button>
        </div>
      </div>
      <div className={'world-card-workspace' + (setting ? ' with-editor' : '') + (vm.cardDetail ? ' showing-detail' : '')}>
        <div className="world-card-library">
          <div className="worlds-board">
            <nav className="worlds-cats" aria-label="설정 분류">
              <ul>
                <li><button type="button" aria-current={board.kind ? undefined : 'true'} onClick={() => board.pickKind()}>전체 <span>{board.total}</span></button></li>
                {board.counts.map(({ kind, count }) => (
                  <li key={kind}><button type="button" aria-current={board.kind === kind ? 'true' : undefined} onClick={() => board.pickKind(kind)}>{kind} <span>{count}</span></button></li>
                ))}
              </ul>
            </nav>
            <div className="worlds-board-main">
              <div className="worlds-board-tools world-compact">
                <label className="worlds-search">
                  <span className="sr-only">설정 검색</span>
                  <input type="search" className="inp" placeholder="제목·본문·태그 검색" value={vm.cardQuery} onChange={(e) => board.search(e.target.value)} />
                </label>
                <label className="worlds-sort">
                  <span>정렬</span>
                  <select className="inp" value={board.sort} onChange={(e) => board.selectSort(e.target.value)}>
                    {BOOK_SORTS.map(([key, label]) => <option key={key} value={key}>{label}</option>)}
                  </select>
                </label>
                <p className="muted small" role="status">설정 {board.rows.length}개</p>
              </div>
              <table className="worlds-board-table">
                <caption className="sr-only">설정 카드 목록</caption>
                <thead>
                  <tr>
                    <th scope="col" className="col-no">번호</th><th scope="col" className="col-kind">분류</th><th scope="col" className="col-title">제목</th>
                    <th scope="col" className="col-sum">요약</th><th scope="col" className="col-num">연결</th>
                  </tr>
                </thead>
                <tbody>
                  {outside && <Row row={{ ...outside, no: 0 }} current note="현재 편집 중 · 필터 조건 밖" onSelect={select} />}
                  {board.rows.map((row) => <Row key={row.cardId} row={row} current={setting?.item.id === row.cardId} onSelect={select} />)}
                  {!board.rows.length && <tr><td colSpan={5} className="muted">{board.total ? '조건에 맞는 설정이 없어요.' : '설정을 추가해 시작해 보세요.'}</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
          {!!legacy.length && (
            <details className="world-legacy-list">
              <summary>기존 설정·관계 {legacy.length}개</summary>
              <nav aria-label="기존 설정과 관계">
                {legacy.map((s) => <button type="button" key={s.item.id} onClick={() => select(s.item.id)}>{s.item.title || '이름 없는 설정'}<small>{labelOf(s)}</small></button>)}
              </nav>
            </details>
          )}
        </div>
        {setting
          ? (
            <section className="world-writing-editor tcard" aria-label="선택한 설정 편집">
              <button className="btn sm world-mobile-list" type="button" onClick={() => vm.setCardDetail(false)}>설정 목록으로</button>
              <div className="world-editor-heading">
                {cardTypeOf(setting.item) === 'character' && presentationPortrait(setting.item.title)
                  ? <img src={presentationPortrait(setting.item.title)} alt={`${setting.item.title} 인물 이미지`} width={72} height={72} style={{ objectFit: 'cover', borderRadius: 12 }} />
                  : <SettingIcon setting={setting} />}
                {type ? <KindChip kind={CARD_KIND[type.id]} label={type.label} /> : <span className="chip">{labelOf(setting)}</span>}
              </div>
              <label className="field">설정 이름<input ref={field} className="inp world-name" required value={setting.item.title} maxLength={200} placeholder="이 설정의 이름은 무엇인가요?" onChange={(e) => vm.update(setting.item.id, { title: e.target.value })} /></label>
              <label className="field">설명<textarea className="ta world-natural-input" rows={5} value={setting.item.text} maxLength={3000} placeholder="어떤 인물인가요? 무엇이 중요한 장소인가요? 떠오르는 내용을 자유롭게 적어 보세요." onChange={(e) => vm.update(setting.item.id, { text: e.target.value })} /></label>
              {cardTypeOf(setting.item) === 'character' && <button className="btn sm world-relation-link" type="button" onClick={() => vm.openRelations(setting.item.id)}>관계 연결로 이동</button>}
              <section className="world-card-links" aria-label="연관 설정">
                <h4>연관 설정·관계 <span className="small muted">읽기 전용</span></h4>
                {links.length
                  ? <ul>{links.map((l) => <li key={`${l.id}:${l.label}`}><button type="button" className="world-card-link" onClick={() => select(l.id)}>{l.title} <small>{l.label}</small></button></li>)}</ul>
                  : <p className="small muted">이어진 설정이 없어요. 인물은 관계 연결에서 서로 이을 수 있어요.</p>}
              </section>
              <details className="world-additional" key={setting.item.id}>
                <summary>상세 설정 · 선택</summary>
                <div className="world-form-row">
                  <label className="field">카드 유형
                    <select className="inp" value={cardTypeOf(setting.item)} onChange={(e) => vm.changeCardType(setting.item.id, e.target.value as CardType)}>
                      {cardTypes.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
                      {['relation', 'review', 'note'].includes(cardTypeOf(setting.item)) && <option value={cardTypeOf(setting.item)}>{kinds[setting.item.kind]} · 기존 의미 유지</option>}
                    </select>
                  </label>
                  <label className="field">설정 영역
                    <select className="inp" value={setting.item.category} onChange={(e) => vm.changeArea(setting.item.id, e.target.value as SettingItem['category'])}>
                      {settingAreas.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}
                    </select>
                  </label>
                </div>
                <label className="field">태그 (쉼표로 구분)<input className="inp" value={setting.tags.join(',')} onChange={(e) => vm.update(setting.item.id, {}, { tags: e.target.value.split(',') })} onBlur={() => { const tags = studioLabelCleanup(setting.tags); if (tags) vm.update(setting.item.id, {}, { tags }) }} /></label>
                <label className="field">별칭<input className="inp" value={setting.aliases?.join(',') ?? ''} onChange={(e) => vm.update(setting.item.id, {}, { aliases: e.target.value.split(',') })} onBlur={() => { const aliases = studioLabelCleanup(setting.aliases); if (aliases) vm.update(setting.item.id, {}, { aliases }) }} /></label>
                <p id="world-alias-help" className="small muted">별칭은 쉼표로 구분하며 저장 시 다른 카드 정보와 함께 서버에 보존합니다.</p>
                <label className="field">내 분류<input className="inp" value={setting.userCategory} maxLength={50} onChange={(e) => vm.update(setting.item.id, {}, { userCategory: e.target.value })} /></label>
                {setting.item.kind === 'event' && <label className="field">사건 시점<input className="inp" value={setting.item.timeText} onChange={(e) => vm.update(setting.item.id, { timeText: e.target.value })} /></label>}
                {setting.item.kind === 'relation' && (
                  <>
                    <label className="field">기존 관계 유형
                      <select className="inp" value={setting.item.predicate ?? 'trusts'} onChange={(e) => vm.update(setting.item.id, { predicate: e.target.value })}>
                        {Object.entries(relationDefinitions).map(([id, r]) => <option key={id} value={id}>{r.label}</option>)}
                      </select>
                    </label>
                    {(['subjectId', 'targetId'] as const).map((key, i) => (
                      <label className="field" key={key}>{i ? '관계 대상' : '관계 주체'}
                        <select className="inp" value={setting.item[key] ?? ''} onChange={(e) => vm.update(setting.item.id, { [key]: e.target.value || null })}>
                          <option value="">선택하세요</option>
                          {world.settings.filter((s) => s.item.kind === 'entity').map((s) => <option key={s.item.id} value={s.item.id}>{s.item.title}</option>)}
                        </select>
                      </label>
                    ))}
                  </>
                )}
                <label className="world-consent"><input type="checkbox" role="switch" checked disabled aria-describedby="world-privacy-help" />스포일러 숨기기</label>
                <p id="world-privacy-help" className="small muted">카드는 소유자만 볼 수 있는 비공개 상태로 저장합니다. 발행·공개 및 이미지 첨부는 이 화면에서 지원하지 않습니다.</p>
              </details>
            </section>
          )
          : null}
      </div>
    </fieldset>
  )
}

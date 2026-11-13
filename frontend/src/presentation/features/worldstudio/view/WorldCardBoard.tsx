import { useEffect, useRef, useState } from 'react'

import { missingCharacterDocs } from '../../../../domain/entities/characterDocs'
import { cardTypeOf } from '../../../../domain/entities/studioCards'
import type { CardVisibility, StudioSetting } from '../../../../domain/entities/studioWorld'
import { KindChip } from '../../../shared/KindChip'
import { BOOK_SORTS, type BoardRow } from '../../../shared/worldBoard'
import { publishAllCards, setCardVisibility } from '../viewmodel/cardVisibility'
import { importedSource } from '../../../shared/importCards'
import { labelOf } from '../viewmodel/settingBoard'
import { useCardBoard } from '../viewmodel/useCardBoard'
import type { useWorldStudioViewModel } from '../viewmodel/useWorldStudioViewModel'
import { NewCardMenu } from './NewCardMenu'
import { WorldImportSheet } from './WorldImportSheet'

type VM = ReturnType<typeof useWorldStudioViewModel>

/**
 * 게시판 한 줄. 제목 버튼이 편집 화면을 여는 주 컨트롤이다(줄 전체를 누르게 하지 않는다). 제목 옆 `[n]`은 공개 설정집과 같은 관계·연결 수다.
 * 맨 앞 체크박스는 공개 범위를 한 번에 바꿀 카드를 고르고, `공개` 칸은 그 카드의 공개 범위다. 다른 세계관에서 가져온 카드는 `가져옴`과 출처를 제목 아래에 보인다.
 * 인물 문서(IDENTITY.md·SOUL.md·MEMORY.md) 가운데 비어 있는 것이 있는 인물은 `정리 필요`를 붙여 알린다. 알리기만 하고 이 표시 때문에 저장·확정이 막히지는 않는다.
 * 본문이 좁으면 번호·분류·요약·연결 칸이 숨는다(world-studio.css의 컨테이너 규칙). 그때 분류와 요약을 잃지 않도록 제목 아래 한 줄(`.world-row-sub`)에도 두고, 넓은 본문에서는 CSS가 그 줄을 숨긴다.
 */
function Row({ row, setting, picked, onPick, onOpen }: { row: BoardRow; setting?: StudioSetting; picked: boolean; onPick: (id: string, on: boolean) => void; onOpen: (id: string) => void }) {
  const isPublic = setting?.visibility === 'public'
  return (
    <tr>
      <td className="col-pick"><label className="world-pick"><input type="checkbox" checked={picked} onChange={(e) => onPick(row.cardId, e.target.checked)} /><span className="sr-only">{row.title} 선택</span></label></td>
      <td className="col-no">{row.no || '–'}</td>
      <td className="col-kind"><KindChip kind={row.kind} label={row.type} /></td>
      <td className="col-title">
        <button type="button" data-card={row.cardId} aria-label={`${row.title} ${row.type}`} onClick={() => onOpen(row.cardId)}>{row.title}</button>
        {row.badge > 0 && <span className="worlds-badge"><span aria-hidden="true">[{row.badge}]</span><span className="sr-only">{row.kind === '인물' ? '관계' : '연결'} {row.badge}개</span></span>}
        {setting && missingCharacterDocs(setting).length > 0 && <span className="worlds-badge world-todo">정리 필요</span>}
        {setting?.importedFrom && <><span className="worlds-badge">가져옴</span><small className="world-imported-from">{importedSource(setting.importedFrom)}</small></>}
        <span className="world-row-sub"><KindChip kind={row.kind} label={row.type} />{row.text && <span>{row.text}</span>}</span>
      </td>
      <td className="col-sum">{row.text}</td>
      <td className="col-vis" data-public={isPublic}>{isPublic ? '공개' : '비공개'}</td>
      <td className="col-num">{row.connections}</td>
    </tr>
  )
}

/**
 * 설정집 게시판(관리 모드의 설정집 보기, 작성 모드의 설정 카드 단계). 공개 설정집과 같은 게시판으로, 왼쪽 분류 메뉴 + 오른쪽 검색·정렬·결과 수·`다른 세계관에서 가져오기`·`+ 새 설정`을 둔 도구줄 아래 표(선택·번호·분류·제목[연결 수]·요약·공개·연결)다.
 * 내용 편집은 여기서 하지 않는다: 행의 제목을 누르거나 새 설정을 만들면 집필실 같은 편집 화면(`WorldCardStudio`, 주소 `?card=`)이 열리고, 삭제도 거기서 한다. 편집 화면에서 돌아오면 그 카드의 행에 초점이 간다.
 * 설정 카드는 기본 비공개이고(DEC-46) 공개 범위만은 게시판에서 한 번에 바꾼다: 행을 골라 `선택 공개`·`선택 비공개`, 또는 `전체 공개`. 초안 변경이라 저장과 확정 버전을 거쳐야 공개 화면에 반영된다.
 * 바꾸면 한 일을 상태 문구로 알리고(`설정 N개를 공개로 뒀어요.`), 고른 것이 풀리거나 모두 공개가 돼 누른 버튼이 잠기므로 초점은 표 머리의 `보이는 설정 모두 선택`으로 옮긴다. 일부만 고른 동안 그 체크박스는 중간 상태다.
 * `다른 세계관에서 가져오기`는 가져오기 시트(`WorldImportSheet`)를 연다(닫히면 시트가 초점을 이 버튼으로 돌려준다).
 * 카드가 하나도 없으면 안내는 표 안 한 줄뿐이다. 카드가 아닌 기존 항목(관계·메모·분류 확인)은 표 아래 접힌 목록에서 열 수 있다.
 */
export function WorldCardBoard({ vm }: { vm: VM }) {
  const world = vm.editing!
  const board = useCardBoard(vm)
  const search = useRef<HTMLInputElement>(null)
  const table = useRef<HTMLTableSectionElement>(null)
  const byId = new Map(world.settings.map((s) => [s.item.id, s]))
  // 고른 카드는 지금 보이는 줄에서만 센다(필터로 가려진 줄을 모르는 채 바꾸지 않는다). 공개 범위를 바꾸면 고른 것을 푼다.
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set())
  const picked = board.rows.filter((row) => selected.has(row.cardId)).map((row) => row.cardId)
  // 방금 한 일괄 변경의 결과 문구. 그 변경이 만든 초안 그대로일 때만 보이고(다른 수정·저장으로 초안이 바뀌면 낡은 말이 된다), 다시 고르면 지운다.
  const [done, setDone] = useState<{ text: string; settings: StudioSetting[] } | null>(null)
  const head = useRef<HTMLInputElement>(null)
  const select = (next: (current: ReadonlySet<string>) => ReadonlySet<string>) => {
    setDone(null)
    setSelected(next)
  }
  const pick = (id: string, on: boolean) => select((current) => new Set(on ? [...current, id] : [...current].filter((other) => other !== id)))
  const change = (visibility: CardVisibility) => {
    const next = setCardVisibility(world.settings, new Set(picked), visibility)
    if (next !== world.settings) vm.patch({ settings: next })
    setDone({ text: `설정 ${picked.length}개를 ${visibility === 'public' ? '공개' : '비공개'}로 뒀어요.`, settings: next })
    setSelected(new Set())
    head.current?.focus()
  }
  const allPublic = publishAllCards(world.settings)
  const publishAll = () => {
    vm.patch({ settings: allPublic })
    setDone({ text: '모든 설정을 공개로 뒀어요.', settings: allPublic })
    head.current?.focus()
  }
  // 일부만 고른 상태는 속성이 없어 DOM에 직접 표시한다.
  useEffect(() => {
    if (head.current) head.current.indeterminate = picked.length > 0 && picked.length < board.rows.length
  })
  const [importing, setImporting] = useState(false)
  // 편집 화면을 보는 동안 그 카드를 기억했다가, 돌아오면(또는 되돌리기로 카드가 돌아오면) 그 행으로 초점을 옮긴다. 행이 없으면(필터 밖·삭제) 검색 칸으로 옮긴다.
  const back = useRef('')
  useEffect(() => {
    if (vm.selected) { back.current = vm.selected; return }
    const id = back.current
    if (!id) return
    back.current = ''
    ;(table.current?.querySelector<HTMLElement>(`[data-card="${id}"]`) ?? search.current)?.focus()
  })
  const legacy = world.settings.filter((s) => ['relation', 'review', 'note'].includes(cardTypeOf(s.item)))
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
                <input ref={search} type="search" className="inp" placeholder="제목·본문·태그 검색" value={vm.cardQuery} onChange={(e) => vm.setCardQuery(e.target.value)} />
              </label>
              <label className="worlds-sort">
                <span>정렬</span>
                <select className="inp" value={board.sort} onChange={(e) => board.selectSort(e.target.value)}>
                  {BOOK_SORTS.map(([key, label]) => <option key={key} value={key}>{label}</option>)}
                </select>
              </label>
              <p className="muted small" role="status">설정 {board.rows.length}개</p>
              <button type="button" className="btn sm" aria-haspopup="dialog" onClick={() => setImporting(true)}>다른 세계관에서 가져오기</button>
              <NewCardMenu vm={vm} className="world-new-menu" trigger={<><span aria-hidden="true">+</span> 새 설정</>} before={board.reset} />
            </div>
            <div className="world-bulk" role="group" aria-label="공개 범위 한 번에 바꾸기">
              <p className="small muted">공개로 둔 설정만 공개 세계관에 보여요. 저장한 뒤 ‘확정 버전 남기기’를 해야 반영돼요.</p>
              <span className="small" role="status">{done?.settings === world.settings ? done.text : picked.length > 0 && `${picked.length}개 선택`}</span>
              <button type="button" className="btn sm" disabled={!picked.length} onClick={() => change('public')}>선택 공개</button>
              <button type="button" className="btn sm" disabled={!picked.length} onClick={() => change('private')}>선택 비공개</button>
              <button type="button" className="btn sm" disabled={allPublic === world.settings} onClick={publishAll}>전체 공개</button>
            </div>
            <div className="world-board-scroll">
              <table className="worlds-board-table">
                <caption className="sr-only">설정 카드 목록</caption>
                <thead>
                  <tr>
                    <th scope="col" className="col-pick"><label className="world-pick"><input ref={head} type="checkbox" disabled={!board.rows.length} checked={board.rows.length > 0 && picked.length === board.rows.length} onChange={(e) => select(() => new Set(e.target.checked ? board.rows.map((row) => row.cardId) : []))} /><span className="sr-only">보이는 설정 모두 선택</span></label></th>
                    <th scope="col" className="col-no">번호</th><th scope="col" className="col-kind">분류</th><th scope="col" className="col-title">제목</th>
                    <th scope="col" className="col-sum">요약</th><th scope="col" className="col-vis">공개</th><th scope="col" className="col-num">연결</th>
                  </tr>
                </thead>
                <tbody ref={table}>
                  {board.rows.map((row) => <Row key={row.cardId} row={row} setting={byId.get(row.cardId)} picked={selected.has(row.cardId)} onPick={pick} onOpen={vm.editCard} />)}
                  {!board.rows.length && <tr><td colSpan={7} className="muted">{board.total ? '조건에 맞는 설정이 없어요.' : '설정을 추가해 시작해 보세요.'}</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
        </div>
        {!!legacy.length && (
          <details className="world-legacy-list">
            <summary>기존 설정·관계 {legacy.length}개</summary>
            <nav aria-label="기존 설정과 관계">
              {legacy.map((s) => <button type="button" data-card={s.item.id} key={s.item.id} onClick={() => vm.editCard(s.item.id)}>{s.item.title || '이름 없는 설정'}<small>{labelOf(s)}</small></button>)}
            </nav>
          </details>
        )}
      </div>
      {importing && <WorldImportSheet vm={vm} onClose={() => setImporting(false)} onImported={board.reset} />}
    </fieldset>
  )
}

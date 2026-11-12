import { useEffect, useRef } from 'react'

import { cardTypeOf } from '../../../../domain/entities/studioCards'
import { KindChip } from '../../../shared/KindChip'
import { BOOK_SORTS, type BoardRow } from '../../../shared/worldBoard'
import { labelOf } from '../viewmodel/settingBoard'
import { useCardBoard } from '../viewmodel/useCardBoard'
import type { useWorldStudioViewModel } from '../viewmodel/useWorldStudioViewModel'
import { NewCardMenu } from './NewCardMenu'

type VM = ReturnType<typeof useWorldStudioViewModel>

/** 게시판 한 줄. 제목 버튼이 편집 화면을 여는 주 컨트롤이다(줄 전체를 누르게 하지 않는다). 제목 옆 `[n]`은 공개 설정집과 같은 관계·연결 수다. */
function Row({ row, onOpen }: { row: BoardRow; onOpen: (id: string) => void }) {
  return (
    <tr>
      <td className="col-no">{row.no || '–'}</td>
      <td className="col-kind"><KindChip kind={row.kind} label={row.type} /></td>
      <td className="col-title">
        <button type="button" data-card={row.cardId} aria-label={`${row.title} ${row.type}`} onClick={() => onOpen(row.cardId)}>{row.title}</button>
        {row.badge > 0 && <span className="worlds-badge"><span aria-hidden="true">[{row.badge}]</span><span className="sr-only">{row.kind === '인물' ? '관계' : '연결'} {row.badge}개</span></span>}
      </td>
      <td className="col-sum">{row.text}</td>
      <td className="col-num">{row.connections}</td>
    </tr>
  )
}

/**
 * 설정집 게시판(관리 모드의 설정집 보기, 작성 모드의 설정 카드 단계). 공개 설정집과 같은 게시판으로, 왼쪽 분류 메뉴 + 오른쪽 검색·정렬·결과 수·`+ 새 설정`을 둔 도구줄 아래 표(번호·분류·제목[연결 수]·요약·연결)다.
 * 게시판은 보기만 하는 목록이다: 행의 제목을 누르거나 새 설정을 만들면 집필실 같은 편집 화면(`WorldCardStudio`, 주소 `?card=`)이 열리고, 삭제도 거기서 한다. 편집 화면에서 돌아오면 그 카드의 행에 초점이 간다.
 * 카드가 하나도 없으면 안내는 표 안 한 줄뿐이다. 카드가 아닌 기존 항목(관계·메모·분류 확인)은 표 아래 접힌 목록에서 열 수 있다.
 */
export function WorldCardBoard({ vm }: { vm: VM }) {
  const world = vm.editing!
  const board = useCardBoard(vm)
  const search = useRef<HTMLInputElement>(null)
  const table = useRef<HTMLTableSectionElement>(null)
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
              <NewCardMenu vm={vm} className="world-new-menu" trigger={<><span aria-hidden="true">+</span> 새 설정</>} before={board.reset} />
            </div>
            <table className="worlds-board-table">
              <caption className="sr-only">설정 카드 목록</caption>
              <thead>
                <tr>
                  <th scope="col" className="col-no">번호</th><th scope="col" className="col-kind">분류</th><th scope="col" className="col-title">제목</th>
                  <th scope="col" className="col-sum">요약</th><th scope="col" className="col-num">연결</th>
                </tr>
              </thead>
              <tbody ref={table}>
                {board.rows.map((row) => <Row key={row.cardId} row={row} onOpen={vm.editCard} />)}
                {!board.rows.length && <tr><td colSpan={5} className="muted">{board.total ? '조건에 맞는 설정이 없어요.' : '설정을 추가해 시작해 보세요.'}</td></tr>}
              </tbody>
            </table>
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
    </fieldset>
  )
}

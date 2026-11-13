import { useAppSelector } from '../../../../app/store'
import type { PublicWorld } from '../../../../domain/entities/publicWorld'
import { Go } from '../../../shared/Go'
import { KindChip } from '../../../shared/KindChip'
import { BOOK_SORTS } from '../../../shared/worldBoard'
import { genreLabel } from '../../../shared/worldGenres'
import { useWorldImport } from '../viewmodel/useWorldImport'
import { useWorldBookViewModel } from '../viewmodel/useWorldsViewModel'
import { bookPath, cardPath, type BookRow } from '../worldDetail'
import { ImportOutcomeNotice, WorldAddMenu } from './WorldImportMenu'

/**
 * 게시판 한 줄. 제목 링크 하나가 카드 페이지로 가는 주 링크이고(줄 전체를 링크로 만들지 않는다), 제목 옆 `[n]`은 댓글 수처럼 붙는 관계(인물)·연결 수다.
 * 화면 읽기 프로그램에는 대괄호 대신 "관계 2개"·"연결 2개"로 읽힌다. `pick`이 있으면(로그인한 회원) 맨 앞에 가져올 설정을 고르는 체크박스 칸이 붙는다.
 */
function Row({ worldId, row, pick }: { worldId: string; row: BookRow; pick?: { checked: boolean; onChange: (on: boolean) => void } }) {
  return (
    <tr>
      {pick && <td className="col-pick"><label className="worlds-pick"><input type="checkbox" checked={pick.checked} onChange={(e) => pick.onChange(e.target.checked)} /><span className="sr-only">{row.title} 선택</span></label></td>}
      <td className="col-no">{row.no}</td>
      <td className="col-kind"><KindChip kind={row.kind} label={row.type} /></td>
      <td className="col-title">
        <Go to={cardPath(worldId, row.cardId)}>{row.title}</Go>
        {row.badge > 0 && <span className="worlds-badge"><span aria-hidden="true">[{row.badge}]</span><span className="sr-only">{row.kind === '인물' ? '관계' : '연결'} {row.badge}개</span></span>}
      </td>
      <td className="col-sum">{row.text}</td>
      <td className="col-num">{row.connections}</td>
    </tr>
  )
}

/**
 * 공개 세계관의 설정집(`/worlds/:id?tab=book`): 설정 카드를 카테고리별로 보는 게시판이다. 위에 한 줄 요약, 왼쪽에 분류 메뉴(전체·유형, 선택은 `aria-current`),
 * 오른쪽에 검색·정렬 도구와 게시판 표(번호 · 분류 · 제목 · 요약 · 연결)를 둔다. 게시판(`shared/worldBoard.css`)이 읽는 읽기 화면 색 토큰은 `.calm`이 준다.
 * 세계관 개요(정보 상자·표지·설명·계보)는 이 탭에 두지 않고 개요 탭(`WorldOverview`)이 보인다. 여기에는 장르·작가·설정 카드 수·파생·조합 수의 한 줄 요약만 있다.
 * 어떤 카드가 어떤 순서로 보이는지(필터·정렬·번호)는 `bookRows`가 정하고 이 화면은 그대로 그린다. 이 세계관을 바꾸지 않는 읽기 전용이다.
 * 로그인한 회원에게는 줄마다 체크박스(머리 칸은 '보이는 설정 모두 선택')와 도구줄의 `선택한 설정 가져오기`가 보인다: 내 세계관을 고르면 고른 설정만 그 세계관 초안에 바로 더하고(관계 제외),
 * 진행·결과를 도구줄 아래에 알리며 끝나면 선택을 비운다. 설정과 그 사이의 관계를 함께 가져오는 길은 내 세계관 관리 화면의 `다른 세계관에서 가져오기`다.
 */
export function WorldBook({ world }: { world: PublicWorld }) {
  const vm = useWorldBookViewModel(world)
  const member = useAppSelector((s) => !!s.session.role)
  const direct = useWorldImport(world)
  const picked = vm.picked.size
  const derived = world.lineage?.children.length ?? 0
  return (
    <div className="calm">
      <p className="muted small worlds-book-line">{`${genreLabel(world.genre)} · 작가 ${world.authorNickname} · 설정 카드 ${world.cards.length}개${derived ? ` · 파생·조합된 세계관 ${derived}개` : ''}`}</p>
      <div className="worlds-board">
        <nav className="worlds-cats" aria-label="설정 분류">
          <ul>
            <li><Go to={bookPath(world.id)} replace aria-current={vm.kind ? undefined : 'page'}>전체 <span>{vm.total}</span></Go></li>
            {vm.counts.map(({ kind, count }) => (
              <li key={kind}><Go to={bookPath(world.id, kind)} replace aria-current={vm.kind === kind ? 'page' : undefined}>{kind} <span>{count}</span></Go></li>
            ))}
          </ul>
        </nav>
        <div className="worlds-board-main">
          <div className="worlds-board-tools">
            <label className="worlds-search">
              <span className="sr-only">설정 카드 제목·본문 검색</span>
              <input type="search" className="inp" placeholder="제목·본문 검색" value={vm.query} onChange={(e) => vm.setQuery(e.target.value)} />
            </label>
            <label className="worlds-sort">
              <span>정렬</span>
              <select className="inp" value={vm.sort} onChange={(e) => vm.selectSort(e.target.value)}>
                {BOOK_SORTS.map(([key, label]) => <option key={key} value={key}>{label}</option>)}
              </select>
            </label>
            {member && (
              <WorldAddMenu
                sourceWorldId={world.id} label={`선택한 설정 가져오기${picked ? ` (${picked})` : ''}`} saving={direct.saving}
                note={`선택한 설정 ${picked}개를 고른 세계관의 초안에 바로 추가해요. 관계는 함께 오지 않아요.`} unavailable={picked ? undefined : '가져올 설정을 먼저 선택해 주세요.'}
                onAdd={async (target) => { if (await direct.add(target, [...vm.picked])) vm.clearPicked() }}
              />
            )}
            <p className="muted small" role="status">설정 {vm.rows.length}개</p>
          </div>
          {member && <ImportOutcomeNotice outcome={direct.outcome} onRetry={async () => { if (await direct.retry()) vm.clearPicked() }} />}
          <table className="worlds-board-table">
            <caption className="sr-only">설정 카드 목록</caption>
            <thead>
              <tr>
                {member && <th scope="col" className="col-pick"><label className="worlds-pick"><input type="checkbox" disabled={!vm.rows.length} checked={vm.allVisiblePicked} onChange={(e) => vm.pickVisible(e.target.checked)} /><span className="sr-only">보이는 설정 모두 선택</span></label></th>}
                <th scope="col" className="col-no">번호</th><th scope="col" className="col-kind">분류</th><th scope="col" className="col-title">제목</th>
                <th scope="col" className="col-sum">요약</th><th scope="col" className="col-num">연결</th>
              </tr>
            </thead>
            <tbody>
              {vm.rows.length
                ? vm.rows.map((row) => <Row key={row.cardId} worldId={world.id} row={row} pick={member ? { checked: vm.picked.has(row.cardId), onChange: (on) => vm.pick(row.cardId, on) } : undefined} />)
                : <tr><td colSpan={member ? 6 : 5} className="muted">조건에 맞는 설정이 없어요.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

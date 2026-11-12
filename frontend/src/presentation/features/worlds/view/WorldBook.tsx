import type { CSSProperties } from 'react'

import type { PublicWorld } from '../../../../domain/entities/publicWorld'
import { Go } from '../../../shared/Go'
import { KindChip } from '../../../shared/KindChip'
import { BOOK_SORTS } from '../../../shared/worldBoard'
import { genreLabel } from '../../../shared/worldGenres'
import { useWorldBookViewModel } from '../viewmodel/useWorldsViewModel'
import { GENRE_COLORS } from '../worldAtlas'
import { bookPath, cardPath, type BookRow } from '../worldDetail'
import { InfoRow, LineageLines, WorldCover, WorldLink, WorldLinks } from './WorldParts'
import '../../reading/view/publicWiki.css'

/** 나무위키 정보 상자(오른쪽): 장르 색 띠 아래 세계관 이름과 표지 아트, 이어서 장르·작가·설정 카드 수와 (계보가 있는 데모는) 파생·조합 출처를 표로 보인다. */
function InfoBox({ world }: { world: PublicWorld }) {
  const { lineage } = world
  const genre = genreLabel(world.genre)
  return (
    <table className="nw-info" style={{ '--cat': GENRE_COLORS[genre] } as CSSProperties}>
      <caption>{world.name}</caption>
      <tbody>
        <tr><td colSpan={2} className="nw-cover"><WorldCover w={world} k="b" /></td></tr>
        <InfoRow k="장르">{genre}</InfoRow>
        <InfoRow k="작가">{world.authorNickname}</InfoRow>
        <InfoRow k="설정 카드">{world.cards.length}개</InfoRow>
        {lineage?.derivedFrom && <InfoRow k="파생 원본"><WorldLink w={lineage.derivedFrom} /></InfoRow>}
        {lineage && lineage.combinedFrom.length > 0 && <InfoRow k="조합 원본"><WorldLinks worlds={lineage.combinedFrom} /></InfoRow>}
        {lineage && lineage.children.length > 0 && <InfoRow k="파생·조합된 세계관">{lineage.children.length}개</InfoRow>}
      </tbody>
    </table>
  )
}

/**
 * 게시판 한 줄. 제목 링크 하나가 카드 페이지로 가는 주 링크이고(줄 전체를 링크로 만들지 않는다), 제목 옆 `[n]`은 댓글 수처럼 붙는 관계(인물)·연결 수다.
 * 화면 읽기 프로그램에는 대괄호 대신 "관계 2개"·"연결 2개"로 읽힌다.
 */
function Row({ worldId, row }: { worldId: string; row: BookRow }) {
  return (
    <tr>
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
 * 오른쪽에 검색·정렬 도구와 게시판 표(번호 · 분류 · 제목 · 요약 · 연결)를 두고, 표 아래에 세계관 개요(정보 상자·표지·설명·계보)를 한 번만 둔다.
 * 개요는 작품 설정 위키(`PublicWikiArticle`)와 같은 `nw-*` 클래스를 쓰고 그 CSS가 읽는 읽기 화면 색 토큰은 `.calm`이 준다.
 * 어떤 카드가 어떤 순서로 보이는지(필터·정렬·번호)는 `bookRows`가 정하고 이 화면은 그대로 그린다. 읽기 전용이다.
 */
export function WorldBook({ world }: { world: PublicWorld }) {
  const vm = useWorldBookViewModel(world)
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
            <p className="muted small" role="status">설정 {vm.rows.length}개</p>
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
              {vm.rows.length
                ? vm.rows.map((row) => <Row key={row.cardId} worldId={world.id} row={row} />)
                : <tr><td colSpan={5} className="muted">조건에 맞는 설정이 없어요.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
      <article className="tcard nw worlds-overview">
        <details className="nw-sec" open>
          <summary><h2>개요</h2></summary>
          <div className="nw-doc">
            <InfoBox world={world} />
            <p>{world.description}</p>
            <LineageLines lineage={world.lineage} />
          </div>
        </details>
      </article>
    </div>
  )
}

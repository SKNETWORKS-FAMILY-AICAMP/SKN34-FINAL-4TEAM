import { pageNumbers } from './paginate'
import './pager.css'

/** 한 쪽보다 많을 때만 이전·다음과 쪽 번호를 보인다. 7쪽을 넘으면 처음·끝과 현재 쪽 주변만 번호로 두고 사이는 …로 줄인다(`pageNumbers`). 서재·작품 관리·검색이 함께 쓴다. */
export function Pager({ page, pages, onPage }: { page: number; pages: number; onPage: (page: number) => void }) {
  if (pages <= 1) return null
  return <nav className="pager" aria-label="페이지">
    <button type="button" className="btn sm" disabled={page <= 1} onClick={() => onPage(page - 1)}>이전</button>
    {pageNumbers(page, pages).map((number, index) => number === '…'
      ? <span key={`gap${index}`} className="pager-gap" aria-hidden="true">…</span>
      : <button key={number} type="button" className={number === page ? 'btn sm pri' : 'btn sm'} aria-current={number === page ? 'page' : undefined} onClick={() => onPage(number)}>{number}</button>)}
    <button type="button" className="btn sm" disabled={page >= pages} onClick={() => onPage(page + 1)}>다음</button>
  </nav>
}

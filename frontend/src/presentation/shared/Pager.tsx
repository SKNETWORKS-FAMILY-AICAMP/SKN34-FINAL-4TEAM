import './pager.css'

/** 한 쪽보다 많을 때만 이전·다음과 쪽 번호를 보인다. 서재와 작품 관리가 함께 쓴다. */
// ponytail: 쪽 번호를 전부 나열한다. 수십 쪽이 되면 현재 쪽 주변만 보이도록 줄인다.
export function Pager({ page, pages, onPage }: { page: number; pages: number; onPage: (page: number) => void }) {
  if (pages <= 1) return null
  return <nav className="pager" aria-label="페이지">
    <button type="button" className="btn sm" disabled={page <= 1} onClick={() => onPage(page - 1)}>이전</button>
    {Array.from({ length: pages }, (_, index) => index + 1).map(number =>
      <button key={number} type="button" className={number === page ? 'btn sm pri' : 'btn sm'} aria-current={number === page ? 'page' : undefined} onClick={() => onPage(number)}>{number}</button>)}
    <button type="button" className="btn sm" disabled={page >= pages} onClick={() => onPage(page + 1)}>다음</button>
  </nav>
}

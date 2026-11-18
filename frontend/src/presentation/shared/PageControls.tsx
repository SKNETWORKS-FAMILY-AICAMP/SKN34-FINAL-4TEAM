export function PageControls({ page, pages, onPage }: { page: number; pages: number; onPage: (page: number) => void }) {
  if (pages <= 1) return null
  return <nav aria-label="페이지 이동">
    <button type="button" className="btn sm" disabled={page === 0} onClick={() => onPage(page - 1)}>이전</button>{' '}
    <label>페이지 <select className="inp" value={page} onChange={(e) => onPage(Number(e.target.value))}>{Array.from({ length: pages }, (_, i) => <option key={i} value={i}>{i + 1}</option>)}</select> / {pages}</label>{' '}
    <button type="button" className="btn sm" disabled={page === pages - 1} onClick={() => onPage(page + 1)}>다음</button>
  </nav>
}

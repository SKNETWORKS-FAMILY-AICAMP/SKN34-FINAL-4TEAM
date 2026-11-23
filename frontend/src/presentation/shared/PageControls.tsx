import './pageControls.css'

export function PageControls({ page, pages, onPage, label }: { page: number; pages: number; onPage: (page: number) => void; label?: string }) {
  if (pages <= 1) return null
  return <nav className="page-controls" aria-label={label ? `${label} 페이지 이동` : "페이지 이동"}>
    {label && <span>{label}</span>}
    <button type="button" className="btn sm" disabled={page === 0} onClick={() => onPage(page - 1)}>이전</button>{' '}
    <label>페이지 <select className="inp sm" value={page} onChange={(e) => onPage(Number(e.target.value))}>{Array.from({ length: pages }, (_, i) => <option key={i} value={i}>{i + 1}</option>)}</select> / {pages}</label>{' '}
    <button type="button" className="btn sm" disabled={page === pages - 1} onClick={() => onPage(page + 1)}>다음</button>
  </nav>
}

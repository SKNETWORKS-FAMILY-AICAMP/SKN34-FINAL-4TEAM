import type { VersionGraphRow } from '../../../../domain/entities/versionGraph'
import './version-graph.css'

function Label({ row }: { row: VersionGraphRow }) {
  return <>
    <span className="graph-label">{row.label}
      {row.head && <span className="chip ok">현재</span>}
      {row.unsaved && <span className="chip wait">저장 안 됨</span>}
      {row.published && <span className="chip ok">발행본</span>}
    </span>
    {row.savedAt && <time className="graph-time" dateTime={row.savedAt}>{new Date(row.savedAt).toLocaleString('ko-KR')}</time>}
  </>
}

/** 선택 회차의 버전을 세로 한 줄 커밋 그래프로 그린다. 저장 버전 노드만 눌러 기존 버전 시트로 이어진다. */
export function VersionGraph({ rows, selectedId, disabled, onPick }: { rows: VersionGraphRow[]; selectedId: string; disabled: boolean; onPick: (versionId: string) => void }) {
  return <ol className="version-graph">{rows.map(row => <li key={row.id} className={`graph-row ${row.kind}${row.head ? ' head' : ''}${row.unsaved ? ' unsaved' : ''}`}>
    <span className="graph-node" aria-hidden="true" />
    {row.kind === 'version'
      ? <button type="button" className="graph-item" disabled={disabled} aria-current={selectedId === row.id || undefined} onClick={() => onPick(row.id)}><Label row={row} /></button>
      : <div className="graph-item"><Label row={row} /></div>}
  </li>)}</ol>
}

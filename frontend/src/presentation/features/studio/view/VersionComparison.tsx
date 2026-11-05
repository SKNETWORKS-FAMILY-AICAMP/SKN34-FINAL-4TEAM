import type { Version } from '../../../../domain/entities/content'
import { ManuscriptBody } from '../../../shared/media/MediaPanel'
import { useVersionComparisonViewModel } from '../viewmodel/useVersionComparisonViewModel'

export function VersionComparison({ workId, number, versions }: { workId: string; number: number; versions: Version[] }) {
  const { before, after, comparison, changed, setBeforeId, setAfterId } = useVersionComparisonViewModel(versions)
  if (versions.length < 2) return <p className="muted">비교하려면 이 회차의 저장 버전이 두 개 이상 필요해요.</p>
  const labels = { same: '유지', removed: '삭제', added: '추가' }
  return <section className="version-comparison" aria-label="저장 원고 비교">
    <div className="version-selectors">
      <label className="field">기준 원고 버전<select className="inp" value={before?.id ?? ''} onChange={e => setBeforeId(e.target.value)}>
        <option value="">기준 버전 선택</option>{versions.map((v, i) => <option key={v.id} value={v.id}>버전 {i + 1} · {new Date(v.savedAt).toLocaleString('ko-KR')} · {v.title}</option>)}
      </select></label>
      <label className="field">비교 원고 버전<select className="inp" value={after?.id ?? ''} onChange={e => setAfterId(e.target.value)}>
        <option value="">비교 버전 선택</option>{versions.map((v, i) => <option key={v.id} value={v.id}>버전 {i + 1} · {new Date(v.savedAt).toLocaleString('ko-KR')} · {v.title}</option>)}
      </select></label>
    </div>
    {!comparison ? <p role="status" className="muted">서로 다른 저장 버전 두 개를 선택해 주세요.</p> : <>
      {!changed && <p role="status">두 버전의 내용이 같아요.</p>}
      <section aria-label="원고 변경 내용" className="version-diff">
        <h3>변경 내용</h3>
        <p className="small muted">줄 단위 비교예요. 추가·삭제 표시는 기준 버전에서 비교 버전으로 바뀐 내용이에요.</p>
        {comparison.body.grouped && <p role="status">변경된 줄이 많아 변경 구간을 묶어서 표시해요.</p>}
        {(['title', 'body'] as const).map(field => <div key={field}>
          <h4>{field === 'title' ? '제목' : '본문'}</h4>
          {!comparison[field].parts.length ? <p className="muted">(빈 내용)</p> : comparison[field].parts.map((part, i) => <div key={i} className={`version-change version-change-${part.kind}`}>
            <span className="version-change-label">{labels[part.kind]}</span><div className="version-prose">{part.text}</div>
          </div>)}
        </div>)}
      </section>
      <details className="version-originals"><summary>두 저장본 원문·이미지 보기</summary>
        <div className="version-original-columns">
          {[before, after].map((v, i) => v && <section key={v.id} aria-label={i ? '비교 저장본' : '기준 저장본'}>
            <h3>{i ? '비교 저장본' : '기준 저장본'} · {v.title}</h3>
            <ManuscriptBody workId={workId} number={number} body={v.body || '(빈 원고)'} />
          </section>)}
        </div>
      </details>
    </>}
  </section>
}

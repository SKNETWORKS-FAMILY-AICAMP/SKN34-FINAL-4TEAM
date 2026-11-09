import { Fragment } from 'react'

import { LINE, WCATS, type Doc } from '../../../../domain/entities/wiki'
import type { Work } from '../../../../domain/entities/work'
import { Sheet } from '../../../shared/Sheet'
import './publicWiki.css'

/**
 * 문서 한 건. 서버(`readWorld`)가 기준 회차까지 공개한 항목만 주므로 거르지 않고 보여 준다:
 * 속성은 공개 회차가 지난 것만, 지식은 공개 회차와 함께, 연결은 보이는 문서로만 온다. 연결 대상 ID는 문서 이름으로 바꿔 보인다.
 */
function PublicDoc({ doc, docs }: { doc: Doc; docs: Doc[] }) {
  const props = Object.entries(doc.props)
  const links = (doc.links ?? []).flatMap((l) => { const to = docs.find((d) => d.id === l.to); return to ? [`${to.t}(${l.k})`] : [] })
  return (
    <article className="pw-doc">
      <h4>{doc.t}</h4>
      {doc.ep != null && <p className="pw-meta">{doc.ep}화{doc.line && ` · ${LINE[doc.line] ?? doc.line}`}</p>}
      {doc.alias.length > 0 && <p className="pw-meta">별칭 · {doc.alias.join(', ')}</p>}
      {doc.body && <p>{doc.body}</p>}
      {props.length > 0 && <dl className="pw-props">{props.map(([k, v]) => <Fragment key={k}><dt>{k}</dt><dd>{v}</dd></Fragment>)}</dl>}
      {!!doc.knowledge?.length && <ul className="pw-know" aria-label="알려진 사실">{doc.knowledge.map((k, i) => <li key={i}>{k.text}{k.publicAt != null && ` · ${k.publicAt}화 공개`}</li>)}</ul>}
      {!!doc.who?.length && <p className="pw-meta">등장 · {doc.who.join(', ')}</p>}
      {links.length > 0 && <p className="pw-meta">연결 · {links.join(', ')}</p>}
    </article>
  )
}

/** 분류(사전 순서)별로 묶은 공개 설정 목록과 공개 범위 안내. 비어 있으면 빈 상태를 보여 줍니다. */
export function PublicWikiList({ work, upto }: { work: Work; upto: number }) {
  const docs = work.wiki?.docs ?? []
  const groups = (work.wiki?.cats ?? WCATS).map((cat) => ({ cat, list: docs.filter((d) => d.cat === cat.id) })).filter((g) => g.list.length)
  return (
    <div className="pw-list">
      {upto > 0 && <p className="pw-scope">{upto}화까지 공개된 설정만 보여요.</p>}
      {groups.length === 0 ? <p className="muted">공개된 설정이 없어요.</p> : groups.map(({ cat, list }) => (
        <details key={cat.id} className="pw-group" open>
          <summary><i style={{ background: cat.c }} aria-hidden="true" />{cat.n}<small>{list.length}</small></summary>
          {list.map((d) => <PublicDoc key={d.id} doc={d} docs={docs} />)}
        </details>
      ))}
    </div>
  )
}

/** 회차 화면의 읽기 전용 공개 설정 시트. [upto]는 지금 읽는 회차라서 그 회차까지 공개된 설정만 보입니다. */
export function PublicWikiSheet({ work, upto, onClose }: { work: Work; upto: number; onClose: () => void }) {
  return (
    <Sheet sid="U44" label="공개된 설정" onClose={onClose}>
      <div className="sh-h"><h3>공개된 설정</h3><button type="button" className="x" aria-label="닫기" onClick={onClose}>✕</button></div>
      <PublicWikiList work={work} upto={upto} />
    </Sheet>
  )
}

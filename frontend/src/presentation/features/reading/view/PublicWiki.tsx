import { useId, type CSSProperties } from 'react'

import { LINE, WCATS, type Doc, type WikiCat } from '../../../../domain/entities/wiki'
import type { Work } from '../../../../domain/entities/work'
import { Go } from '../../../shared/Go'
import { Jump } from '../../../shared/Jump'
import './publicWiki.css'

const docAnchor = (d: Doc) => 'doc-' + d.id

/** 나무위키 정보 상자: 분류 색 띠 아래 이름, 이어서 별칭·첫 등장·공개된 속성을 표로 보인다. */
function InfoBox({ doc, cat }: { doc: Doc; cat: WikiCat }) {
  const rows: [string, string][] = [['분류', cat.n]]
  if (doc.alias.length) rows.push(['별칭', doc.alias.join(', ')])
  if (doc.ep != null) rows.push(['회차', `${doc.ep}화${doc.line ? ` · ${LINE[doc.line] ?? doc.line}` : ''}`])
  rows.push(...Object.entries(doc.props))
  return (
    <table className="nw-info" style={{ '--cat': cat.c } as CSSProperties}>
      <caption>{doc.t}</caption>
      <tbody>{rows.map(([k, v]) => <tr key={k}><th scope="row">{k}</th><td>{v}</td></tr>)}</tbody>
    </table>
  )
}

/** 문서 한 건. 서버가 기준 회차까지 공개한 항목만 주므로 거르지 않는다. 연결·등장 인물은 같은 위키의 문서로 건너가는 링크가 된다. */
function Article({ doc, cat, no, docs }: { doc: Doc; cat: WikiCat; no: string; docs: Doc[] }) {
  const byName = (n: string) => docs.find((d) => d.t === n)
  const links = (doc.links ?? []).flatMap((l) => { const to = docs.find((d) => d.id === l.to); return to ? [{ to, k: l.k }] : [] })
  return (
    <div className="nw-doc" id={docAnchor(doc)} tabIndex={-1}>
      <h3><Jump to="nw-toc" className="nw-no" describedBy="nw-back">{no}</Jump> {doc.t}</h3>
      <InfoBox doc={doc} cat={cat} />
      {doc.body ? <p>{doc.body}</p> : <p className="nw-empty">아직 설명이 공개되지 않았어요.</p>}
      {!!doc.knowledge?.length && (
        <><h4>알려진 사실</h4><ul>{doc.knowledge.map((k, i) => <li key={i}>{k.text}{k.publicAt != null && <small> ({k.publicAt}화 공개)</small>}</li>)}</ul></>
      )}
      {!!doc.who?.length && (
        <p className="nw-rel"><b>등장</b> {doc.who.map((n, i) => { const d = byName(n); return <span key={n}>{i > 0 && ', '}{d ? <Jump to={docAnchor(d)}>{n}</Jump> : n}</span> })}</p>
      )}
      {links.length > 0 && (
        <p className="nw-rel"><b>연결</b> {links.map(({ to, k }, i) => <span key={to.id + k}>{i > 0 && ', '}<Jump to={docAnchor(to)}>{to.t}</Jump> ({k})</span>)}</p>
      )}
    </div>
  )
}

/**
 * U45 설정 위키 본문(나무위키 형식: 분류 상자·목차·번호 매긴 접이식 문단·정보 상자). 서버(`readWorld`)가 [upto]회차까지 공개한 설정만 주므로
 * 거르지 않고 분류(사전 순서)별로 묶어 보인다.
 */
export function PublicWikiArticle({ work, upto }: { work: Work; upto: number }) {
  const heading = useId()
  const docs = work.wiki?.docs ?? []
  const groups = (work.wiki?.cats ?? WCATS).map((cat) => ({ cat, list: docs.filter((d) => d.cat === cat.id) })).filter((g) => g.list.length)
  return (
    <article className="tcard nw" aria-labelledby={heading}>
      <p className="nw-cat"><b>분류</b><Go to={`/work/${work.id}`}>{work.title}</Go></p>
      <header className="nw-head">
        <h1 id={heading}>{work.title}<span>/설정 위키</span></h1>
        {upto > 0 && <p>{upto}화까지 공개된 설정만 보여요.</p>}
      </header>
      {groups.length === 0 ? <p className="nw-empty">공개된 설정이 없어요.</p> : (
        <>
          {/* 문서 번호 링크의 목적 설명. 제목 이름(1.1. 리안)을 흐리지 않도록 aria-label 대신 설명으로 붙인다. */}
          <span id="nw-back" hidden>목차로 돌아가기</span>
          <nav className="nw-toc" id="nw-toc" tabIndex={-1} aria-label="목차">
            <b>목차</b>
            <ol>{groups.map(({ cat, list }, i) => (
              <li key={cat.id}><Jump to={`nw-s-${cat.id}`}><span className="nw-no">{i + 1}.</span> {cat.n}</Jump>
                <ol>{list.map((d, j) => <li key={d.id}><Jump to={docAnchor(d)}><span className="nw-no">{i + 1}.{j + 1}.</span> {d.t}</Jump></li>)}</ol>
              </li>
            ))}</ol>
          </nav>
          {groups.map(({ cat, list }, i) => (
            <details key={cat.id} className="nw-sec" open>
              <summary id={`nw-s-${cat.id}`}><h2><span className="nw-no">{i + 1}.</span> {cat.n}</h2></summary>
              {list.map((d, j) => <Article key={d.id} doc={d} cat={cat} no={`${i + 1}.${j + 1}.`} docs={docs} />)}
            </details>
          ))}
        </>
      )}
    </article>
  )
}

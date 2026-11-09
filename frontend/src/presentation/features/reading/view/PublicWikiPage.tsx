import { useId, type CSSProperties, type MouseEvent, type ReactNode } from 'react'
import { Navigate, useParams } from 'react-router'

import { LINE, WCATS, type Doc, type WikiCat } from '../../../../domain/entities/wiki'
import { ContentLoadState } from '../../../shared/ContentLoadState'
import { Go } from '../../../shared/Go'
import { BackChev } from '../../../shared/icons'
import { Footer, Gnb } from '../../../shared/shell/Gnb'
import { useDocumentTitle } from '../../../shared/useDocumentTitle'
import { useWorkWikiViewModel } from '../viewmodel/useWorkWikiViewModel'
import { UnavailableWork } from './WorkPage'
import './publicWiki.css'

const docAnchor = (d: Doc) => 'doc-' + d.id
/** 문서 안 이동 링크. 목업 모드는 해시 라우터라 `#앵커`가 경로를 바꾸므로 기본 이동을 막고 직접 스크롤한다. */
function Jump({ to, children, className }: { to: string; children: ReactNode; className?: string }) {
  const go = (e: MouseEvent) => {
    e.preventDefault()
    const el = document.getElementById(to)
    el?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    el?.focus({ preventScroll: true })
  }
  return <a href={`#${to}`} className={className} onClick={go}>{children}</a>
}

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
    <section className="nw-doc" id={docAnchor(doc)} tabIndex={-1} aria-labelledby={docAnchor(doc) + '-h'}>
      <h3 id={docAnchor(doc) + '-h'}><Jump to="nw-toc" className="nw-no">{no}</Jump> {doc.t}</h3>
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
    </section>
  )
}

/**
 * U45 설정 위키(`/work/:id/wiki`): 작품 상세에서 링크로 들어오는 읽기 전용 페이지. 나무위키처럼 분류 상자·목차·번호 매긴 접이식 문단·정보 상자로
 * 최신 공개 회차까지 서버가 공개한 설정만 보인다. 메모리 데모 작품의 wiki는 서버 공개 범위로 걸러진 것이 아니므로 작품 상세로 돌려보낸다.
 */
export function PublicWikiPage() {
  const { id = '' } = useParams()
  const vm = useWorkWikiViewModel(id)
  const heading = useId()
  const w = vm.work
  useDocumentTitle(w ? `${w.title}/설정 위키` : '설정 위키')
  if (w === undefined) return <><Gnb /><main className="wrap" id="main" tabIndex={-1}><ContentLoadState failed={vm.isError} retry={vm.retry} /></main></>
  if (w === null) return <UnavailableWork />
  if (!w.canonical) return <Navigate replace to={`/work/${id}`} />
  const docs = w.wiki?.docs ?? []
  const groups = (w.wiki?.cats ?? WCATS).map((cat) => ({ cat, list: docs.filter((d) => d.cat === cat.id) })).filter((g) => g.list.length)
  return (
    <>
      <div className={`calm calm-${w.theme}`} style={{ minHeight: '100vh' }}>
        <main className="wrap" id="main" tabIndex={-1}>
          <div className="topbar"><Go to={`/work/${id}`} className="back" aria-label={`${w.title} 소설 상세로 돌아가기`}><BackChev />{w.title}</Go></div>
          <article className="tcard nw" aria-labelledby={heading}>
            <p className="nw-cat"><b>분류</b><Go to={`/work/${id}`}>{w.title}</Go></p>
            <header className="nw-head">
              <h1 id={heading}>{w.title}<span>/설정 위키</span></h1>
              {vm.upto > 0 && <p>{vm.upto}화까지 공개된 설정만 보여요.</p>}
            </header>
            {groups.length === 0 ? <p className="nw-empty">공개된 설정이 없어요.</p> : (
              <>
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
        </main>
      </div>
      <Footer />
    </>
  )
}

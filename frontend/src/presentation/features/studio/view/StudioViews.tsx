import { useState, type CSSProperties, type ReactNode } from 'react'
import { useSearchParams } from 'react-router'

import { checkItems, LINE, linkParts, mentions, narrativeOrder, propsAt, type Doc, type WikiCat } from '../../../../domain/entities/wiki'
import { epsOf } from '../../../../domain/entities/work'
import { CoverOf } from '../../../shared/art'
import { Go } from '../../../shared/Go'
import type { useStudioViewModel } from '../viewmodel/useStudioViewModel'
import { FormSheet } from './StudioSheets'

type VM = ReturnType<typeof useStudioViewModel>

/** 목업 studioViews(id, view) */
export function StudioTools({ id, view, ep }: { id: string; view: string; ep?: number }) {
  return (
    <nav className="svw" aria-label="집필 도구">
      {([['board', '보드'], ['wiki', '사전'], ['overview', '개요'], ['narrative', '서술'], ['write', '원고'], ['memo', '메모']] as const).map(([k, l]) => (
        <Go key={k} to={`/studio/${id}?view=${k}${ep ? `&ep=${ep}` : ''}`} className={view === k ? 'on' : ''} aria-current={view === k ? 'page' : undefined}>{l}</Go>
      ))}
    </nav>
  )
}

/** 목업 memoView(w): 입력은 화면에 두고 바뀔 때마다 저장합니다. */
export function MemoView({ vm }: { vm: VM }) {
  const [memo, setMemo] = useState(vm.studio!.work.memo ?? '')
  return (
    <section className="memo-page"><h2>메모</h2><p className="muted">정리 전 아이디어를 적어 두세요. 원고 TXT 내보내기에는 포함되지 않습니다.</p>
      <textarea id="workMemo" aria-label="메모" placeholder="아이디어나 나중에 확인할 내용을 적어 두세요." value={memo} onChange={(e) => { setMemo(e.target.value); vm.saveNotes({ memo: e.target.value }) }} />
    </section>
  )
}

const DocBtn = ({ id, d, children, className, style }: { id: string; d: Doc; children: ReactNode; className?: string; style?: CSSProperties }) => <Go to={`/studio/${id}?view=wiki&doc=${encodeURIComponent(d.id)}`} className={className} style={style}>{children}</Go>

/** 목업 narrativeView(w) */
export function NarrativeView({ vm }: { vm: VM }) {
  const w = vm.studio!.work
  const ordered = narrativeOrder(w, vm.docs)
  const move = (i: number, j: number) => {
    const order = ordered.map((d) => d.t)
    ;[order[i], order[j]] = [order[j], order[i]]
    vm.saveNotes({ narrativeOrder: order })
  }
  return (
    <section className="narrative-page"><h2>서술 순서</h2><p className="muted">사건을 이야기에서 보여 줄 순서로 정리하세요. 회차와 시점은 보드·사전 설정을 따릅니다.</p>
      <Go to={`/studio/${w.id}?view=board`} className="btn sm">보드에서 비교</Go>
      <div className="narrative-list">{ordered.length ? ordered.map((d, i) => (
        <div className="narrative-row" key={d.id}><DocBtn id={w.id} d={d} className="event"><b>{d.t}</b><small>{d.ep ? `${d.ep}화 · ` : ''}{LINE[d.line ?? ''] || '시점 미정'}</small></DocBtn>
          <span className="move"><button type="button" aria-label={`${d.t} 위로 이동`} disabled={i === 0} onClick={() => move(i, i - 1)}>↑</button><button type="button" aria-label={`${d.t} 아래로 이동`} disabled={i === ordered.length - 1} onClick={() => move(i, i + 1)}>↓</button></span></div>
      )) : <p className="muted">사건이 없어요. 사전에서 사건 문서를 추가해 주세요.</p>}</div>
      <Go to={`/studio/${w.id}?view=wiki`} className="btn sm" style={{ marginTop: 14 }}>사전에서 사건 관리</Go>
    </section>
  )
}

/** 목업 overviewView(w). ponytail: 표지 이미지 바꾸기·지우기는 옮기지 않았어요(저장 구조 미정). */
export function OverviewView({ vm }: { vm: VM }) {
  const w = vm.studio!.work
  const evs = vm.docs.filter((d) => d.cat === 'event')
  const grp = (k: string) => evs.filter((e) => e.ep && e.line === k).sort((a, b) => a.ep! - b.ep!)
  const und = evs.filter((e) => !e.ep)
  return (
    <div className="ovw">
      <div className="ovtop"><div className="ovcov"><CoverOf w={w} /></div><div><span className="chip">{w.genre}</span>
        <h2 contentEditable suppressContentEditableWarning spellCheck={false} aria-label="한 줄 소개" onBlur={(e) => vm.saveNotes({ hook: (e.currentTarget.textContent ?? '').trim() })}>{w.hook || w.dir || ''}</h2>
        <p className="muted small">한 줄 소개 · 눌러서 고칠 수 있어요</p><p className="note2">표지 이미지를 올리지 않으면 장르 분위기 그림이 표지로 쓰여요.</p></div></div>
      <h3 className="st">시놉시스</h3>
      <div className="wtext ovsyn" contentEditable suppressContentEditableWarning role="textbox" aria-label="시놉시스" data-ph="전체 줄거리를 적어 보세요." onBlur={(e) => vm.saveNotes({ synopsis: (e.currentTarget.textContent ?? '').trim() })}>{w.synopsis || w.summary || ''}</div>
      <h3 className="st">스토리 흐름 <small className="muted">보드에서 자동 정리</small></h3>
      <div className="ovflow">
        {Object.entries(LINE).map(([k, l]) => <div key={k}><b>{l} · {grp(k).length}</b>{grp(k).length ? grp(k).map((e) => <DocBtn key={e.id} id={w.id} d={e} className="wev"><span>{e.ep}화</span>{e.t}</DocBtn>) : <p className="muted small">없음</p>}</div>)}
        <div><b>시점 미정 · {und.length}</b>{und.length ? und.map((e) => <DocBtn key={e.id} id={w.id} d={e} className="wev"><span>미정</span>{e.t}</DocBtn>) : <p className="muted small">없음</p>}</div>
      </div>
    </div>
  )
}

/** 목업 boardView(w). ponytail: 계기·복선 연결선(drawLinks)과 보드에서 새 사건 만들기는 옮기지 않았어요. */
export function BoardView({ vm }: { vm: VM }) {
  const w = vm.studio!.work, id = w.id
  const [q] = useSearchParams()
  const by = q.get('by') || 'line', flt = q.get('fl') || 'all'
  const N = epsOf(w).length + 1
  const evs = vm.docs.filter((d) => d.cat === 'event' && (flt === 'all' || d.line === flt))
  const und = evs.filter((d) => !d.ep)
  const chars = vm.docs.filter((d) => d.cat === 'char')
  const rows = by === 'char' ? chars.map((c) => ({ k: c.t, lab: c.t, ev: evs.filter((e) => e.ep && (e.who ?? []).includes(c.t)) })) : Object.entries(LINE).map(([k, l]) => ({ k, lab: l, ev: evs.filter((e) => e.ep && e.line === k) }))
  const first = (n: string) => { const e = vm.docs.filter((d) => d.cat === 'event' && d.ep && (d.who ?? []).includes(n)).map((d) => d.ep!); return e.length ? Math.min(...e) : 0 }
  const cells = (f: (n: number) => ReactNode) => Array.from({ length: N }, (_, i) => <div className="bcell" key={i}>{f(i + 1)}</div>)
  return (
    <div className="board">
      <div className="btool">
        <div className="sortt"><Go to={`/studio/${id}?view=board&by=line&fl=${flt}`} className={by === 'line' ? 'on' : ''}>라인별</Go><Go to={`/studio/${id}?view=board&by=char&fl=${flt}`} className={by === 'char' ? 'on' : ''}>캐릭터별 정렬</Go></div>
        <div className="sortt" aria-label="필터"><Go to={`/studio/${id}?view=board&by=${by}&fl=all`} className={flt === 'all' ? 'on' : ''}>전체</Go>{Object.entries(LINE).map(([k, l]) => <Go key={k} to={`/studio/${id}?view=board&by=${by}&fl=${k}`} className={flt === k ? 'on' : ''}>{l}</Go>)}</div>
      </div>
      {w.parent && <div className="note2 wnote">회색 테두리 = 원작 {w.forkAt}화까지의 스냅샷 사건 · 이후는 이 포크 소설에서 생긴 사건이에요.</div>}
      <div className="bwrap"><div className="bgrid" style={{ '--n': N } as CSSProperties}>
        <div className="bund"><b>시점 미정</b>{und.length ? und.map((e) => <DocBtn key={e.id} id={id} d={e} className={`bcard ${e.line}`}>{e.t}<small>#미정</small><em>{LINE[e.line ?? '']}</em></DocBtn>) : <small className="muted">없음</small>}</div>
        <div className="bmain"><div className="baxis">{Array.from({ length: N }, (_, i) => <span key={i} className={i + 1 === N ? 'now' : ''}>{i + 1}화{i + 1 === N ? ' · 쓰는 중' : ''}</span>)}</div>
          {rows.map((r) => <div className="brow" key={r.k}><b className="blab">{r.lab}</b><div className="bcells">{cells((n) => r.ev.filter((e) => e.ep === n).map((e) => <DocBtn key={e.id} id={id} d={e} className={`bcard ${e.line} ${w.parent && e.ep! <= (w.forkAt ?? 0) ? 'snap' : ''}`}>{e.t}<small>#{e.ep}화</small><em>{LINE[e.line ?? '']}</em></DocBtn>))}</div></div>)}
          <div className="brow chars"><b className="blab">등장</b><div className="bcells">{cells((n) => chars.filter((c) => first(c.t) === n).map((c) => {
            const ks = Object.keys(c.props).filter((k) => k !== '설명')
            return <DocBtn key={c.id} id={id} d={c} className="bchar">▲ <b>{c.t}</b> 등장<small>{ks.length ? `${ks[0]}: ${c.props[ks[0]]}${ks.length > 1 ? ` 외 ${ks.length - 1}` : ''}` : ''}</small></DocBtn>
          }))}</div></div>
        </div>
      </div></div>
      <p className="note2" style={{ marginTop: 10 }}>카드를 누르면 사전 문서가 열려요. 사건의 회차·라인·등장 인물·계기 연결은 문서에서 바꿀 수 있어요.</p>
    </div>
  )
}

/** 목업 linkify(): 다른 문서 이름을 분류 색 링크로 그립니다. */
const Linked = ({ id, docs, cats, text, self }: { id: string; docs: Doc[]; cats: WikiCat[]; text: string; self: string }) => <>{linkParts(docs, text, self).map((p, i) => typeof p === 'string' ? p : <DocBtn key={i} id={id} d={p} className="wl" style={{ '--dc': (cats.find((c) => c.id === p.cat) ?? { c: '#999' }).c } as CSSProperties}>{p.t}</DocBtn>)}</>

/** 목업 contenteditable + blur 저장. 저장된 값이 바뀌면 key로 다시 그려 React와 DOM 내용을 맞춥니다. */
const Editable = ({ as: Tag = 'div', value, onSave, children, ...props }: { as?: 'div' | 'h1' | 'th' | 'td'; value: string; onSave: (v: string) => void; children?: ReactNode; className?: string; 'data-ph'?: string; 'aria-label'?: string }) =>
  <Tag key={value} {...props} contentEditable suppressContentEditableWarning spellCheck={false} onBlur={(e) => { const v = (e.currentTarget.innerText ?? e.currentTarget.textContent ?? '').trim(); if (v !== value) onSave(v) }}>{children ?? value}</Tag>

type Form = Parameters<typeof FormSheet>[0]

/** 목업 wikiView(w). ponytail: 사건 편집·시점별 값·지식·표 보기·대표 이미지는 다음 단계(G2b·G2c)에서 옮겨요. */
export function WikiView({ vm }: { vm: VM }) {
  const w = vm.studio!.work, id = w.id, docs = vm.docs, cats = vm.cats
  const catOf = (x: string) => cats.find((c) => c.id === x) ?? { id: x, n: x, c: '#999' }
  const [form, setForm] = useState<Omit<Form, 'onClose'> | null>(null)
  const [q] = useSearchParams()
  const query = (q.get('q') ?? '').trim(), cat = q.get('cat') || 'char', chk = !!q.get('chk')
  const doc = docs.find((d) => d.id === q.get('doc'))
  const [search, setSearch] = useState(query)
  const ck = checkItems(docs)
  const L = query ? docs.filter((d) => (d.t + ' ' + d.alias.join(' ') + ' ' + d.body).includes(query)) : null
  const list = (ds: Doc[], empty: string, small?: (d: Doc) => string) => <div className="wlist">{ds.length ? ds.map((d) => <DocBtn key={d.id} id={id} d={d}><i style={{ background: catOf(d.cat).c }} />{d.t}{small && <small>{small(d)}</small>}</DocBtn>) : <p className="muted small">{empty}</p>}</div>
  let main
  if (L) main = <><h2 className="wh">검색 결과 <small>{L.length}</small></h2>{list(L, '찾는 문서가 없어요.', (d) => catOf(d.cat).n)}</>
  else if (chk) main = <><h2 className="wh">설정 점검 <small>항목 {ck.n}</small></h2>
    <h4 className="wsh">시점 미정 사건 <small>{ck.und.length}</small></h4><p className="note2">보드 ‘시점 미정’에 있는 사건이에요. 사건 문서에서 회차를 정하면 시간축으로 옮겨져요.</p>{list(ck.und, '없어요.', () => '미정')}
    <h4 className="wsh">등장 사건이 없는 캐릭터 <small>{ck.lone.length}</small></h4><p className="note2">어느 사건에도 연결되지 않은 인물이에요. 사건 문서의 등장 인물에 추가해 보세요.</p>{list(ck.lone, '없어요.')}</>
  else if (doc) {
    const c = catOf(doc.cat), isEv = doc.cat === 'event'
    const evs = docs.filter((d) => d.cat === 'event' && (d.who ?? []).includes(doc.t)).sort((a, b) => (a.ep || 99) - (b.ep || 99))
    const men = mentions(docs, doc)
    main = (
      <div className="wdoc">
        <div className="wmeta"><span className="wcl"><i style={{ background: c.c }} />{c.n}</span>{doc.cat === 'char' && <span className="muted small">보드에서 보기 · {evs.length}</span>}<button type="button" className="btn sm" style={{ marginLeft: 'auto' }} onClick={() => vm.deleteDoc(doc.id)}>삭제</button></div>
        <Editable as="h1" className="wt" value={doc.t} onSave={(v) => vm.setDocText(doc.id, 't', v)} />
        <div className="wrow"><span>별칭</span><div>{doc.alias.map((a, i) => <em className="wchip" key={i}>{a}<button type="button" aria-label="별칭 삭제" onClick={() => vm.removeAlias(doc.id, i)}>✕</button></em>)}<button type="button" className="wadd" onClick={() => setForm({ title: '별칭 추가', fields: [{ name: 'a', label: '별칭', req: true }], onOk: (o) => vm.addDocChip(doc.id, 'alias', o.a) })}>＋ 별칭</button></div></div>
        <div className="wrow"><span>태그</span><div>{doc.tags.map((t, i) => <em className="wchip" key={i}>{t}</em>)}<button type="button" className="wadd" onClick={() => setForm({ title: '태그 추가', fields: [{ name: 'a', label: '태그', req: true }], onOk: (o) => vm.addDocChip(doc.id, 'tags', o.a) })}>＋ 태그</button></div></div>
        {isEv && <><div className="wrow"><span>시점</span><div>{doc.ep ? doc.ep + '화' : '미정'} · {LINE[doc.line ?? '']}</div></div>
          <div className="wrow"><span>등장 인물</span><div>{(doc.who ?? []).map((n) => <em className="wchip" key={n}>{n}</em>)}</div></div>
          <div className="wrow"><span>이어지는 사건</span><div>{(doc.links ?? []).map((l) => <em className="wchip" key={l.to}>{l.k} → {docs.find((d) => d.id === l.to)?.t}</em>)}</div></div></>}
        <div className="wbody2"><div>
          {!isEv && <><table className="wprops"><tbody>{Object.entries(propsAt(doc, 0)).map(([k, v]) => <tr key={k}><Editable as="th" aria-label={`속성 이름 ${k}`} value={k} onSave={(nk) => vm.renameDocProp(doc.id, k, nk)} /><Editable as="td" aria-label={`${k} 값`} value={v} onSave={(nv) => vm.setDocProp(doc.id, k, nv)}><Linked id={id} docs={docs} cats={cats} text={v} self={doc.id} /></Editable></tr>)}</tbody></table>
            <button type="button" className="wadd" onClick={() => setForm({ title: '속성 추가', fields: [{ name: 'k', label: '속성 이름 (예: 관계, 능력, 소속)', req: true }, { name: 'v', label: '값' }], onOk: (o) => vm.addDocProp(doc.id, o.k, o.v) })}>＋ 속성 추가</button></>}
          <Editable className="wtext" aria-label="문서 본문" data-ph="내용을 적어 보세요. 다른 문서 이름을 쓰면 자동으로 연결돼요." value={doc.body} onSave={(v) => vm.setDocText(doc.id, 'body', v)}><Linked id={id} docs={docs} cats={cats} text={doc.body} self={doc.id} /></Editable>
        </div></div>
        {doc.cat === 'char' && <section className="wsec"><h4>보드 연동 <small>자동 표시</small></h4><div className="wtwo"><div><small className="muted">등장 사건</small>{evs.length ? evs.map((e) => <DocBtn key={e.id} id={id} d={e} className="wev"><span>{e.ep ? e.ep + '화' : '미정'}</span>{e.t}<em className={`ln ${e.line}`}>{LINE[e.line ?? '']}</em></DocBtn>) : <p className="muted small">아직 없어요.</p>}</div>
          <div><small className="muted">상태 변화 이력</small>{Object.keys(doc.at).length ? Object.keys(doc.at).map(Number).sort((a, b) => a - b).map((k) => <div className="wev" key={k}><span>{k}화</span>상태: {doc.at[k].상태 ?? Object.values(doc.at[k])[0]}</div>) : <p className="muted small">아직 없어요.</p>}</div></div></section>}
        <section className="wsec"><h4>이 문서를 언급한 문서 <small>{men.length}</small></h4>{men.length ? men.map((m) => <DocBtn key={m.id} id={id} d={m} className="wmen"><b>{m.t}</b><small>{catOf(m.cat).n}</small><span>{(m.body || Object.values(m.props).join(' · ')).slice(0, 70)}</span></DocBtn>) : <p className="muted small">아직 없어요.</p>}</section>
      </div>
    )
  } else {
    const c = catOf(cat), ds = docs.filter((d) => d.cat === cat)
    main = <><h2 className="wh"><i style={{ background: c.c }} />{c.n} <small>문서 {ds.length}</small></h2>{list(ds, '아직 문서가 없어요. ＋ 새 문서로 만들어 보세요.', (d) => (d.cat === 'event' ? `${d.ep ? d.ep + '화' : '미정'} · ${LINE[d.line ?? '']}` : ''))}</>
  }
  const openCat = doc ? doc.cat : cat
  return (
    <div className="wiki">
      <aside className="wside">
        <form className="wq" role="search" onSubmit={(e) => { e.preventDefault(); vm.goWiki(search) }}><span aria-hidden="true">🔍</span><input name="q" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="사전 검색 (제목·별칭·본문)" aria-label="사전 검색" /></form>
        <div className="wbtns"><button type="button" className="btn sm pri" id="wnew" onClick={() => setForm({ title: '새 문서 · ' + catOf(openCat).n, fields: [{ name: 't', label: '제목', req: true }, { name: 'cat', label: '분류', opts: cats.map((c) => [c.id, c.n]), value: openCat }], onOk: (o) => vm.addDoc(o.cat, o.t) })}>＋ 새 문서</button><button type="button" className="btn sm" onClick={() => setForm({ title: '새 분류', fields: [{ name: 'n', label: '분류 이름', req: true }], onOk: (o) => vm.addCategory(o.n) })}>＋ 분류</button></div>
        <Go to={`/studio/${id}?view=wiki&chk=1`} className={`wcheck ${chk ? 'on' : ''}`}>☑ 설정 점검 <span>{ck.n}</span></Go>
        {cats.map((c) => {
          const ds = docs.filter((d) => d.cat === c.id), open = openCat === c.id && !chk
          return <div className={`wcat ${open ? 'open' : ''}`} key={c.id}><Go to={`/studio/${id}?view=wiki&cat=${c.id}`}><i style={{ background: c.c }} />{c.n}{c.lock ? <> <small title="기본 분류">🔒</small></> : null}<span>{ds.length}</span></Go>
            {open && <div className="wdocs">{ds.map((d) => <DocBtn key={d.id} id={id} d={d} className={doc?.id === d.id ? 'on' : ''}>{d.t}</DocBtn>)}</div>}</div>
        })}
      </aside>
      <section className="wmain">{w.parent && <div className="note2 wnote">이 사전은 원작 {w.forkAt}화 시점 스냅샷에서 만들었어요. 여기서 고쳐도 원작 사전은 바뀌지 않아요.</div>}{main}</section>
      {form && <FormSheet {...form} onClose={() => setForm(null)} />}
    </div>
  )
}

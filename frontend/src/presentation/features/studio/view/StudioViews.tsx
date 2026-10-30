import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { useSearchParams } from 'react-router'

import { checkItems, LINE, linkParts, mentions, narrativeOrder, propsAt, type Doc, type WikiCat } from '../../../../domain/entities/wiki'
import { epsOf } from '../../../../domain/entities/work'
import { CoverOf } from '../../../shared/art'
import { toast } from '../../../shared/events'
import { Go } from '../../../shared/Go'
import { resizeImg } from '../../../shared/resizeImg'
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

const DocBtn = ({ id, d, children, ...props }: { id: string; d: Doc; children: ReactNode; className?: string; style?: CSSProperties; 'data-bid'?: string }) => <Go to={`/studio/${id}?view=wiki&doc=${encodeURIComponent(d.id)}`} {...props}>{children}</Go>

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

/** 목업 overviewView(w) */
export function OverviewView({ vm }: { vm: VM }) {
  const w = vm.studio!.work
  const evs = vm.docs.filter((d) => d.cat === 'event')
  const grp = (k: string) => evs.filter((e) => e.ep && e.line === k).sort((a, b) => a.ep! - b.ep!)
  const und = evs.filter((e) => !e.ep)
  return (
    <div className="ovw">
      <div className="ovtop"><label className="ovcov"><CoverOf w={w} /><span>표지 바꾸기</span><input type="file" accept="image/*" hidden onChange={(e) => resizeImg(e.target.files?.[0], async (url) => { await vm.saveNotes({ coverImg: url }); toast('표지 이미지를 바꿨어요') })} /></label><div><span className="chip">{w.genre}</span>
        <h2 contentEditable suppressContentEditableWarning spellCheck={false} aria-label="한 줄 소개" onBlur={(e) => vm.saveNotes({ hook: (e.currentTarget.textContent ?? '').trim() })}>{w.hook || w.dir || ''}</h2>
        <p className="muted small">한 줄 소개 · 눌러서 고칠 수 있어요</p>{w.coverImg ? <button type="button" className="btn sm" onClick={async () => { await vm.saveNotes({ coverImg: null }); toast('표지 이미지를 지웠어요') }}>표지 이미지 지우기</button> : <p className="note2">표지 이미지를 올리지 않으면 장르 분위기 그림이 표지로 쓰여요.</p>}</div></div>
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

/** 목업 boardView(w)·drawLinks(w) */
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
  const [form, setForm] = useState(false)
  const wrap = useRef<HTMLDivElement>(null)
  const [lines, setLines] = useState<{ d: string; x: number; y: number; k: string }[]>([])
  const [size, setSize] = useState([0, 0])
  const draw = () => {
    const wr = wrap.current
    if (!wr) return
    const R = wr.getBoundingClientRect(), box = (bid: string) => wr.querySelector(`[data-bid="${bid}"]`)?.getBoundingClientRect()
    setSize([wr.scrollWidth, wr.scrollHeight])
    setLines(evs.flatMap((d) => (d.links ?? []).flatMap((l) => {
      const A = box(d.id), B = box(l.to)
      if (!A || !B) return []
      const x1 = A.right - R.left + wr.scrollLeft, y1 = A.top + A.height / 2 - R.top + wr.scrollTop, x2 = B.left - R.left + wr.scrollLeft - 2, y2 = B.top + B.height / 2 - R.top + wr.scrollTop, mx = (x1 + x2) / 2
      return [{ d: `M${x1} ${y1}C${mx} ${y1} ${mx} ${y2} ${x2} ${y2}`, x: mx, y: (y1 + y2) / 2 - 6, k: l.k }]
    })))
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- 카드 배치가 바뀔 때마다 다시 그립니다.
  useLayoutEffect(draw, [vm.docs, by, flt])
  return (
    <div className="board">
      <div className="btool">
        <div className="sortt"><Go to={`/studio/${id}?view=board&by=line&fl=${flt}`} className={by === 'line' ? 'on' : ''}>라인별</Go><Go to={`/studio/${id}?view=board&by=char&fl=${flt}`} className={by === 'char' ? 'on' : ''}>캐릭터별 정렬</Go></div>
        <div className="sortt" aria-label="필터"><Go to={`/studio/${id}?view=board&by=${by}&fl=all`} className={flt === 'all' ? 'on' : ''}>전체</Go>{Object.entries(LINE).map(([k, l]) => <Go key={k} to={`/studio/${id}?view=board&by=${by}&fl=${k}`} className={flt === k ? 'on' : ''}>{l}</Go>)}</div>
        <button type="button" className="btn sm pri" style={{ marginLeft: 'auto' }} onClick={() => setForm(true)}>＋ 사건</button>
      </div>
      {w.parent && <div className="note2 wnote">회색 테두리 = 원작 {w.forkAt}화까지의 스냅샷 사건 · 이후는 이 포크 소설에서 생긴 사건이에요.</div>}
      <div className="bwrap" ref={wrap} onScroll={draw}><div className="bgrid" style={{ '--n': N } as CSSProperties}>
        <div className="bund"><b>시점 미정</b>{und.length ? und.map((e) => <DocBtn key={e.id} id={id} d={e} data-bid={e.id} className={`bcard ${e.line}`}>{e.t}<small>#미정</small><em>{LINE[e.line ?? '']}</em></DocBtn>) : <small className="muted">없음</small>}</div>
        <div className="bmain"><div className="baxis">{Array.from({ length: N }, (_, i) => <span key={i} className={i + 1 === N ? 'now' : ''}>{i + 1}화{i + 1 === N ? ' · 쓰는 중' : ''}</span>)}</div>
          {rows.map((r) => <div className="brow" key={r.k}><b className="blab">{r.lab}</b><div className="bcells">{cells((n) => r.ev.filter((e) => e.ep === n).map((e) => <DocBtn key={e.id} id={id} d={e} data-bid={e.id} className={`bcard ${e.line} ${w.parent && e.ep! <= (w.forkAt ?? 0) ? 'snap' : ''}`}>{e.t}<small>#{e.ep}화</small><em>{LINE[e.line ?? '']}</em></DocBtn>))}</div></div>)}
          <div className="brow chars"><b className="blab">등장</b><div className="bcells">{cells((n) => chars.filter((c) => first(c.t) === n).map((c) => {
            const ks = Object.keys(c.props).filter((k) => k !== '설명')
            return <DocBtn key={c.id} id={id} d={c} className="bchar">▲ <b>{c.t}</b> 등장<small>{ks.length ? `${ks[0]}: ${c.props[ks[0]]}${ks.length > 1 ? ` 외 ${ks.length - 1}` : ''}` : ''}</small></DocBtn>
          }))}</div></div>
        </div>
      </div><svg className="blinks" width={size[0]} height={size[1]} aria-hidden="true"><defs><marker id="ah" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0 0L8 4 0 8z" fill="currentColor" /></marker></defs>
        {lines.map((l, i) => <g key={i}><path d={l.d} className={l.k === '복선' ? 'dash' : ''} markerEnd="url(#ah)" /><text x={l.x} y={l.y}>{l.k}</text></g>)}</svg></div>
      {form && <FormSheet title="사건 추가" onClose={() => setForm(false)} fields={[{ name: 't', label: '사건 이름', req: true }, { name: 'ep', label: '시점', value: String(N), opts: [['', '미정'], ...Array.from({ length: N }, (_, i): [string, string] => [String(i + 1), `${i + 1}화${i + 1 === N ? ' (쓰는 중)' : ''}`])] }, { name: 'line', label: '라인', value: 'm', opts: Object.entries(LINE) }, { name: 'who', label: '등장 인물', checks: chars.map((c) => c.t) }]}
        onOk={(o, fd) => vm.addBoardEvent(o.t, o.ep ? +o.ep : undefined, o.line, fd.getAll('who').map(String))} />}
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

/** 목업 wikiView(w). ponytail: 지식·표 보기·대표 이미지는 다음 단계(G2c)에서 옮겨요. */
export function WikiView({ vm }: { vm: VM }) {
  const w = vm.studio!.work, id = w.id, docs = vm.docs, cats = vm.cats
  const catOf = (x: string) => cats.find((c) => c.id === x) ?? { id: x, n: x, c: '#999' }
  const [form, setForm] = useState<Omit<Form, 'onClose'> | null>(null)
  const [q, setQ] = useSearchParams()
  const ep = Number(q.get('ep')) || 0, eps = epsOf(w).length + 1
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
    const hist: [number, string][] = [...(evs[0]?.ep ? [[evs[0].ep, '▲ 등장'] as [number, string]] : []), ...Object.keys(doc.at).map(Number).sort((a, b) => a - b).map((k): [number, string] => [k, '상태: ' + (doc.at[k].상태 ?? Object.values(doc.at[k])[0])])]
    main = (
      <div className="wdoc">
        <div className="wmeta"><span className="wcl"><i style={{ background: c.c }} />{c.n}</span>{doc.cat === 'char' && <span className="muted small">보드에서 보기 · {evs.length}</span>}<button type="button" className="btn sm" style={{ marginLeft: 'auto' }} data-lock onClick={() => vm.deleteDoc(doc.id)}>삭제</button></div>
        <Editable as="h1" className="wt" value={doc.t} onSave={(v) => vm.setDocText(doc.id, 't', v)} />
        <div className="wrow"><span>별칭</span><div>{doc.alias.map((a, i) => <em className="wchip" key={i}>{a}<button type="button" aria-label="별칭 삭제" data-lock onClick={() => vm.removeAlias(doc.id, i)}>✕</button></em>)}<button type="button" className="wadd" data-lock onClick={() => setForm({ title: '별칭 추가', fields: [{ name: 'a', label: '별칭', req: true }], onOk: (o) => vm.addDocChip(doc.id, 'alias', o.a) })}>＋ 별칭</button></div></div>
        <div className="wrow"><span>태그</span><div>{doc.tags.map((t, i) => <em className="wchip" key={i}>{t}</em>)}<button type="button" className="wadd" data-lock onClick={() => setForm({ title: '태그 추가', fields: [{ name: 'a', label: '태그', req: true }], onOk: (o) => vm.addDocChip(doc.id, 'tags', o.a) })}>＋ 태그</button></div></div>
        {isEv ? <><div className="wrow"><span>시점</span><div><select className="inp sm" aria-label="사건 시점" value={doc.ep ?? ''} onChange={(e) => vm.setEvent(doc.id, { ep: e.target.value ? +e.target.value : undefined, line: doc.line })}><option value="">미정</option>{Array.from({ length: eps }, (_, i) => <option key={i} value={i + 1}>{i + 1}화{i + 1 === eps ? ' (쓰는 중)' : ''}</option>)}</select>
            <select className="inp sm" aria-label="사건 라인" value={doc.line} onChange={(e) => vm.setEvent(doc.id, { ep: doc.ep, line: e.target.value })}>{Object.entries(LINE).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></div></div>
          <div className="wrow"><span>등장 인물</span><div>{docs.filter((d) => d.cat === 'char').map((ch) => { const on = (doc.who ?? []).includes(ch.t); return <button type="button" key={ch.id} className={`wchip tg ${on ? 'on' : ''}`} aria-pressed={on} data-lock onClick={() => vm.toggleWho(doc.id, ch.t)}>{ch.t}</button> })}</div></div>
          <div className="wrow"><span>이어지는 사건</span><div>{(doc.links ?? []).map((l, i) => { const t = docs.find((d) => d.id === l.to); return t && <em className="wchip" key={i}>{l.k} → {t.t}<button type="button" aria-label="연결 삭제" data-lock onClick={() => vm.removeLink(doc.id, i)}>✕</button></em> })}<button type="button" className="wadd" data-lock onClick={() => {
            const opts = docs.filter((e) => e.cat === 'event' && e.id !== doc.id).map((e): [string, string] => [e.id, (e.ep ? e.ep + '화 · ' : '미정 · ') + e.t])
            if (!opts.length) return toast('연결할 다른 사건이 없어요')
            setForm({ title: '이어지는 사건 연결', ok: '연결', fields: [{ name: 'to', label: '다음 사건', opts }, { name: 'k', label: '관계', value: '계기', opts: [['계기', '계기 (원인 → 결과)'], ['복선', '복선 (나중에 회수)']] }], onOk: (o) => vm.addLink(doc.id, o.to, o.k) })
          }}>＋ 계기·복선 연결</button></div></div></>
          : <div className="wrow"><span>시점</span><div><select className="inp sm" aria-label="시점" value={ep || ''} onChange={(e) => { const n = new URLSearchParams(q); if (e.target.value) n.set('ep', e.target.value); else n.delete('ep'); setQ(n) }}><option value="">문서 기본값</option>{Array.from({ length: eps - 1 }, (_, i) => <option key={i} value={i + 1}>{i + 1}화 시점</option>)}</select>{ep ? <small className="muted">{ep}화까지의 변화가 반영된 값이에요. 여기서 고치면 {ep}화 시점 값으로 저장돼요.</small> : null}</div></div>}
        <div className="wbody2"><div>
          {!isEv && <><table className="wprops"><tbody>{Object.entries(propsAt(doc, ep)).map(([k, v]) => <tr key={k}><Editable as="th" aria-label={`속성 이름 ${k}`} value={k} onSave={(nk) => vm.renameDocProp(doc.id, k, nk)} /><Editable as="td" aria-label={`${k} 값`} value={v} onSave={(nv) => vm.setDocProp(doc.id, k, nv, ep)}><Linked id={id} docs={docs} cats={cats} text={v} self={doc.id} /></Editable></tr>)}</tbody></table>
            <button type="button" className="wadd" data-lock onClick={() => setForm({ title: '속성 추가', fields: [{ name: 'k', label: '속성 이름 (예: 관계, 능력, 소속)', req: true }, { name: 'v', label: '값' }], onOk: (o) => vm.addDocProp(doc.id, o.k, o.v) })}>＋ 속성 추가</button></>}
          <Editable className="wtext" aria-label="문서 본문" data-ph="내용을 적어 보세요. 다른 문서 이름을 쓰면 자동으로 연결돼요." value={doc.body} onSave={(v) => vm.setDocText(doc.id, 'body', v)}><Linked id={id} docs={docs} cats={cats} text={doc.body} self={doc.id} /></Editable>
        </div>
          <label className="wimg">{doc.img ? <img src={doc.img} alt={`${doc.t} 대표 이미지`} /> : <span>대표 이미지<br /><small>클릭해 추가</small></span>}<input type="file" accept="image/*" hidden onChange={(e) => resizeImg(e.target.files?.[0], (url) => vm.setDocImg(doc.id, url))} /></label></div>
        {doc.cat === 'char' && <section className="wsec"><h4>인물의 시점별 지식</h4><p className="small muted">인물이 아는 시점과 독자에게 공개되는 시점은 따로 정해요. 공개 회차를 비우면 작가만 볼 수 있어요.</p><form id="knowledgeForm" onSubmit={(e) => {
          e.preventDefault()
          const f = e.currentTarget, v = (n: string) => (f.elements.namedItem(n) as HTMLInputElement).value
          const text = v('fact').trim(), knownAt = Number(v('knownAt')), publicAt = v('publicAt') ? Number(v('publicAt')) : undefined
          if (!text || !Number.isInteger(knownAt) || knownAt < 1 || (publicAt !== undefined && (!Number.isInteger(publicAt) || publicAt < 1))) return toast('내용과 올바른 회차를 입력해 주세요')
          vm.addKnowledge(doc.id, { text, knownAt, publicAt })
        }}><label className="field">알게 된 사실<input className="inp" name="fact" maxLength={120} required /></label><label className="field">인물이 아는 시작 회차<input className="inp" name="knownAt" type="number" min={1} step={1} required /></label><label className="field">독자 공개 시작 회차 (선택)<input className="inp" name="publicAt" type="number" min={1} step={1} /></label><button className="btn sm pri" type="submit">지식 추가</button></form>
          <ul>{doc.knowledge?.length ? doc.knowledge.map((k, i) => <li key={i}>{k.text} · 인지 {k.knownAt}화 · {k.publicAt ? `독자 공개 ${k.publicAt}화` : '독자 비공개'} <button type="button" className="btn sm" onClick={() => vm.removeKnowledge(doc.id, i)}>삭제</button></li>) : <li>등록된 지식이 없어요.</li>}</ul></section>}
        {doc.cat === 'char' && <section className="wsec"><h4>보드 연동 <small>자동 표시</small></h4><div className="wtwo"><div><small className="muted">등장 사건</small>{evs.length ? evs.map((e) => <DocBtn key={e.id} id={id} d={e} className="wev"><span>{e.ep ? e.ep + '화' : '미정'}</span>{e.t}<em className={`ln ${e.line}`}>{LINE[e.line ?? '']}</em></DocBtn>) : <p className="muted small">아직 없어요.</p>}</div>
          <div><small className="muted">상태 변화 이력</small>{hist.length ? hist.map(([k, t], i) => <div className="wev" key={i}><span>{k}화</span>{t}</div>) : <p className="muted small">아직 없어요.</p>}</div></div></section>}
        <section className="wsec"><h4>이 문서를 언급한 문서 <small>{men.length}</small></h4>{men.length ? men.map((m) => <DocBtn key={m.id} id={id} d={m} className="wmen"><b>{m.t}</b><small>{catOf(m.cat).n}</small><span>{(m.body || Object.values(m.props).join(' · ')).slice(0, 70)}</span></DocBtn>) : <p className="muted small">아직 없어요.</p>}</section>
      </div>
    )
  } else {
    const c = catOf(cat), ds = docs.filter((d) => d.cat === cat), ct = q.get('ct') || 'list'
    const keys = [...new Set(ds.flatMap((d) => Object.keys(propsAt(d, ep))))].slice(0, 7)
    const tl = (d: Doc) => <DocBtn id={id} d={d} className="wl" style={{ '--dc': c.c } as CSSProperties}>{d.t}</DocBtn>
    main = <><h2 className="wh"><i style={{ background: c.c }} />{c.n} <small>문서 {ds.length}</small></h2>
      <div className="sortt" style={{ margin: '10px 0 14px' }}><Go to={`/studio/${id}?view=wiki&cat=${cat}&ct=list`} className={ct === 'list' ? 'on' : ''}>문서 목록</Go><Go to={`/studio/${id}?view=wiki&cat=${cat}&ct=table`} className={ct === 'table' ? 'on' : ''}>표</Go></div>
      {ct === 'table' && cat !== 'event' ? <><div className="wrow"><span>시점</span><div><select className="inp sm" aria-label="시점" value={ep || ''} onChange={(e) => { const n = new URLSearchParams(q); if (e.target.value) n.set('ep', e.target.value); else n.delete('ep'); setQ(n) }}><option value="">문서 기본값</option>{epsOf(w).map((_, i) => <option key={i} value={i + 1}>{i + 1}화 시점</option>)}</select></div></div>
        <div className="wtbl"><table><tbody><tr><th>제목</th>{keys.map((k) => <th key={k}>{k}</th>)}</tr>{ds.map((d) => { const P = propsAt(d, ep); return <tr key={d.id}><td>{tl(d)}</td>{keys.map((k) => <Editable key={k} as="td" value={P[k] ?? ''} onSave={(v) => vm.setDocProp(d.id, k, v, ep)} />)}</tr> })}</tbody></table></div><p className="note2">셀을 눌러 바로 수정해요.</p></>
      : ct === 'table' ? <div className="wtbl"><table><tbody><tr><th>제목</th><th>시점</th><th>라인</th><th>등장 인물</th></tr>{[...ds].sort((a, b) => (a.ep || 99) - (b.ep || 99)).map((d) => <tr key={d.id}><td>{tl(d)}</td><td>{d.ep ? d.ep + '화' : '미정'}</td><td>{LINE[d.line ?? ''] || ''}</td><td>{(d.who ?? []).join(', ')}</td></tr>)}</tbody></table></div>
      : list(ds, '아직 문서가 없어요. ＋ 새 문서로 만들어 보세요.', (d) => (d.cat === 'event' ? `${d.ep ? d.ep + '화' : '미정'} · ${LINE[d.line ?? '']}` : ''))}</>
  }
  const openCat = doc ? doc.cat : cat
  const root = useRef<HTMLDivElement>(null), locked = !!vm.shared
  // 목업 bindStudio: 복사 전에는 편집 칸·선택·이미지 입력을 끄고, 편집 버튼은 안내만 띄웁니다.
  useEffect(() => { if (locked) root.current?.querySelectorAll<HTMLElement>('[contenteditable],select,input[type=file]').forEach((el) => { if (el.isContentEditable) el.contentEditable = 'false'; else (el as HTMLInputElement).disabled = true }) })
  const lock = (e: React.MouseEvent) => { if (locked && (e.target as HTMLElement).closest('[data-lock]')) { e.stopPropagation(); toast('먼저 연결된 공개 세계관을 복사해 주세요') } }
  return (
    <div className="wiki" ref={root} onClickCapture={lock}>
      <aside className="wside">
        <form className="wq" role="search" onSubmit={(e) => { e.preventDefault(); vm.goWiki(search) }}><span aria-hidden="true">🔍</span><input name="q" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="사전 검색 (제목·별칭·본문)" aria-label="사전 검색" /></form>
        <div className="wbtns"><button type="button" className="btn sm pri" data-lock id="wnew" onClick={() => setForm({ title: '새 문서 · ' + catOf(openCat).n, fields: [{ name: 't', label: '제목', req: true }, { name: 'cat', label: '분류', opts: cats.map((c) => [c.id, c.n]), value: openCat }], onOk: (o) => vm.addDoc(o.cat, o.t) })}>＋ 새 문서</button><button type="button" className="btn sm" data-lock onClick={() => setForm({ title: '새 분류', fields: [{ name: 'n', label: '분류 이름', req: true }], onOk: (o) => vm.addCategory(o.n) })}>＋ 분류</button></div>
        <Go to={`/studio/${id}?view=wiki&chk=1`} className={`wcheck ${chk ? 'on' : ''}`}>☑ 설정 점검 <span>{ck.n}</span></Go>
        {cats.map((c) => {
          const ds = docs.filter((d) => d.cat === c.id), open = openCat === c.id && !chk
          return <div className={`wcat ${open ? 'open' : ''}`} key={c.id}><Go to={`/studio/${id}?view=wiki&cat=${c.id}`}><i style={{ background: c.c }} />{c.n}{c.lock ? <> <small title="기본 분류">🔒</small></> : null}<span>{ds.length}</span></Go>
            {open && <div className="wdocs">{ds.map((d) => <DocBtn key={d.id} id={id} d={d} className={doc?.id === d.id ? 'on' : ''}>{d.t}</DocBtn>)}</div>}</div>
        })}
      </aside>
      <section className="wmain">{vm.shared && <div className="note2">연결한 공개 세계관을 수정하려면 내 세계관으로 복사해야 해요. {vm.shared.allowFork ? <button type="button" className="btn sm" onClick={vm.forkLinkedWorld}>{vm.shared.name} 복사 후 수정</button> : '소유자가 포크를 허용하지 않았어요.'}</div>}{w.parent && <div className="note2 wnote">이 사전은 원작 {w.forkAt}화 시점 스냅샷에서 만들었어요. 여기서 고쳐도 원작 사전은 바뀌지 않아요.</div>}{main}</section>
      {form && <FormSheet {...form} onClose={() => setForm(null)} />}
    </div>
  )
}

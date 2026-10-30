import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { useSearchParams } from 'react-router'

import { LINE, linkParts, mentions, narrativeOrder, propsAt, type Doc, type WikiCat } from '../../../../domain/entities/wiki'
import { epsOf } from '../../../../domain/entities/work'
import { CoverOf } from '../../../shared/art'
import { toast } from '../../../shared/events'
import { Go } from '../../../shared/Go'
import { resizeImg } from '../../../shared/resizeImg'
import type { useStudioViewModel } from '../viewmodel/useStudioViewModel'
import { FormSheet } from './StudioSheets'
import { Sheet } from '../../../shared/Sheet'

type VM = ReturnType<typeof useStudioViewModel>

/** 목업 studioViews(id, view) */
export function StudioTools({ id, view, ep }: { id: string; view: string; ep?: number }) {
  return (
    <nav className="svw" aria-label="집필 도구">
      {([['wiki', '사전'], ['narrative', '플롯'], ['write', '원고'], ['memo', '콘티']] as const).map(([k, l]) => (
        <Go key={k} to={`/studio/${id}?view=${k}${ep ? `&ep=${ep}` : ''}`} className={view === k ? 'on' : ''} aria-current={view === k ? 'page' : undefined}>{l}</Go>
      ))}
    </nav>
  )
}

/** 목업 memoView(w): 입력은 화면에 두고 바뀔 때마다 저장합니다. */
export function MemoView({ vm }: { vm: VM }) {
  const [memo, setMemo] = useState(vm.studio!.work.memo ?? '')
  return (
    <section className="memo-page"><h2>콘티</h2><p className="muted">장면과 대사를 콘티로 정리하세요. 원고에는 자동으로 반영되지 않습니다.</p>
      <div className="snippet-heading"><span /><button type="button" className="btn sm" disabled>＋ 새 콘티 · 목업</button></div>
      <div className="snippet-layout"><aside><b>내 콘티</b><div className="snippet-item">콘티 <small>작성 중</small></div></aside><div><label htmlFor="workMemo">콘티</label><p className="small muted">장면, 대사, 나중에 쓸 문장을 적어 두세요.</p><textarea id="workMemo" aria-label="콘티 내용" placeholder="콘티를 적어 두세요." value={memo} onChange={(e) => { setMemo(e.target.value); vm.saveNotes({ memo: e.target.value }) }} /></div></div>
    </section>
  )
}

const DocBtn = ({ id, d, children, ...props }: { id: string; d: Doc; children: ReactNode; className?: string; style?: CSSProperties }) => <Go to={`/studio/${id}?view=wiki&doc=${encodeURIComponent(d.id)}`} {...props}>{children}</Go>

function PlanWikiSidebar({ vm }: { vm: VM }) {
  const [openCat, setOpenCat] = useState<string | null>('char')
  return <aside className="wside" aria-label="플롯 사전 목록">
    <div className="wq"><input aria-label="사전 검색" placeholder="사전 검색 (목업)" disabled /></div>
    <div className="wbtns"><button type="button" className="btn sm pri" disabled>＋ 새 문서</button><button type="button" className="btn sm" disabled>＋ 분류</button></div>
    {vm.cats.filter((c) => c.id !== 'event').map((c) => {
      const docs = vm.docs.filter((d) => d.cat === c.id), open = openCat === c.id
      return <div className={`wcat ${open ? 'open' : ''}`} key={c.id}><button type="button" aria-expanded={open} onClick={() => setOpenCat(open ? null : c.id)}><i style={{ background: c.c }} />{c.n}{c.lock ? <small title="기본 분류">🔒</small> : null}<span>{docs.length}</span></button>
        {open && <div className="wdocs">{docs.map((d) => <button type="button" key={d.id} disabled>{d.t}</button>)}</div>}</div>
    })}
  </aside>
}

/** 목업 narrativeView(w) */
export function NarrativeView({ vm }: { vm: VM }) {
  const w = vm.studio!.work
  const ordered = narrativeOrder(w, vm.docs)
  const characters = vm.docs.filter((d) => d.cat === 'char')
  const chapters = [...new Set([...Array.from({ length: epsOf(w).length + 1 }, (_, i) => i + 1), ...ordered.map((d) => d.ep ?? 0)])].sort((a, b) => a - b)
  const [layout, setLayout] = useState<'grid' | 'matrix'>('grid')
  const [editing, setEditing] = useState<Doc | 'new' | null>(null)
  const [chapter, setChapter] = useState(0)
  const openNew = (ep: number) => { setChapter(ep); setEditing('new') }
  return (
    <div className="wiki"><PlanWikiSidebar vm={vm} /><section className="narrative-page"><h2>플롯</h2><p className="muted">막과 회차에 따라 사건과 장면을 정리하세요.</p>
      <div className="plan-toolbar"><b>이야기 구조</b><div className="text-ai-modes" aria-label="플롯 보기">{([['grid', '회차별 카드'], ['matrix', '등장 관계표']] as const).map(([key, label]) => <button type="button" key={key} className={`btn sm${layout === key ? ' pri' : ''}`} aria-pressed={layout === key} onClick={() => setLayout(key)}>{label}</button>)}</div></div>
      <div className="plan-act"><b>1막</b><span>이야기의 흐름</span><button type="button" className="btn sm" disabled>＋ 회차 · 목업</button></div>
      {layout === 'grid' ? <div className="plan-chapters">{chapters.map((ep) => <section className="plan-chapter" key={ep}><h3>{ep ? `${ep}화` : '회차 미정'}</h3>{ordered.filter((d) => (d.ep ?? 0) === ep).map((d, i) => <button type="button" className="plan-scene" key={d.id} onClick={() => setEditing(d)}><small>장면 {i + 1} · {LINE[d.line ?? ''] || '시점 미정'}</small><b>{d.t}</b><span>{d.body || '장면 내용을 정리해 보세요.'}</span><small>{d.who?.join(' · ') || '등장 인물 미정'}</small></button>)}<button type="button" className="btn sm" onClick={() => openNew(ep)}>사건 추가</button></section>)}</div> : <div className="wtbl plan-matrix"><p className="small muted">인물별로 등장하는 장면을 확인하세요. 장면을 선택하면 편집 화면이 열립니다.</p><table><thead><tr><th scope="col">인물</th>{ordered.map((d) => <th scope="col" key={d.id}><button type="button" onClick={() => setEditing(d)}>{d.ep ? `${d.ep}화 · ` : ''}{d.t}</button></th>)}</tr></thead><tbody>{characters.map((c) => <tr key={c.id}><th scope="row">{c.t}</th>{ordered.map((d) => <td key={d.id}>{d.who?.includes(c.t) ? '등장' : '—'}</td>)}</tr>)}</tbody></table><button type="button" className="btn sm" onClick={() => openNew(0)}>사건 추가</button></div>}
      {editing && <Sheet sid="U40" label={editing === 'new' ? '사건 추가' : '사건 편집'} onClose={() => setEditing(null)}><div className="studio-settings-head"><h3>{editing === 'new' ? '사건 추가' : '사건 편집'}</h3><button type="button" className="btn sm" onClick={() => setEditing(null)}>닫기</button></div><p className="small muted">화면 예시입니다. 입력한 내용은 저장되지 않습니다.</p><label className="field">사건 이름<input className="inp" defaultValue={editing === 'new' ? '' : editing.t} /></label><label className="field">회차<input className="inp" defaultValue={editing === 'new' ? (chapter || '') : (editing.ep || '')} /></label><label className="field">장면 내용<textarea className="ta" defaultValue={editing === 'new' ? '' : editing.body} /></label><label className="field">등장 인물<input className="inp" defaultValue={editing === 'new' ? '' : editing.who?.join(', ')} /></label><button type="button" className="btn pri" disabled>저장 · 목업</button></Sheet>}
    </section></div>
  )
}

/** 목업 overviewView(w) */
export function OverviewView({ vm }: { vm: VM }) {
  const w = vm.studio!.work
  return (
    <div className="ovw">
      <div className="ovtop"><label className="ovcov"><CoverOf w={w} /><span>표지 바꾸기</span><input type="file" accept="image/*" hidden onChange={(e) => resizeImg(e.target.files?.[0], async (url) => { await vm.saveNotes({ coverImg: url }); toast('표지 이미지를 바꿨어요') })} /></label><div><span className="chip">{w.genre}</span>
        <h2 contentEditable suppressContentEditableWarning spellCheck={false} aria-label="한 줄 소개" onBlur={(e) => vm.saveNotes({ hook: (e.currentTarget.textContent ?? '').trim() })}>{w.hook || w.dir || ''}</h2>
        <p className="muted small">한 줄 소개 · 눌러서 고칠 수 있어요</p>{w.coverImg ? <button type="button" className="btn sm" onClick={async () => { await vm.saveNotes({ coverImg: null }); toast('표지 이미지를 지웠어요') }}>표지 이미지 지우기</button> : <p className="note2">표지 이미지를 올리지 않으면 장르 분위기 그림이 표지로 쓰여요.</p>}</div></div>
      <h3 className="st">시놉시스</h3>
      <div className="wtext ovsyn" contentEditable suppressContentEditableWarning role="textbox" aria-label="시놉시스" data-ph="전체 줄거리를 적어 보세요." onBlur={(e) => vm.saveNotes({ synopsis: (e.currentTarget.textContent ?? '').trim() })}>{w.synopsis || w.summary || ''}</div>
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
  const w = vm.studio!.work, id = w.id, docs = vm.docs.filter((d) => d.cat !== 'event'), cats = vm.cats.filter((c) => c.id !== 'event')
  const catOf = (x: string) => cats.find((c) => c.id === x) ?? { id: x, n: x, c: '#999' }
  const [form, setForm] = useState<Omit<Form, 'onClose'> | null>(null)
  const [q, setQ] = useSearchParams()
  const ep = Number(q.get('ep')) || 0, eps = epsOf(w).length + 1
  const query = (q.get('q') ?? '').trim(), cat = q.get('cat') === 'event' ? 'char' : q.get('cat') || 'char'
  const doc = docs.find((d) => d.id === q.get('doc'))
  const [search, setSearch] = useState(query)
  const L = query ? docs.filter((d) => (d.t + ' ' + d.alias.join(' ') + ' ' + d.body).includes(query)) : null
  const list = (ds: Doc[], empty: string, small?: (d: Doc) => string) => <div className="wlist">{ds.length ? ds.map((d) => <DocBtn key={d.id} id={id} d={d}><i style={{ background: catOf(d.cat).c }} />{d.t}{small && <small>{small(d)}</small>}</DocBtn>) : <p className="muted small">{empty}</p>}</div>
  let main
  if (L) main = <><h2 className="wh">검색 결과 <small>{L.length}</small></h2>{list(L, '찾는 문서가 없어요.', (d) => catOf(d.cat).n)}</>
  else if (doc) {
    const c = catOf(doc.cat)
    const men = mentions(docs, doc)
    const hist = Object.keys(doc.at).map(Number).sort((a, b) => a - b).map((k): [number, string] => [k, '상태: ' + (doc.at[k].상태 ?? Object.values(doc.at[k])[0])])
    main = (
      <div className="wdoc">
        <div className="wmeta"><span className="wcl"><i style={{ background: c.c }} />{c.n}</span><button type="button" className="btn sm" style={{ marginLeft: 'auto' }} data-lock onClick={() => vm.deleteDoc(doc.id)}>삭제</button></div>
        <div className="visibility-mock"><label>엔티티 공개 범위 <select aria-label="엔티티 공개 범위" disabled><option>공개 설정 · 목업</option><option>공개</option><option>비공개</option></select></label><p className="small muted">포크한 독자는 비공개 설정을 공개될 때까지 조회하거나 편집할 수 없도록 계획되어 있어요. 이 화면은 설정과 접근 제한이 작동하지 않는 목업입니다.</p></div>
        <Editable as="h1" className="wt" value={doc.t} onSave={(v) => vm.setDocText(doc.id, 't', v)} />
        <div className="wrow"><span>별칭</span><div>{doc.alias.map((a, i) => <em className="wchip" key={i}>{a}<button type="button" aria-label="별칭 삭제" data-lock onClick={() => vm.removeAlias(doc.id, i)}>✕</button></em>)}<button type="button" className="wadd" data-lock onClick={() => setForm({ title: '별칭 추가', fields: [{ name: 'a', label: '별칭', req: true }], onOk: (o) => vm.addDocChip(doc.id, 'alias', o.a) })}>＋ 별칭</button></div></div>
        <div className="wrow"><span>태그</span><div>{doc.tags.map((t, i) => <em className="wchip" key={i}>{t}</em>)}<button type="button" className="wadd" data-lock onClick={() => setForm({ title: '태그 추가', fields: [{ name: 'a', label: '태그', req: true }], onOk: (o) => vm.addDocChip(doc.id, 'tags', o.a) })}>＋ 태그</button></div></div>
        <div className="wrow"><span>시점</span><div><select className="inp sm" aria-label="시점" value={ep || ''} onChange={(e) => { const n = new URLSearchParams(q); if (e.target.value) n.set('ep', e.target.value); else n.delete('ep'); setQ(n) }}><option value="">문서 기본값</option>{Array.from({ length: eps - 1 }, (_, i) => <option key={i} value={i + 1}>{i + 1}화 시점</option>)}</select>{ep ? <small className="muted">{ep}화까지의 변화가 반영된 값이에요. 여기서 고치면 {ep}화 시점 값으로 저장돼요.</small> : null}</div></div>
        <div className="wbody2"><div>
          <table className="wprops"><tbody>{Object.entries(propsAt(doc, ep)).map(([k, v]) => <tr key={k}><Editable as="th" aria-label={`속성 이름 ${k}`} value={k} onSave={(nk) => vm.renameDocProp(doc.id, k, nk)} /><Editable as="td" aria-label={`${k} 값`} value={v} onSave={(nv) => vm.setDocProp(doc.id, k, nv, ep)}><Linked id={id} docs={docs} cats={cats} text={v} self={doc.id} /></Editable><td><select aria-label={`${k} 속성 공개 범위`} disabled><option>공개 설정 · 목업</option><option>공개</option><option>비공개</option></select></td></tr>)}</tbody></table>
            <button type="button" className="wadd" data-lock onClick={() => setForm({ title: '속성 추가', fields: [{ name: 'k', label: '속성 이름 (예: 관계, 능력, 소속)', req: true }, { name: 'v', label: '값' }], onOk: (o) => vm.addDocProp(doc.id, o.k, o.v) })}>＋ 속성 추가</button>
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
        {doc.cat === 'char' && <section className="wsec"><h4>상태 변화 이력</h4>{hist.length ? hist.map(([k, t]) => <div className="wev" key={k}><span>{k}화</span>{t}</div>) : <p className="muted small">아직 없어요.</p>}</section>}
        <section className="wsec"><h4>이 문서를 언급한 문서 <small>{men.length}</small></h4>{men.length ? men.map((m) => <DocBtn key={m.id} id={id} d={m} className="wmen"><b>{m.t}</b><small>{catOf(m.cat).n}</small><span>{(m.body || Object.values(m.props).join(' · ')).slice(0, 70)}</span></DocBtn>) : <p className="muted small">아직 없어요.</p>}</section>
      </div>
    )
  } else {
    const c = catOf(cat), ds = docs.filter((d) => d.cat === cat), ct = q.get('ct') || 'list'
    const keys = [...new Set(ds.flatMap((d) => Object.keys(propsAt(d, ep))))].slice(0, 7)
    const tl = (d: Doc) => <DocBtn id={id} d={d} className="wl" style={{ '--dc': c.c } as CSSProperties}>{d.t}</DocBtn>
    main = <><h2 className="wh"><i style={{ background: c.c }} />{c.n} <small>문서 {ds.length}</small></h2>
      <div className="sortt" style={{ margin: '10px 0 14px' }}><Go to={`/studio/${id}?view=wiki&cat=${cat}&ct=list`} className={ct === 'list' ? 'on' : ''}>문서 목록</Go><Go to={`/studio/${id}?view=wiki&cat=${cat}&ct=table`} className={ct === 'table' ? 'on' : ''}>표</Go></div>
      {ct === 'table' ? <><div className="wrow"><span>시점</span><div><select className="inp sm" aria-label="시점" value={ep || ''} onChange={(e) => { const n = new URLSearchParams(q); if (e.target.value) n.set('ep', e.target.value); else n.delete('ep'); setQ(n) }}><option value="">문서 기본값</option>{epsOf(w).map((_, i) => <option key={i} value={i + 1}>{i + 1}화 시점</option>)}</select></div></div>
        <div className="wtbl"><table><tbody><tr><th>제목</th>{keys.map((k) => <th key={k}>{k}</th>)}</tr>{ds.map((d) => { const P = propsAt(d, ep); return <tr key={d.id}><td>{tl(d)}</td>{keys.map((k) => <Editable key={k} as="td" value={P[k] ?? ''} onSave={(v) => vm.setDocProp(d.id, k, v, ep)} />)}</tr> })}</tbody></table></div><p className="note2">셀을 눌러 바로 수정해요.</p></>
      : list(ds, '아직 문서가 없어요. ＋ 새 문서로 만들어 보세요.')}</>
  }
  const openCat = doc ? doc.cat : cat
  const root = useRef<HTMLDivElement>(null), locked = !!vm.shared
  // 목업 bindStudio: 복사 전에는 편집 칸·선택·이미지 입력을 끄고, 편집 버튼은 안내만 띄웁니다.
  useEffect(() => { if (locked) root.current?.querySelectorAll<HTMLElement>('[contenteditable],select,input[type=file]').forEach((el) => { if (el.closest('.wiki-overview')) return; if (el.isContentEditable) el.contentEditable = 'false'; else (el as HTMLInputElement).disabled = true }) })
  const lock = (e: React.MouseEvent) => { if (locked && (e.target as HTMLElement).closest('[data-lock]')) { e.stopPropagation(); toast('먼저 연결된 공개 세계관을 복사해 주세요') } }
  return (
    <div className="wiki" ref={root} onClickCapture={lock}>
      <aside className="wside">
        <form className="wq" role="search" onSubmit={(e) => { e.preventDefault(); vm.goWiki(search) }}><span aria-hidden="true">🔍</span><input name="q" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="사전 검색 (제목·별칭·본문)" aria-label="사전 검색" /></form>
        <div className="wbtns"><button type="button" className="btn sm pri" data-lock id="wnew" onClick={() => setForm({ title: '새 문서 · ' + catOf(openCat).n, fields: [{ name: 't', label: '제목', req: true }, { name: 'cat', label: '분류', opts: cats.map((c) => [c.id, c.n]), value: openCat }], onOk: (o) => vm.addDoc(o.cat, o.t) })}>＋ 새 문서</button><button type="button" className="btn sm" data-lock onClick={() => setForm({ title: '새 분류', fields: [{ name: 'n', label: '분류 이름', req: true }], onOk: (o) => vm.addCategory(o.n) })}>＋ 분류</button></div>
        {cats.map((c) => {
          const ds = docs.filter((d) => d.cat === c.id), open = openCat === c.id
          return <div className={`wcat ${open ? 'open' : ''}`} key={c.id}><Go to={`/studio/${id}?view=wiki&cat=${c.id}`}><i style={{ background: c.c }} />{c.n}{c.lock ? <> <small title="기본 분류">🔒</small></> : null}<span>{ds.length}</span></Go>
            {open && <div className="wdocs">{ds.map((d) => <DocBtn key={d.id} id={id} d={d} className={doc?.id === d.id ? 'on' : ''}>{d.t}</DocBtn>)}</div>}</div>
        })}
      </aside>
      <section className="wmain">{vm.shared && <div className="note2">연결한 공개 세계관을 수정하려면 내 세계관으로 복사해야 해요. {vm.shared.allowFork ? <button type="button" className="btn sm" onClick={vm.forkLinkedWorld}>{vm.shared.name} 복사 후 수정</button> : '소유자가 포크를 허용하지 않았어요.'}</div>}{w.parent && <div className="note2 wnote">이 사전은 원작 {w.forkAt}화 시점 스냅샷에서 만들었어요. 여기서 고쳐도 원작 사전은 바뀌지 않아요.</div>}{!doc && <details className="wiki-overview" open><summary>작품 개요</summary><OverviewView vm={vm} /></details>}{main}</section>
      {form && <FormSheet {...form} onClose={() => setForm(null)} />}
    </div>
  )
}

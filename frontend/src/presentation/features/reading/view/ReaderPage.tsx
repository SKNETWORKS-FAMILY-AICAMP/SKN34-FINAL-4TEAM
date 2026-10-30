import { useEffect, useRef, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import { Navigate, useParams } from 'react-router'

import { avatarOf, epsOf, type Theme } from '../../../../domain/entities/work'
import { Go } from '../../../shared/Go'
import { BackChev } from '../../../shared/icons'
import { useFeedbackViewModel } from '../viewmodel/useFeedbackViewModel'
import { useReaderViewModel } from '../viewmodel/useReaderViewModel'
import { Amb } from './Amb'
import { UnavailableWork } from './WorkPage'
import { CommentSheet, FeedbackSheet, LookSheet } from './Sheets'

const NUM = ['一', '二', '三', '四', '五', '六', '七', '八']
const chapLabel = (t: Theme, n: number) => t === 'hanji' ? '第 ' + NUM[n - 1] + ' 回' : t === 'neon' ? 'CHANNEL ' + String(n).padStart(2, '0') : 'CHAPTER ' + n
const ORN: Record<Theme, string> = { hanji: '● ─────', star: '✦ ✧ ✦', neon: '// SIGNAL 72% · 7구역' }

/** 목업 bindReader의 window.onscroll: 진행률 바, 아래로 스크롤하면 바 숨김, 회차 끝이 보이면 U08 */
function useReaderScroll(ready: boolean, setEnd: (end: boolean) => void) {
  const prog = useRef<HTMLElement>(null)
  const top = useRef<HTMLDivElement>(null)
  const bottom = useRef<HTMLElement>(null)
  const end = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!ready) return
    let lastY = scrollY
    let atEnd: boolean | null = null
    const f = () => {
      const h = document.documentElement
      const p = h.scrollTop / (h.scrollHeight - h.clientHeight || 1)
      if (prog.current) prog.current.style.width = p * 100 + '%'
      const y = scrollY
      const hide = y > lastY && y > 120 && p <= 0.97
      top.current?.classList.toggle('hide', hide)
      bottom.current?.classList.toggle('hide', hide)
      lastY = y
      const e = !!end.current && end.current.getBoundingClientRect().top < innerHeight * 0.8
      if (e !== atEnd) setEnd((atEnd = e))
    }
    f()
    addEventListener('scroll', f, { passive: true })
    return () => removeEventListener('scroll', f)
  }, [ready, setEnd])
  return { prog, top, bottom, end }
}

/** 목업 reader(id,n): U05 회차 뷰어 · U08 회차 끝 */
export function ReaderPage() {
  const { id = '', n = '1' } = useParams()
  const vm = useReaderViewModel(id, +n || 1)
  const fb = useFeedbackViewModel()
  const r = vm.reader
  const refs = useReaderScroll(!!r, vm.setEnd)
  if (vm.state === undefined) return null
  if (vm.state === null) return <UnavailableWork />
  if (!r) return <Navigate replace to={`/work/${id}`} />
  const { work: w, ep: e } = r
  const eps = epsOf(w)
  const rk = w.id + r.n
  const selected = vm.selected && vm.sentences[vm.selected.k]
  let k = 0
  return (
    <div className={vm.readerClass} style={vm.readerVars as CSSProperties}>
      {vm.amb && <Amb t={w.theme} lite={vm.amb.lite} />}
      <div className="rbarr" id="rtop" ref={refs.top}>
        <div className="in">
          <Go to={`/work/${id}`} className="back rback" aria-label="소설 목록으로"><BackChev /><span>목록</span></Go>
          <div className="t"><b>{w.title}</b><small>{r.n}화 · {e.t}{w.parent && r.n <= (w.forkAt ?? 0) ? ' · 원작 스냅샷' : ''}</small></div>
          <button type="button" className="rib" aria-label="공유" onClick={vm.share}>↗</button>
          <button type="button" className="rib" aria-label="보기 설정" onClick={() => vm.openSheet({ kind: 'look' })}>Aa</button>
        </div>
        <div className="prog"><i id="prog" ref={refs.prog} /></div>
      </div>
      <article className="page">
        <div className="chap"><small>{chapLabel(w.theme, r.n)}</small><h2>{e.t}</h2><div className="orn">{ORN[w.theme]}</div><div className="reading"><i />지금 {30 + ((r.n * 37) % 90)}명이 함께 읽는 중 <span className="demo">데모</span></div></div>
        <div className="hint">☝ 문장을 누르면 댓글이나 피드백을 보낼 수 있어요. 소설 전체 신고는 상세 화면에서 할 수 있어요.</div>
        <div className="text" id="text">
          {r.paragraphs.map((ss, pi) => (
            <p key={pi}>{ss.map((s, j) => {
              const i = k++
              return <span key={j}>{j > 0 && ' '}<span className={`s${vm.selected?.k === i ? ' sel' : ''}`} data-s={i} onClick={(ev) => {
                const b = ev.currentTarget.getBoundingClientRect()
                vm.select({ k: i, top: b.bottom + scrollY + 8, left: Math.max(12, Math.min(b.left + scrollX, innerWidth - 420)) })
              }}>{s.t}</span></span>
            })}</p>
          ))}
        </div>
        {e.authorNote && <section className="author-note"><h3>작가의 말</h3><p>{e.authorNote}</p></section>}
        <div className="endmark" id="endmark" ref={refs.end}>— {r.n}화 끝 —</div>
        <div className="endgrid" id="end">
          {r.next ? (
            <Go to={`/read/${id}/${r.next}`} className="tcard nextc"><div><small>다음 화</small><b>{r.next}화 {eps[r.next - 1].t}</b></div><span style={{ fontSize: 22 }}>›</span></Go>
          ) : <div className="tcard nextc"><div><small>마지막 회차예요</small><b>다음 화를 기다려 주세요</b></div></div>}
          {r.canFork && (
            <div className="tcard ifend">
              <h3>여기서 포크해 볼까요?</h3>
              <p>{r.n}화가 끝난 시점의 세계관과 인물을 복사해서 나만의 다음 화를 쓸 수 있어요. 원작은 바뀌지 않아요.{r.forks.length > 0 && ` 이미 ${r.forks.length}편이 포크됐어요.`}</p>
              <div className="acts">
                <Go to="/writing-policy?method=fork" state={{ target: `/fork/${id}?at=${r.n}` }} className="tbtn pri" id="forkHere">✎ {r.n}화에서 포크하기</Go>
                {r.forks.map((f) => <Go key={f.id} to={`/work/${f.id}`} className="tbtn">「{f.title.split(': ')[1] || f.title}」 읽기</Go>)}
              </div>
            </div>
          )}
          <section className="tcard cms">
            <h3>댓글 {r.comments.length}</h3>
            <form className="cmf" id="cmf" onSubmit={(ev) => {
              ev.preventDefault()
              const input = ev.currentTarget.elements.namedItem('cmt')
              if (input instanceof HTMLInputElement) void fb.addComment(id, r.n, input.value, null).then((ok) => { if (ok) input.value = '' })
            }}>
              <input id="cmt" name="cmt" aria-label="댓글 입력" placeholder="감상이나 궁금한 점을 남겨 주세요" maxLength={200} />
              <button className="tbtn pri" style={{ height: 44 }}>등록</button>
            </form>
            {r.comments.map((c, i) => {
              const ck = rk + 'c' + i
              const on = !!r.liked[ck]
              return (
                <div className="cm" key={ck}>
                  <i className="av" style={{ background: avatarOf(c[0]) }} />
                  <div>
                    <b>{c[0]}{i === 0 && c[2] > 300 ? ' · BEST' : ''}</b>
                    {c[3]?.q && <q className="cq">{c[3].q}</q>}
                    {c[3]?.spoiler ? <details><summary>스포일러 댓글 보기</summary>{c[1]}</details> : c[1]}
                  </div>
                  <button type="button" className={`lk ${on ? 'on' : ''}`} onClick={() => void vm.toggleCommentLike(ck)}>{on ? '♥' : '♡'} {(c[2] || 0) + (on ? 1 : 0)}</button>
                </div>
              )
            })}
          </section>
        </div>
      </article>
      <nav className="rnav" id="rbot" ref={refs.bottom}>
        <div className="in">
          <Go to={`/read/${id}/${r.previous ?? r.n}`} disabled={!r.previous}>‹ 이전 화</Go>
          <Go to={`/work/${id}`}>목록</Go>
          <Go to={`/read/${id}/${r.next ?? r.n}`} disabled={!r.next}>다음 화 ›</Go>
        </div>
      </nav>
      {selected && vm.selected?.pop && createPortal(
        <div className="pop" style={{ top: vm.selected?.top, left: vm.selected?.left }}>
          <button type="button" onClick={() => vm.openSheet({ kind: 'comment', k: vm.selected?.k ?? 0 })}>💬 댓글 달기</button>
          <button type="button" onClick={() => vm.openSheet({ kind: 'feedback', k: vm.selected?.k ?? 0 })}>✉ 피드백 보내기</button>
          <button type="button" onClick={() => { vm.select(null); vm.shareSentence() }}>⧉ 문장 공유</button>
        </div>,
        document.body,
      )}
      {vm.sheet?.kind === 'look' && <LookSheet onClose={vm.closeSheet} />}
      {vm.sheet?.kind === 'comment' && <CommentSheet workId={id} n={r.n} sentence={vm.sentences[vm.sheet.k]} onClose={vm.closeSheet}
        onAdded={() => setTimeout(() => document.querySelector('.cm:last-of-type')?.scrollIntoView?.({ block: 'center' }), 60)} />}
      {vm.sheet?.kind === 'feedback' && <FeedbackSheet workId={id} n={r.n} sentence={vm.sentences[vm.sheet.k]} onClose={vm.closeSheet} />}
    </div>
  )
}

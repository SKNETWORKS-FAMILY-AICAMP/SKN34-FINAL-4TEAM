import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Navigate, useParams } from 'react-router'

import { avatarOf, epsOf, hiddenSourceEpisode, type Theme } from '../../../../domain/entities/work'
import { Go } from '../../../shared/Go'
import { ContentLoadState } from '../../../shared/ContentLoadState'
import { BackChev } from '../../../shared/icons'
import { ManuscriptText, StoredImage } from '../../../shared/media/MediaPanel'
import { useDocumentTitle } from '../../../shared/useDocumentTitle'
import { useFeedbackViewModel } from '../viewmodel/useFeedbackViewModel'
import { POP_GUTTER, popLeft } from '../viewmodel/sentencePop'
import { useReaderViewModel } from '../viewmodel/useReaderViewModel'
import { Amb } from './Amb'
import { EpisodeComments } from './EpisodeComments'
import { EpisodeFeedbackReports } from './EpisodeFeedbackReports'
import { UnavailableWork } from './WorkPage'
import { EditSuggestionSheet } from './EditSuggestionSheet'
import { StoryQaPanel } from '../../../shared/storyContext/StoryQaPanel'
import { CommentSheet, FeedbackSheet, LookSheet } from './Sheets'

const NUM = ['一', '二', '三', '四', '五', '六', '七', '八']
const chapLabel = (t: Theme, n: number) => t === 'hanji' ? '第 ' + NUM[n - 1] + ' 回' : t === 'neon' ? 'CHANNEL ' + String(n).padStart(2, '0') : 'CHAPTER ' + n
const ORN: Record<Theme, string> = { hanji: '● ─────', star: '✦ ✧ ✦', neon: '// SIGNAL 72% · 7구역' }
/** 문장 사이 이동 방향키 */
const STEP: Record<string, number> = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }
/** 문장이 있는 본문 블록의 요소(원고 기본 서식) */
const BLOCK_TAG = { paragraph: 'p', quote: 'blockquote', heading: 'h3' } as const

/** 목업 bindReader의 window.onscroll: 진행률 바, 아래로 스크롤하면 바 숨김(inert로 포커스·보조기기에서도 제외), 회차 끝이 보이면 U08 */
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
      // 위치 읽기를 모두 마친 뒤에 쓴다. 쓰고 나서 읽으면 스크롤할 때마다 레이아웃을 한 번 더 계산한다.
      const h = document.documentElement
      const p = h.scrollTop / (h.scrollHeight - h.clientHeight || 1)
      const y = scrollY
      const e = !!end.current && end.current.getBoundingClientRect().top < innerHeight * 0.8
      const hide = y > lastY && y > 120 && p <= 0.97
      lastY = y
      if (prog.current) prog.current.style.width = p * 100 + '%'
      for (const bar of [top.current, bottom.current]) {
        // 포커스가 들어 있는 바는 숨기지 않습니다 (inert가 되면 포커스를 잃습니다).
        const hidden = !!bar && hide && !bar.contains(document.activeElement)
        bar?.classList.toggle('hide', hidden)
        bar?.toggleAttribute('inert', hidden)
      }
      if (e !== atEnd) setEnd((atEnd = e))
    }
    f()
    addEventListener('scroll', f, { passive: true })
    return () => removeEventListener('scroll', f)
  }, [ready, setEnd])
  return { prog, top, bottom, end }
}

/**
 * 목업 .pop: 문장 위에 뜨는 댓글·피드백·공유 팝업. 열리면(다른 문장을 골라도) 첫 버튼으로 포커스를 옮기고,
 * Esc·바깥 누름·다른 시트가 열리면 닫습니다. Esc는 문장으로 포커스를 돌립니다.
 * 가로 위치는 버튼 글자에 따라 달라지는 실제 폭을 잰 뒤 정합니다(at.left는 고른 문장의 왼쪽, 문서 기준).
 */
function SentencePop({ at, onDismiss, children }: { at: { top: number; left: number }; onDismiss: (restoreFocus: boolean) => void; children: ReactNode }) {
  const pop = useRef<HTMLDivElement>(null)
  const [left, setLeft] = useState(POP_GUTTER)
  // 그리기 전에 재므로 화면에는 정한 자리만 보입니다. 폭은 max-content라 왼쪽 위치와 무관하게 같습니다.
  useLayoutEffect(() => {
    if (pop.current) setLeft(scrollX + popLeft(at.left - scrollX, pop.current.offsetWidth, document.documentElement.clientWidth))
  }, [at])
  useEffect(() => { pop.current?.querySelector('button')?.focus() }, [at])
  useEffect(() => {
    const press = (e: PointerEvent) => {
      const t = e.target
      if (t instanceof Element && !pop.current?.contains(t) && !t.closest('[data-s]')) onDismiss(false)
    }
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') onDismiss(true) }
    // 시트는 [role=dialog]가 하나만 있다고 보고 닫힐 때 포커스를 정리하므로 시트가 열리면 팝업을 먼저 닫습니다.
    const sheet = () => onDismiss(false)
    document.addEventListener('pointerdown', press)
    document.addEventListener('keydown', key)
    window.addEventListener('sf-sheet-open', sheet)
    return () => {
      document.removeEventListener('pointerdown', press)
      document.removeEventListener('keydown', key)
      window.removeEventListener('sf-sheet-open', sheet)
    }
  }, [onDismiss])
  return createPortal(<div ref={pop} className="pop" role="dialog" aria-label="문장 작업" style={{ top: at.top, left, width: 'max-content', maxWidth: `calc(100% - ${POP_GUTTER * 2}px)` }}>{children}</div>, document.body)
}

/** 목업 reader(id,n): U05 회차 뷰어 · U08 회차 끝 */
export function ReaderPage() {
  const { id = '', n = '1' } = useParams()
  const vm = useReaderViewModel(id, +n || 1)
  const fb = useFeedbackViewModel()
  // 실제 작품에서 제보를 보낸 뒤 회차 제보 목록을 다시 읽게 올리는 값(독서 기록을 다시 쓰지 않도록 화면 데이터 전체를 갱신하지 않는다).
  const [reportsRefresh, setReportsRefresh] = useState(0)
  const r = vm.reader
  const refs = useReaderScroll(!!r, vm.setEnd)
  useDocumentTitle(r ? `${r.work.title} ${r.n}화` : '회차 뷰어')
  if (vm.state === undefined) return <main className="wrap" id="main" tabIndex={-1}><ContentLoadState failed={vm.isError} retry={vm.retry}/></main>
  if (vm.state === null) return <UnavailableWork />
  if (!r) return <Navigate replace to={`/work/${id}`} />
  const { work: w, ep: e } = r
  const eps = epsOf(w)
  const rk = w.id + r.n
  const selected = vm.selected && vm.sentences[vm.selected.k]
  // 정본 작품에서 비로그인이면 문장 팝업의 회원 전용 동작(댓글·피드백·수정 제안) 이름 앞에 붙는 말입니다(누르면 시트 대신 로그인 화면으로 갑니다).
  const login = w.canonical && !vm.loggedIn ? '로그인하고 ' : ''
  const focusSentence = (i: number) => document.querySelector<HTMLElement>(`[data-s="${i}"]`)?.focus()
  /** 마우스·터치(클릭)와 키보드(Enter·Space)가 함께 쓰는 문장 선택: 팝업 위치를 문장 아래로 잡습니다(가로는 팝업이 폭을 잰 뒤 화면 안으로 당깁니다). */
  const pick = (el: HTMLElement, i: number) => {
    const b = el.getBoundingClientRect()
    vm.select({ k: i, top: b.bottom + scrollY + 8, left: b.left + scrollX })
  }
  const sentenceKey = (ev: ReactKeyboardEvent<HTMLElement>, i: number) => {
    if (ev.altKey || ev.ctrlKey || ev.metaKey) return
    const step = STEP[ev.key]
    if (step) focusSentence(Math.max(0, Math.min(vm.sentences.length - 1, i + step)))
    else if (ev.key === 'Enter') pick(ev.currentTarget, i)
    else if (ev.key !== ' ') return
    // Space는 네이티브 버튼처럼 키를 뗄 때 열어, 포커스가 팝업으로 옮겨 간 뒤 같은 키가 팝업 버튼을 누르지 않게 합니다.
    ev.preventDefault()
  }
  const dismissPop = (restoreFocus: boolean) => {
    const at = vm.selected?.k
    vm.select(null)
    if (restoreFocus && at !== undefined) focusSentence(at)
  }
  // 시트를 연 팝업 버튼은 시트가 열릴 때 사라지므로, 닫을 때 포커스를 고른 문장으로 돌립니다. 보기 설정은 Sheet가 Aa 버튼으로 돌립니다.
  const closeSheet = () => {
    const s = vm.sheet
    vm.closeSheet()
    if (s?.kind === 'comment' || s?.kind === 'feedback' || s?.kind === 'suggest') focusSentence(s.k)
  }
  let k = 0
  let image = 0
  return (
    <div className={vm.readerClass} style={vm.readerVars as CSSProperties}>
      {vm.amb && <Amb t={w.theme} lite={vm.amb.lite} />}
      <div className="rbarr" id="rtop" ref={refs.top}>
        <div className="in">
          <Go to={`/work/${id}`} className="back rback" aria-label="소설 목록으로"><BackChev /><span>목록</span></Go>
          <div className="t"><b>{w.title}</b><small>{r.n}화 · {e.t}{w.parent && r.n <= (w.forkAt ?? 0) ? ' · 원작 스냅샷' : ''}</small></div>
          <button type="button" className="rib" aria-label="공유" onClick={vm.share}>↗</button>
          {w.canonical && <Go to={`/work/${id}/wiki?upto=${r.n}`} className="rib" aria-label="설정 위키 보기" title="이 회차까지 공개된 설정 위키">설정</Go>}
          <button type="button" className="rib" aria-label="보기 설정" onClick={() => vm.openSheet({ kind: 'look' })}>Aa</button>
        </div>
        <div className="prog"><i id="prog" ref={refs.prog} /></div>
      </div>
      <main className="page" id="main" tabIndex={-1}>
        <h1 className="sr-only">{w.title} {r.n}화</h1>
        <div className="chap"><small>{chapLabel(w.theme, r.n)}</small><h2>{e.t}</h2><div className="orn">{ORN[w.theme]}</div>{!w.canonical && <div className="reading"><i />지금 {30 + ((r.n * 37) % 90)}명이 함께 읽는 중 <span className="demo">데모</span></div>}</div>
        <div className="hint">{w.canonical?'☝ 문장을 누르면 댓글을 남길 수 있어요. 공개된 회차를 읽고 허용된 시점에서 포크할 수 있어요. 로그인하면 읽은 회차가 계정에 저장돼요.':'☝ 문장을 누르면 댓글이나 피드백을 보낼 수 있어요. 소설 전체 신고는 상세 화면에서 할 수 있어요.'}</div>
        <span id="sentence-help" className="sr-only">{w.canonical?'댓글 달기 열기':'댓글·피드백 열기'}</span>
        <div className="text" id="text">
          {hiddenSourceEpisode(w, r.n, e.p) && <p className="muted">원작이 삭제돼 분기 전 회차 본문은 볼 수 없어요. {(w.forkAt ?? 0) + 1}화부터 이 포크 소설이 이어져요.</p>}
          {r.blocks.map((b, bi) => {
            // 빈 줄은 블록 사이의 간격이다: n줄이면 문단 간격에 n-1줄을 더 두고, 본문 맨 앞·맨 끝에서는 간격을 만들지 않는다.
            if (b.kind === 'blank') return bi > 0 && bi < r.blocks.length - 1 && Array.from({ length: b.count - 1 }, (_, j) => <br key={`${bi}-${j}`} />)
            if (b.kind === 'rule') return <hr key={bi} />
            if (b.kind === 'image') {
              const fallback = `본문 이미지 ${++image}`
              return <figure key={bi}><StoredImage target={{ kind: 'episode', workId: w.id, number: r.n }} id={b.id} alt={vm.imageAlts[b.id] || fallback} publicView={vm.publicImages} /></figure>
            }
            // 소제목은 회차 제목(h2) 아래의 h3다. 문장은 문단·인용·소제목을 이어서 세고(k) 구분선·이미지·빈 줄은 건너뛴다.
            const Block = BLOCK_TAG[b.kind]
            return <Block key={bi}>{b.sentences.map((s, j) => {
              const i = k++
              // 버튼 역할과 설명은 탭 정지점(포커스가 닿는) 문장 하나에만 둔다. 문장마다 두면 화면 읽기 프로그램의 연속 읽기가 '버튼'과 설명으로 끊긴다.
              const stop = i === vm.tabStop
              return <span key={j}>{s.gap}<span className={`s${vm.selected?.k === i ? ' sel' : ''}`} data-s={i} role={stop ? 'button' : undefined} tabIndex={stop ? 0 : -1} aria-describedby={stop ? 'sentence-help' : undefined}
                onFocus={() => vm.setTabStop(i)} onClick={(ev) => pick(ev.currentTarget, i)} onKeyDown={(ev) => sentenceKey(ev, i)} onKeyUp={(ev) => { if (ev.key === ' ') pick(ev.currentTarget, i) }}><ManuscriptText parts={s.parts} /></span></span>
            })}</Block>
          })}
        </div>
        {e.authorNote && <section className="author-note"><h3>작가의 말</h3><p>{e.authorNote}</p></section>}
        <div className="endmark" id="endmark" ref={refs.end}>— {r.n}화 끝 —</div>
        {w.canonical && !w.private && e.versionId && !hiddenSourceEpisode(w, r.n, e.p) && (vm.loggedIn
          ? <StoryQaPanel key={`${w.id}/${r.n}/${e.versionId}`} workId={w.id} episode={r.n} versionId={e.versionId} />
          : <button className="tbtn" type="button" onClick={() => vm.requireMember('question')}>로그인하고 원고에 질문하기</button>)}
        <div className="endgrid" id="end">
          {r.next ? (
            <Go to={`/read/${id}/${r.next}`} className="tcard nextc"><div><small>다음 화</small><b>{r.next}화 {eps[r.next - 1].t}</b></div><span style={{ fontSize: 22 }}>›</span></Go>
          ) : <div className="tcard nextc"><div><small>마지막 회차예요</small><b>다음 화를 기다려 주세요</b></div></div>}
          {r.canFork && (
            <div className="tcard ifend">
              <h3>여기서 포크해 볼까요?</h3>
              <p>{w.canonical ? `${r.n}화의 공개된 원고·설정을 기준으로 분기해요. 관계의 과거 snapshot·복원은 지원하지 않아요.` : `${r.n}화가 끝난 시점의 세계관과 인물을 복사해서 나만의 다음 화를 쓸 수 있어요.`} 원작은 바뀌지 않아요.{r.forks.length > 0 && ` 이미 ${r.forks.length}편이 포크됐어요.`}</p>
              <div className="acts">
                <Go to="/writing-policy?method=fork" state={{ target: `/fork/${id}?at=${r.n}` }} className="tbtn pri" id="forkHere">✎ {r.n}화에서 포크하기</Go>
                {r.forks.map((f) => <Go key={f.id} to={`/work/${f.id}`} className="tbtn">「{f.title.split(': ')[1] || f.title}」 읽기</Go>)}
              </div>
            </div>
          )}
          {w.canonical && <EpisodeComments key={`${w.id}/${r.n}`} workId={w.id} n={r.n} quoted={vm.sheet?.kind === 'comment' ? vm.sentences[vm.sheet.k] : undefined} onCloseSheet={closeSheet} />}
          {w.canonical && <EpisodeFeedbackReports key={`${w.id}/${r.n}/reports`} workId={w.id} n={r.n} refresh={reportsRefresh} />}
          {!w.canonical && <section className="tcard cms">
            <h3>댓글 {r.comments.length}</h3>
            <form className="cmf" id="cmf" onSubmit={(ev) => {
              ev.preventDefault()
              if (!vm.requireMember('comment')) return
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
          </section>}
        </div>
      </main>
      <nav className="rnav" id="rbot" ref={refs.bottom}>
        <div className="in">
          <Go to={`/read/${id}/${r.previous ?? r.n}`} disabled={!r.previous}>‹ 이전 화</Go>
          <Go to={`/work/${id}`}>목록</Go>
          <Go to={`/read/${id}/${r.next ?? r.n}`} disabled={!r.next}>다음 화 ›</Go>
        </div>
      </nav>
      {selected && vm.selected?.pop && (
        <SentencePop at={vm.selected} onDismiss={dismissPop}>
          <button type="button" onClick={() => vm.openSheet({ kind: 'comment', k: vm.selected?.k ?? 0 })}>{`💬 ${login}댓글 달기`}</button>
          {/* 정본 작품은 댓글·피드백(제보)·수정 제안만 서버에 연결돼 있어 문장 공유(데모) 동작은 열지 않습니다. */}
          <button type="button" onClick={() => vm.openSheet({ kind: 'feedback', k: vm.selected?.k ?? 0 })}>{`✉ ${login}피드백 보내기`}</button>
          {w.canonical && <button type="button" onClick={() => vm.openSheet({ kind: 'suggest', k: vm.selected?.k ?? 0 })}>{`✎ ${login}수정 제안`}</button>}
          {!w.canonical && <button type="button" onClick={() => { dismissPop(true); vm.shareSentence() }}>⧉ 문장 공유</button>}
        </SentencePop>
      )}
      {vm.sheet?.kind === 'look' && <LookSheet onClose={closeSheet} />}
      {!w.canonical && vm.sheet?.kind === 'comment' && <CommentSheet workId={id} n={r.n} sentence={vm.sentences[vm.sheet.k]} onClose={closeSheet}
        onAdded={() => setTimeout(() => document.querySelector('.cm:last-of-type')?.scrollIntoView?.({ block: 'center' }), 60)} />}
      {vm.sheet?.kind === 'feedback' && <FeedbackSheet workId={id} n={r.n} sentence={vm.sentences[vm.sheet.k]} canonical={w.canonical} onSent={() => setReportsRefresh((v) => v + 1)} onClose={closeSheet} />}
      {w.canonical && vm.sheet?.kind === 'suggest' && <EditSuggestionSheet workId={id} n={r.n} sentence={vm.sentences[vm.sheet.k]} onClose={closeSheet} />}
    </div>
  )
}

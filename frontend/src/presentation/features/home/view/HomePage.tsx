import { useEffect, useLayoutEffect, useRef, useState } from 'react'

import { avatarOf, epsOf, type Work } from '../../../../domain/entities/work'
import { Art, Cov, CoverOf, Tags } from '../../../shared/art'
import { ago, kfmt } from '../../../shared/format'
import { Go } from '../../../shared/Go'
import { Footer, Gnb } from '../../../shared/shell/Gnb'
import { useHomeViewModel } from '../viewmodel/useHomeViewModel'

const Chev = ({ d }: { d: string }) => <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d={d} fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" /></svg>
const LEFT = 'M15 5l-7 7 7 7'
const RIGHT = 'M9 5l7 7-7 7'
const shortTitle = (w: Work) => w.title.split(': ').pop()

/** 포커스·수동 조작 후에는 재생을 명시해야 하며, 동작 줄이기에서는 타이머를 만들지 않습니다. */
export function Hero({ works, hero, stepHero, setHero }: { works: Work[]; hero: number; stepHero: (d: number) => void; setHero: (i: number) => void }) {
  const track = useRef<HTMLDivElement>(null)
  const [resize, setResize] = useState(0)
  const [visible, setVisible] = useState(1)
  const [paused, setPaused] = useState(false)
  const [hovered, setHovered] = useState(false)
  const [reducedMotion, setReducedMotion] = useState(() => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false)
  const N = works.length
  useLayoutEffect(() => {
    const tr = track.current
    if (!tr?.children[0]) return
    const wdt = tr.children[0].getBoundingClientRect().width + 14
    const vis = Math.max(1, Math.floor(((tr.parentElement?.clientWidth ?? 0) + 14) / wdt))
    setVisible(vis)
    const max = Math.max(0, N - vis)
    if (hero > max) return setHero(0)
    if (hero < 0) return setHero(max)
    tr.style.transform = `translateX(${-hero * wdt}px)`
  }, [hero, resize, N, setHero])
  useEffect(() => {
    const media = window.matchMedia?.('(prefers-reduced-motion: reduce)')
    if (!media) return
    const update = () => {
      setReducedMotion(media.matches)
      if (media.matches) setPaused(true)
    }
    update()
    media.addEventListener('change', update)
    return () => media.removeEventListener('change', update)
  }, [])
  useEffect(() => {
    const r = () => setResize((x) => x + 1)
    addEventListener('resize', r)
    return () => removeEventListener('resize', r)
  }, [])
  useEffect(() => {
    if (reducedMotion || paused || hovered || N <= visible) return
    const timer = setInterval(() => { if (!document.querySelector('[role=dialog]')) stepHero(1) }, 4500)
    return () => clearInterval(timer)
  }, [reducedMotion, paused, hovered, N, visible, stepHero])
  const shown = Math.min(Math.max(hero, 0), Math.max(0, N - visible))
  const move = (i: number) => { setPaused(true); setHero(i) }
  if (!N) return null
  return (
    <section className="hero" aria-labelledby="hero-heading" aria-roledescription="캐러셀"
      onFocusCapture={() => setPaused(true)} onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}>
      <h2 id="hero-heading" className="sr-only">추천 소설</h2>
      <span className="cnt" id="cnt" aria-live="off">{shown + 1} / {N}</span>
      <div className="vp">
        <div className="track" id="track" ref={track}>
          {works.map((w, i) => {
            const active = i >= shown && i < shown + visible
            return <Go key={w.id} to={`/work/${w.id}`} className={`slide ${w.lite ? 'lite' : ''}`} style={{ background: w.heroBg }}
              inert={!active} aria-hidden={!active} tabIndex={active ? undefined : -1}>
              <div className="bgart"><Art theme={w.theme} w={400} h={400} seed={w.id + 'bg'} /></div>
              <div className="tg"><Tags w={w} /></div>
              <div className="cv"><CoverOf w={w} k="h" /></div>
              <h3>{w.hero?.[0]}<br />{w.hero?.[1]}</h3>
              <p>&lt;{w.title}&gt; {w.author}</p>
            </Go>
          })}
        </div>
      </div>
      <div className="hero-controls">
        <button type="button" className="hero-step" aria-label="이전 소설" onClick={() => move(hero - 1)}><Chev d={LEFT} /></button>
        <div className="dots" id="dots">{works.slice(0, Math.max(1, N - visible + 1)).map((w, i) => (
          <button type="button" key={w.id} aria-label={`${i + 1}번째 소설 보기`} aria-pressed={i === shown} onClick={() => move(i)}><i className={i === shown ? 'on' : ''} /></button>
        ))}</div>
        <button type="button" className="hero-step" aria-label="다음 소설" onClick={() => move(hero + 1)}><Chev d={RIGHT} /></button>
      </div>
      <div className="hero-rotation">
        <button type="button" className="btn sm" aria-label="자동 넘김 일시 정지" aria-pressed={paused} onClick={() => setPaused(true)}>일시 정지</button>
        <button type="button" className="btn sm" aria-label="자동 넘김 재생" aria-pressed={!paused && !reducedMotion} disabled={reducedMotion || N <= visible} onClick={() => setPaused(false)}>재생</button>
        {reducedMotion && <small>동작 줄이기 설정으로 자동 넘김이 꺼져 있어요.</small>}
      </div>
    </section>
  )
}

function Top10({ list, works }: { list: Work[]; works: Work[] }) {
  return (
    <aside className="t10" aria-label="실시간 인기 TOP10">
      <div className="t10h"><h2>실시간 인기</h2><span className="live" title="좋아요 순 · 데모 데이터">24시 · 데모</span><Go to="/rank" className="more">더보기 ›</Go></div>
      <ol>
        {list.map((w, i) => (
          <li key={w.id}>
            <Go to={`/work/${w.id}`}>
              <span className={`n ${i < 3 ? 'md md' + (i + 1) : ''}`}>{i + 1}</span>
              <span className="tx">
                <b>{w.parent && <i className="ift">포크</i>}{w.parent ? shortTitle(w) : w.title}</b>
                <small>{w.author}{w.parent && ` · ${works.find((p) => p.id === w.parent)?.title} ${w.forkAt}화에서`}</small>
              </span>
            </Go>
          </li>
        ))}
      </ol>
    </aside>
  )
}

const BookCard = ({ w, k, label, sub, source }: { w: Work; k: string; label?: string; sub: string; source?: { title: string; episode: number } }) => (
  <Go to={`/work/${w.id}`} className="bk prox"><Cov w={w} k={k} likes /><h3 className="hk">{label}</h3><small>{sub}</small>{source && <small className="fork-source">{source.title} · {source.episode}화에서 분기</small>}</Go>
)

/** 목업 home(): U01 홈 · U02 필터 결과 */
export function HomePage() {
  const vm = useHomeViewModel()
  const shelf = useRef<HTMLDivElement>(null)
  const [loading, setLoading] = useState(vm.firstHome)
  useEffect(() => {
    if (!vm.firstHome) return
    vm.homeVisited()
    const t = setTimeout(() => setLoading(false), 650)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 첫 방문 한 번만
  }, [])
  const h = vm.home
  const scrollShelf = (d: number) => shelf.current?.scrollBy({ left: d * shelf.current.clientWidth * 0.8, behavior: 'smooth' })

  return (
    <>
      <Gnb on="home" />
      <main className={`wrap ${loading ? 'loading' : ''}`} id="home">
        <h1 className="sr-only">STORYFORK</h1>
        <div className="chips">
          {vm.chips.map((c) => <button type="button" key={c} className={vm.chip === c ? 'on' : ''} aria-pressed={vm.chip === c} onClick={() => vm.selectChip(c)}>{c}</button>)}
        </div>
        {vm.guide && (
          <div className="guide">
            <b>처음 오셨나요?</b>
            <ol><li><i>1</i>읽기</li><li><i>2</i>문장을 눌러 댓글·피드백</li><li><i>3</i>원하는 회차에서 포크하기</li></ol>
            <button type="button" className="x" aria-label="안내 닫기" onClick={vm.closeGuide}>✕</button>
          </div>
        )}
        {vm.isError && <p className="muted">소설을 불러오지 못했어요.</p>}
        {h && h.filtered && (
          <section className="sec">
            <div className="sec-h"><h2>{vm.chip}</h2><span className="muted small">{h.filtered.length}편</span></div>
            <div className="grid6">
              {h.filtered.length ? h.filtered.map((w) => <BookCard key={w.id} w={w} k="" label={shortTitle(w)} sub={`${w.author} · ${w.genre}`} source={h.forkSources[w.id]} />) : <p className="muted">아직 소설이 없어요.</p>}
            </div>
          </section>
        )}
        {h && !h.filtered && (
          <>
            {h.continueReading && (() => {
              const { work: lw, episode: ln } = h.continueReading
              const eps = epsOf(lw)
              return (
                <Go to={`/read/${lw.id}/${ln}`} className="cont">
                  <div className="th"><CoverOf w={lw} /></div>
                  <div><h2>▶ 이어 읽기</h2><b>{lw.title} · {ln}화 {eps[ln - 1].t}</b><div className="bar"><i style={{ width: `${ln / eps.length * 100}%` }} /></div></div>
                  <span className="go">{ln}화 이어 읽기</span>
                </Go>
              )
            })()}
            <section className="sec" style={{ marginTop: 28 }}>
              <div className="sec-h"><h2>방금 올라온 포크 소설</h2><span className="muted small">원작의 한 회차에서 포크됐어요</span><Go to="/rank?t=if" className="more">전체 보기 ›</Go></div>
              <div className="rings">
                <Go to="/work/guunmong" className="ring add"><div className="o">＋</div><b>나도 쓰기</b><small>원작에서 포크하기</small></Go>
                {h.forkFeed.map((w) => (
                  <Go key={w.id} to={`/work/${w.id}`} className={`ring ${h.seen[w.id] ? 'seen' : ''} prox`} onClick={() => vm.markSeen(w.id)}>
                    <div className="o"><span><CoverOf w={w} k="r" /></span></div>
                    <b>{w.title.split(': ')[1] || w.title}</b><small>{w.author} · {ago(w.upd)}</small>
                  </Go>
                ))}
              </div>
            </section>
            <div className="herow"><Hero works={h.originals} hero={vm.hero} stepHero={vm.stepHero} setHero={vm.setHero} /><Top10 list={h.top10} works={h.works} /></div>
            <section className="sec">
              <div className="tri">
                <div><h2>24시간 인기 급상승</h2>{h.rising.map((w, i) => (
                  <Go key={w.id} to={`/work/${w.id}`} className="rk"><span className={`n ${i < 3 ? 'top' : ''}`}>{['1st', '2nd', '3rd'][i] || i + 1 + 'th'}</span><span className="th"><CoverOf w={w} k="rk" /></span><b>{w.title}</b><em>👁 {kfmt(w.views)}</em></Go>
                ))}</div>
                <div><h2>방금 업데이트</h2>{h.fresh.map((w) => (
                  <Go key={w.id} to={`/work/${w.id}`} className="rk" style={{ gridTemplateColumns: '38px minmax(0,1fr) auto' }}><span className="th"><CoverOf w={w} k="rk" /></span><b>{w.title}</b><em>{ago(w.upd)}</em></Go>
                ))}</div>
                <div><h2>에디터 Pick</h2><div className="picks">{h.picks.map((w) => (
                  <Go key={w.id} to={`/work/${w.id}`} className="pick prox"><Cov w={w} /><b>{shortTitle(w)}</b></Go>
                ))}</div></div>
              </div>
            </section>
            <section className="sec">
              <div className="sec-h"><h2>오늘, 스토리포크의 발견</h2></div>
              <div className="shelf">
                <button type="button" className="arr l" aria-label="이전" onClick={() => scrollShelf(-1)}><Chev d={LEFT} /></button>
                <div className="row" id="shelf" ref={shelf}>{h.discover.map((w) => <BookCard key={w.id} w={w} k="s" label={w.hook || w.dir} sub={shortTitle(w) ?? ''} />)}</div>
                <button type="button" className="arr r" aria-label="다음" onClick={() => scrollShelf(1)}><Chev d={RIGHT} /></button>
              </div>
            </section>
            <section className="sec">
              <div className="sec-h"><h2>이번 주 인기 무료 소설</h2></div>
              <div className="wk">{h.weekly.map((w) => (
                <Go key={w.id} to={`/work/${w.id}`} className="wc prox">
                  <div>
                    <div className="tgs"><Tags w={w} /><span className="tag dk">연재중</span></div>
                    <h3>{w.title}</h3><p>{w.summary}</p>
                    <div className="ft"><i style={{ background: avatarOf(w.author) }} />{w.author}<span>👁 {kfmt(w.views)} · ♥ {kfmt(w.likes)}</span></div>
                  </div>
                  <Cov w={w} k="w" />
                </Go>
              ))}</div>
            </section>
          </>
        )}
      </main>
      <Footer />
    </>
  )
}

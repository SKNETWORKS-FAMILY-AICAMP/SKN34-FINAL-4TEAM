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

/** 목업 bindHero(): 4.5초마다 넘기고, 마우스를 올리거나 시트가 열려 있으면 멈춥니다. */
function Hero({ works }: { works: Work[] }) {
  const track = useRef<HTMLDivElement>(null)
  const [hero, setHero] = useState(0)
  const [resize, setResize] = useState(0)
  const N = works.length
  useLayoutEffect(() => {
    const tr = track.current
    if (!tr?.children[0]) return
    const wdt = tr.children[0].getBoundingClientRect().width + 14
    const vis = Math.max(1, Math.round((tr.parentElement?.clientWidth ?? 0) / wdt))
    const max = Math.max(0, N - vis)
    if (hero > max) return setHero(0)
    if (hero < 0) return setHero(max)
    tr.style.transform = `translateX(${-hero * wdt}px)`
  }, [hero, resize, N])
  useEffect(() => {
    const t = setInterval(() => { if (!document.querySelector('.hero:hover, dialog[open]')) setHero((h) => h + 1) }, 4500)
    const r = () => setResize((x) => x + 1)
    addEventListener('resize', r)
    return () => { clearInterval(t); removeEventListener('resize', r) }
  }, [])
  const shown = Math.min(Math.max(hero, 0), N - 1)
  return (
    <section className="hero">
      <span className="cnt" id="cnt">{shown + 1} / {N}</span>
      <button type="button" className="arr l" aria-label="이전 소설" onClick={() => setHero((h) => h - 1)}><Chev d={LEFT} /></button>
      <div className="vp">
        <div className="track" id="track" ref={track}>
          {works.map((w) => (
            <Go key={w.id} to={`/work/${w.id}`} className={`slide ${w.lite ? 'lite' : ''}`} style={{ background: w.heroBg }}>
              <div className="bgart"><Art theme={w.theme} w={400} h={400} seed={w.id + 'bg'} /></div>
              <div className="tg"><Tags w={w} /></div>
              <div className="cv"><CoverOf w={w} k="h" /></div>
              <h3>{w.hero?.[0]}<br />{w.hero?.[1]}</h3>
              <p>&lt;{w.title}&gt; {w.author}</p>
            </Go>
          ))}
        </div>
      </div>
      <button type="button" className="arr r" aria-label="다음 소설" onClick={() => setHero((h) => h + 1)}><Chev d={RIGHT} /></button>
      <div className="dots" id="dots">{works.map((w, i) => <i key={w.id} className={i === shown ? 'on' : ''} />)}</div>
    </section>
  )
}

function Top10({ list, works }: { list: Work[]; works: Work[] }) {
  return (
    <aside className="t10" aria-label="실시간 인기 TOP10">
      <div className="t10h"><b>실시간 인기</b><span className="live" title="좋아요 순 · 데모 데이터">24시 · 데모</span><Go to="/rank" className="more">더보기 ›</Go></div>
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

const BookCard = ({ w, k, label, sub }: { w: Work; k: string; label?: string; sub: string }) => (
  <Go to={`/work/${w.id}`} className="bk prox"><Cov w={w} k={k} likes /><span className="hk">{label}</span><small>{sub}</small></Go>
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
        <div className="chips">
          {vm.chips.map((c) => <button type="button" key={c} className={vm.chip === c ? 'on' : ''} onClick={() => vm.selectChip(c)}>{c}</button>)}
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
              {h.filtered.length ? h.filtered.map((w) => <BookCard key={w.id} w={w} k="" label={shortTitle(w)} sub={`${w.author} · ${w.genre}`} />) : <p className="muted">아직 소설이 없어요.</p>}
            </div>
          </section>
        )}
        {h && !h.filtered && (
          <>
            <div className="herow"><Hero works={h.originals} /><Top10 list={h.top10} works={h.works} /></div>
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
            {h.continueReading && (() => {
              const { work: lw, episode: ln } = h.continueReading
              const eps = epsOf(lw)
              return (
                <Go to={`/read/${lw.id}/${ln}`} className="cont">
                  <div className="th"><CoverOf w={lw} /></div>
                  <div><small>▶ 이어 읽기</small><b>{lw.title} · {ln}화 {eps[ln - 1].t}</b><div className="bar"><i style={{ width: `${ln / eps.length * 100}%` }} /></div></div>
                  <span className="go">{ln}화 이어 읽기</span>
                </Go>
              )
            })()}
            <section className="sec">
              <div className="tri">
                <div><h3>24시간 인기 급상승</h3>{h.rising.map((w, i) => (
                  <Go key={w.id} to={`/work/${w.id}`} className="rk"><span className={`n ${i < 3 ? 'top' : ''}`}>{['1st', '2nd', '3rd'][i] || i + 1 + 'th'}</span><span className="th"><CoverOf w={w} k="rk" /></span><b>{w.title}</b><em>👁 {kfmt(w.views)}</em></Go>
                ))}</div>
                <div><h3>방금 업데이트</h3>{h.fresh.map((w) => (
                  <Go key={w.id} to={`/work/${w.id}`} className="rk" style={{ gridTemplateColumns: '38px minmax(0,1fr) auto' }}><span className="th"><CoverOf w={w} k="rk" /></span><b>{w.title}</b><em>{ago(w.upd)}</em></Go>
                ))}</div>
                <div><h3>에디터 Pick</h3><div className="picks">{h.picks.map((w) => (
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
                    <h4>{w.title}</h4><p>{w.summary}</p>
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

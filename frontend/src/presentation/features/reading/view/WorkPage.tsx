import { useState, type KeyboardEvent } from 'react'
import { useParams } from 'react-router'
import { hiddenSourceEpisode, isPub } from '../../../../domain/entities/work'

import { Art, CoverOf } from '../../../shared/art'
import { kfmt } from '../../../shared/format'
import { Go } from '../../../shared/Go'
import { ContentLoadState } from '../../../shared/ContentLoadState'
import { Branch, Bubble, Eye, Flag, Heart, Like, Share } from '../../../shared/icons'
import { Footer, Gnb } from '../../../shared/shell/Gnb'
import { useDocumentTitle } from '../../../shared/useDocumentTitle'
import { useWorkViewModel } from '../viewmodel/useWorkViewModel'
import { Amb } from './Amb'
import { ReportSheet } from './Sheets'
import { WorkComments } from './WorkComments'
import { WorkInfo, serialView } from './WorkInfo'
import { WorkNotices } from './WorkNotices'
import { WorkRecommendations } from './WorkRecommendations'

const TABS = [['eps', '회차'], ['info', '정보'], ['notice', '소식']] as const
type Tab = (typeof TABS)[number][0]

/** 목업 unavailableWork() */
export function UnavailableWork() {
  return (
    <>
      <Gnb />
      <main className="wrap" id="main" tabIndex={-1}><div className="panel"><h1>소설을 찾을 수 없거나 볼 수 없어요.</h1><Go to="/" className="btn">홈으로</Go></div></main>
      <Footer />
    </>
  )
}


/** 목업 work(id): U04 소설 상세 */
export function WorkPage() {
  const { id = '' } = useParams()
  const vm = useWorkViewModel(id)
  // ponytail: 탭 선택은 이 화면의 표시 상태라 View에 둔다(작품 소식의 권한·요청은 소식 ViewModel이 맡는다). 탭 상태를 ViewModel로 옮기는 것은 이번 범위 밖.
  const [tab, setTab] = useState<Tab>('eps')
  const d = vm.detail
  useDocumentTitle(d?.work.title ?? '소설 상세')
  if (d === undefined) return <><Gnb/><main className="wrap" id="main" tabIndex={-1}><ContentLoadState failed={vm.isError} retry={vm.retry}/></main></>
  if (d === null) return <UnavailableWork />
  const { work: w, parent: p, visible, last, read, liked, likes, forks, forkList } = d
  const first = visible.find(([e, i]) => !hiddenSourceEpisode(w, i + 1, e.p)) ?? visible[0]
  const start = last && visible.some(([e, i]) => i + 1 === last && !hiddenSourceEpisode(w, last, e.p)) ? last : (first?.[1] ?? 0) + 1
  const sourceTitle = p?.title ?? w.parentTitle
  const sv = serialView(w)
  /** 탭 목록의 방향키·Home·End로 탭을 옮깁니다(끝에서는 돌아서 이어짐). 선택한 탭만 Tab 순서에 들어갑니다. */
  const moveTab = (e: KeyboardEvent) => {
    const i = TABS.findIndex(([k]) => k === tab)
    const to = e.key === 'ArrowRight' ? i + 1 : e.key === 'ArrowLeft' ? i - 1 : e.key === 'Home' ? 0 : e.key === 'End' ? TABS.length - 1 : null
    if (to === null) return
    e.preventDefault()
    const next = TABS[(to + TABS.length) % TABS.length][0]
    setTab(next)
    document.getElementById(`tab-${next}`)?.focus()
  }
  return (
    <>
    <Gnb />
    <div className={`calm calm-${w.theme}`} style={{ minHeight: '100vh' }}>
      <div className="band"><Art theme={w.theme} w={1200} h={460} seed={w.id + 'band'} /></div>
      {vm.bandAmb && <Amb t={w.theme} lite band />}
      <main className="wrap" id="main" tabIndex={-1}>
        <section className="whero">
          <div className="cover"><CoverOf w={w} k="big" /></div>
          <div>
            <span className="g">{w.genre}</span>{w.auto?.on && <span className="chip ok" style={{ marginLeft: 8 }}>🤖 AI 자율 연재 중</span>}{sv.days && <span className="g wsched">{sv.days}</span>}{sv.badge && <span className={`chip ${sv.badge === '연재 중' ? 'ok' : sv.badge === '휴재' ? 'wait' : ''}`} style={{ marginLeft: 8 }}>{sv.badge}</span>}
            <h1>{w.title}</h1><div className="by">{w.by}</div>{p && <div className="by" style={{ marginTop: 6 }}>“{w.dir}”</div>}
            <p className="sum">{w.summary || '원작 「' + sourceTitle + '」의 ' + w.forkAt + '화 이후, 다른 길로 간 포크 소설.'}</p>
            <div className="hashes">{(w.hash || p?.hash || []).map((h) => <Go key={h} to={`/tag/${encodeURIComponent(h.replace(/^#/, ''))}`} title={`${h} 소설 모아 보기`}>{h}</Go>)}</div>
            <div className="stats">
              {(w.canonical || w.statisticsSupported!==false) && <span title="좋아요"><Like /><span className="sr-only">좋아요 </span><b id="lkc">{kfmt(likes)}</b></span>}
              {w.statisticsSupported!==false && <><span title="조회"><Eye /><span className="sr-only">조회 </span><b>{kfmt(w.views)}</b></span><span title="댓글"><Bubble /><span className="sr-only">댓글 </span><b>{w.cmts || 0}</b></span></>}
              <span title="포크 소설"><Branch /><span className="sr-only">이 소설에서 갈라진 포크 소설 </span><b>{forks.length}</b><span className="sr-only">편</span></span>
            </div>
            <div className="acts">
              {visible.length > 0 && <Go to={`/read/${id}/${start}`} className="tbtn pri">읽기 시작</Go>}
              {!!last && <Go to={`/read/${id}/1`} className="tbtn">처음부터</Go>}
              {w.canonical && <Go to={`/work/${id}/wiki`} className="tbtn">설정 위키</Go>}
              <div className="ibs">
                <LikeButton liked={liked} label={w.canonical ? '좋아요' : '관심 소설'} pending={vm.likePending} onClick={vm.toggleLike} />
                <button type="button" className="ib" aria-label="공유" onClick={vm.share}><Share /></button>
              </div>
              {vm.canInterest && (vm.isMember
                ? <button type="button" className="tbtn" disabled={vm.interestBusy} onClick={vm.toggleInterest}>{vm.interested ? '관심 해제' : '관심 등록'}</button>
                : <Go to="/login" className="tbtn" onClick={vm.requireLogin}>관심 등록</Go>)}
              {vm.canReport && <button type="button" className="tbtn weak" aria-label={`${w.title} 소설 신고`} onClick={() => vm.setReporting(true)}><Flag /> 소설 신고</button>}
            </div>
          </div>
        </section>
        <div className="wgrid">
          <section className="tcard eps">
            <div className="wtabs" role="tablist" aria-label="소설 상세 탭" onKeyDown={moveTab}>
              {TABS.map(([k, label]) => <button key={k} type="button" role="tab" id={`tab-${k}`} aria-selected={tab === k} aria-controls="panel-work" tabIndex={tab === k ? 0 : -1} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{label}</button>)}
            </div>
            <div id="panel-work" role="tabpanel" aria-labelledby={`tab-${tab}`}>
            {tab === 'info' ? <WorkInfo work={w} parent={p} episodeCount={visible.length} /> : tab === 'notice' ? <WorkNotices key={w.id} work={w} /> : <>
            <div className="eptool">
              <b>전체 {visible.length}화</b>
              <div className="sortt" role="group" aria-label="회차 정렬">
                <button type="button" className={vm.epSort !== 'new' ? 'on' : ''} aria-pressed={vm.epSort !== 'new'} onClick={() => vm.setSort('old')}>1화부터</button>
                <button type="button" className={vm.epSort === 'new' ? 'on' : ''} aria-pressed={vm.epSort === 'new'} onClick={() => vm.setSort('new')}>최신순</button>
              </div>
              <label className="eps-q"><span aria-hidden="true">🔍</span><input id="epq" placeholder="회차 제목·본문 검색" aria-label="회차 검색" value={vm.query} onChange={(e) => vm.setQuery(e.target.value)} /></label>
            </div>
            <div id="eplist">
              {vm.episodes.length ? vm.episodes.map(({ e, n, chars, match, views }) => {
                const inh = w.parent && n <= (w.forkAt ?? 0)
                const hidden = hiddenSourceEpisode(w, n, e.p)
                const fc = forks.filter((f) => f.forkAt === n).length
                return (
                  <Go key={n} to={`/read/${id}/${n}`} className={`ep ${read.includes(n) ? 'read' : ''}`} style={match ? undefined : { display: 'none' }}>
                    <span className="no">{n}</span>
                    <div><b>{e.t}</b><div className="d">{hidden ? '원작 삭제로 볼 수 없는 회차' : <>{inh ? '원작 스냅샷 회차' : read.includes(n) ? '읽음' : last === n ? '읽는 중' : '무료'} <i className="sep" /> {chars.toLocaleString()}자{views !== undefined && <> <i className="sep" /> <span title="조회"><Eye /><span className="sr-only">조회</span> {kfmt(views)}</span></>}</>}{fc > 0 && <> <i className="sep" /> <span title="이 회차에서 갈라진 포크"><Branch /> <span className="sr-only">이 회차에서 갈라진 포크 </span>{fc}<span className="sr-only">편</span></span></>}</div></div>
                  </Go>
                )
              }) : <p className="muted" style={{ padding: 20 }}>아직 공개된 회차가 없어요.</p>}
            </div>
            <p className="muted small" id="epnone" style={{ padding: 20, display: vm.noMatch ? 'block' : 'none' }}>검색 결과가 없어요.</p>
            </>}
            </div>
          </section>
          <aside className="tcard forkbox">
            {/* 이 상자의 제목은 h1 바로 아래 구역이라 2단계로 알린다(모양은 전역 .forkbox h3 규칙을 그대로 쓴다). */}
            {p ? (
              <><h3 aria-level={2}>원작 보기</h3><p>이 소설은 「{p.title}」 {w.forkAt}화를 기준으로 분기했어요.{w.canonical ? ' 설정의 원본 추적·독립 상태는 집필실에서 확인해 주세요. 관계의 과거 시점 복원은 지원하지 않아요.' : ' 이후 바뀐 설정은 이 소설에만 저장돼요.'}</p><Go to={`/work/${p.id}`} className="tbtn">원작으로 가기</Go></>
            ) : w.parentDeleted ? (
              <><h3 aria-level={2}>삭제된 원작</h3><p>이 소설은 「{w.parentTitle}」 {w.forkAt}화를 기준으로 분기했어요. 원작이 삭제돼 원작으로 이동할 수 없고, 분기 전 회차 본문은 독자에게 보이지 않아요.</p></>
            ) : forkList.length ? (
              <><h3 aria-level={2}>이 소설, 다르게 쓰고 싶다면</h3><p>{w.owner === '운영팀' ? '운영팀이' : '작가가'} <b style={{ color: 'var(--pri-ink)' }}>{w.forkAll || (w.forkEps ?? []).length === w.eps.length ? '전체 회차' : forkList.join('·') + '화'}</b>에서 포크를 허용했어요.<br />고른 회차까지의 세계관과 인물을 그대로 가져가요.</p><Go to="/writing-policy?method=fork" state={{ target: `/fork/${id}` }} className="tbtn pri">✎ 포크하기</Go></>
            ) : (
              <><h3 aria-level={2}>포크를 허용하지 않은 소설</h3><p>이 작품에서는 포크 생성이 지원되지 않거나 허용된 회차가 없어요. 공개된 회차를 읽을 수 있어요.</p><button type="button" className="tbtn" disabled>✎ 포크하기 불가</button></>
            )}
            {!w.parent && (
              <div className="ifs">
                <div className="pop-h"><b>이 원작의 포크 소설</b></div>
                {d.topForks.length ? d.topForks.slice(0, 3).map((f, i) => (
                  <Go key={f.id} to={`/work/${f.id}`} className="ifl pk"><span className={`rkn${f.canonical ? '' : ` md md${i + 1}`}`}>{i + 1}</span><div><b>{f.dir}</b><small>{f.forkAt}화에서 포크 · {f.author}{f.statisticsSupported!==false && ` · ♥ ${kfmt(f.likes)}`}</small></div></Go>
                )) : <p style={{ margin: '8px 0 0' }}>아직 포크된 전개가 없어요.</p>}
                {d.topForks.length > 0 && <Go to={`/ifs?w=${id}`} className="btn sm" style={{ width: '100%', marginTop: 8 }}>{d.topForks.length > 3 ? `전개 ${d.topForks.length}개 모두 보기 →` : '이 소설의 포크 소설 보기 →'}</Go>}
              </div>
            )}
          </aside>
        </div>
        {isPub(w) && <><WorkComments workId={w.id} canonical={!!w.canonical} start={visible.length > 0 ? start : undefined} /><WorkRecommendations work={w} /></>}
      </main>
    </div>
    <Footer />
    {vm.reporting && <ReportSheet work={w} onClose={() => vm.setReporting(false)} />}
    </>
  )
}

/** 목업 data-act="like": 누를 때마다 하트가 튀는 pop1 효과. 서버 요청이 진행 중이면(pending) 다시 누를 수 없다. */
function LikeButton({ liked, label, pending, onClick }: { liked: boolean; label: string; pending: boolean; onClick: () => void }) {
  const [pop, setPop] = useState(false)
  return (
    <button type="button" className={`ib ${liked ? 'on' : ''}${pop ? ' pop1' : ''}`} aria-label={label} aria-pressed={liked} disabled={pending}
      onClick={() => { setPop(true); onClick() }} onAnimationEnd={() => setPop(false)}><Heart /></button>
  )
}

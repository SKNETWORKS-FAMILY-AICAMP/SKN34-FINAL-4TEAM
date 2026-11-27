import { useState, type KeyboardEvent } from 'react'
import { useParams } from 'react-router'
import { FORK_WORLD_REQUIRED, forkNeedsWorld, hiddenSourceEpisode, isPub } from '../../../../domain/entities/work'

import { CoverOf } from '../../../shared/art'
import { kfmt, qs } from '../../../shared/format'
import { Go } from '../../../shared/Go'
import { ContentLoadState } from '../../../shared/ContentLoadState'
import { Branch, Bubble, Eye, Flag, Heart, Like, Share } from '../../../shared/icons'
import { Footer, Gnb } from '../../../shared/shell/Gnb'
import { ScreenTour, type TourStep } from '../../../shared/tour/ScreenTour'
import { useDocumentTitle } from '../../../shared/useDocumentTitle'
import { useSerialBoardRead } from '../viewmodel/useSerialBoardViewModel'
import { useWorkViewModel } from '../viewmodel/useWorkViewModel'
import { ReportSheet } from './Sheets'
import { SerialBoard } from './SerialBoard'
import { WorkComments } from './WorkComments'
import { WorkInfo, serialView } from './WorkInfo'
import { WorkNotices } from './WorkNotices'
import { WorkRecommendations } from './WorkRecommendations'

type Tab = 'eps' | 'info' | 'notice' | 'serial'
const TABS: readonly (readonly [Tab, string])[] = [['eps', '회차'], ['info', '정보'], ['notice', '소식']]
/** AI 자율 집필이 켜진 서버 작품에만 있는 탭(UC-18): 안은 하위 탭 '투표 | 제안 게시판'이다. */
const SERIAL_TAB = ['serial', '다음 회차'] as const

// 사용법 투어(#971)의 화면 투어(첫 진입 1회): 위쪽의 읽기 버튼과 탭을 소개한다. 다음 회차 탭은 해당 작품에만 있어 없으면 단계에서 빠진다. 탭 안의 내용은 탭별 투어가 맡고, 사용법 버튼은 지금 탭의 투어를 연다.
const tour: TourStep[] = [
  { target: 'work-read', title: '읽기 시작', text: '공개된 회차를 읽기 시작해요. 읽던 작품이면 읽던 회차부터 이어서 읽어요.' },
  { target: 'work-tabs', title: '회차·정보·소식', text: '탭을 바꿔 회차 목록과 작품 정보, 작가의 작품 공지(소식)를 봐요. 탭은 처음 열 때마다 그 탭의 사용법이 한 번 나오고, 사용법 버튼으로 다시 볼 수 있어요.' },
  { target: 'work-serial', title: '다음 회차', text: '이 작품은 AI 자율 연재 중이에요. 다음 회차를 위해 투표하거나 제안 게시판에 글을 쓸 수 있어요.' },
]

// 탭별 사용법 투어(#971): 탭을 처음 열 때(화면 투어 다음) 그 탭 안의 실제 버튼·입력을 짚는다. 대상은 data-tour="work-<탭>-<이름>"이고, 사용법 버튼은 지금 탭의 투어를 연다.
// 포크 안내·키워드·설정 위키 링크처럼 그 작품에 없는 대상의 단계는 빠진다. 소식 탭은 작가가 아닌 독자에게도 목록 안내 한 단계가 남는다.
const tabTours: Record<string, TourStep[]> = {
  eps: [
    { target: 'work-eps-tools', title: '회차 정렬·검색', text: '1화부터·최신순으로 정렬하고 회차 제목·본문으로 검색해요.' },
    { target: 'work-eps-first', title: '회차 읽기', text: '회차를 누르면 바로 읽어요. 읽은 기록이 있으면 \'읽음\'·\'읽는 중\'으로 표시돼요.' },
    { target: 'work-eps-fork', title: '포크', text: `작가가 허용한 회차에서는 이야기를 갈라(Fork) 나만의 작품으로 이어 쓸 수 있어요. 고른 회차까지의 세계관과 인물을 그대로 가져가요. ${FORK_WORLD_REQUIRED}` },
  ],
  info: [
    { target: 'work-info-summary', title: '작품 소개', text: '작가가 쓴 한 줄 소개와 줄거리를 읽어요.' },
    { target: 'work-info-keywords', title: '키워드', text: '키워드를 누르면 같은 키워드의 소설 목록으로 가요.' },
    { target: 'work-info-detail', title: '상세 정보', text: '작가·장르·연재 주기·연령 등급·총 회차를 확인해요. 분기 작품은 원작으로 가는 링크도 여기 있어요.' },
    { target: 'work-info-wiki', title: '설정 위키', text: '세계관 설정을 모아 보는 위키예요. 여기서는 발행된 최신 회차까지 공개된 설정이 보이고, 읽는 중에 회차 화면의 \'설정\'을 누르면 그 회차까지 공개된 설정만 보여서 스포일러를 피할 수 있어요.' },
  ],
  notice: [
    { target: 'work-notice-form', title: '소식 올리기', text: '분류·제목·내용을 적고 \'소식 등록\'으로 독자에게 알려요. \'상단 고정\'을 켜면 그 소식을 위에 고정해요.' },
    { target: 'work-notice-list', title: '작품 소식', text: '작가가 올린 작품 공지가 모여요. 작가는 소식마다 수정·상단 고정·삭제를 할 수 있고, 소식은 작품을 공개한 뒤에 보고 올릴 수 있어요.' },
  ],
  serial: [
    { target: 'work-serial-tabs', title: '투표 · 제안 게시판', text: '\'투표\'에서는 다음 회차의 전개 선택지에 투표하고, \'제안 게시판\'에서는 쓰고 싶은 전개를 글로 제안해요. 마감 때 AI가 이를 참고해 다음 회차를 써요.' },
    { target: 'work-serial-vote', title: '전개 투표', text: '선택지 하나에 표를 줘요. 표는 하나만 줄 수 있고 다른 선택지로 옮기거나 \'투표 취소\'로 취소해요. 투표하려면 로그인해야 해요.' },
    { target: 'work-serial-write', title: '제안 쓰기', text: '\'글쓰기\'로 제안 유형·제목·내용을 적어 올려요. 마음에 드는 제안은 추천하고, 추천을 많이 받은 글 3개를 AI가 참고해요.' },
  ],
}

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
  // '다음 회차' 탭을 보일지(enabled)와 탭 안 게시판이 같은 읽기를 쓰도록 여기서 한 번만 읽는다. 서버 공개 작품만 읽는다.
  const serial = useSerialBoardRead(d ? d.work : undefined)
  if (d === undefined) return <><Gnb/><main className="wrap" id="main" tabIndex={-1}><ContentLoadState failed={vm.isError} retry={vm.retry}/></main></>
  if (d === null) return <UnavailableWork />
  const { work: w, parent: p, visible, last, read, liked, likes, forks, forkList } = d
  // Fork는 세계관이 연결된 원작에서만 만든다. 서버가 미연결을 알린 작품은 포크 버튼을 잠그고 이유를 보인다(서버도 409로 막는다).
  const noWorld = forkNeedsWorld(w)
  const first = visible.find(([e, i]) => !hiddenSourceEpisode(w, i + 1, e.p)) ?? visible[0]
  const start = last && visible.some(([e, i]) => i + 1 === last && !hiddenSourceEpisode(w, last, e.p)) ? last : (first?.[1] ?? 0) + 1
  const sv = serialView(w)
  // 사용법 투어의 '첫 회차' 대상: 검색에 가려지지 않은 첫 회차(검색 중에는 전체 목록의 첫 회차가 숨는다).
  const firstShown = vm.episodes.find((x) => x.match)?.n
  const tabs = serial.data?.enabled ? [...TABS, SERIAL_TAB] : TABS
  // 이웃 작품으로 옮기면 탭 상태가 남으므로, 켜지지 않은 작품에서는 '다음 회차'를 고른 채로 두지 않고 회차 탭으로 돌아온다.
  const current: Tab = tab === 'serial' && !serial.data?.enabled ? 'eps' : tab
  /** 탭 목록의 방향키·Home·End로 탭을 옮깁니다(끝에서는 돌아서 이어짐). 선택한 탭만 Tab 순서에 들어갑니다. */
  const moveTab = (e: KeyboardEvent) => {
    const i = tabs.findIndex(([k]) => k === current)
    const to = e.key === 'ArrowRight' ? i + 1 : e.key === 'ArrowLeft' ? i - 1 : e.key === 'Home' ? 0 : e.key === 'End' ? tabs.length - 1 : null
    if (to === null) return
    e.preventDefault()
    const next = tabs[(to + tabs.length) % tabs.length][0]
    setTab(next)
    document.getElementById(`tab-${next}`)?.focus()
  }
  return (
    <>
    <Gnb />
    <div className={`calm calm-${w.theme}`}>
      <main className="wrap" id="main" tabIndex={-1}>
        <section className="whero">
          <div className="cover"><CoverOf w={w} /></div>
          <div className="whero-body">
            <div>
              <span className="g">{w.genre}</span>{w.auto?.on && <span className="chip ok">🤖 AI 자율 연재 중</span>}{sv.days && <span className="g wsched">{sv.days}</span>}{sv.badge && <span className={`chip ${sv.badge === '연재 중' ? 'ok' : sv.badge === '휴재' ? 'wait' : ''}`}>{sv.badge}</span>}{p && <Go to={`/work/${p.id}`} className="chip ok"><Branch /> 「{p.title}」 {w.forkAt}화에서 분기</Go>}
              <h1>{w.title}</h1><div className="by">{w.by}</div>{p && <div className="by" style={{ marginTop: 6 }}>“{w.dir}”</div>}
            </div>
            <div className="acts">
              {visible.length > 0 && <Go to={`/read/${id}/${start}`} className="tbtn pri" data-tour="work-read">읽기 시작</Go>}
              {!!last && <Go to={`/read/${id}/1`} className="tbtn">처음부터</Go>}
              {w.canonical && <Go to={`/work/${id}/wiki`} className="tbtn" data-tour="work-info-wiki">설정 위키</Go>}
              <div className="ibs">
                <LikeButton liked={liked} label={w.canonical ? '좋아요' : '관심 소설'} pending={vm.likePending} onClick={vm.toggleLike} />
                <button type="button" className="ib" aria-label="공유" onClick={vm.share}><Share /></button>
              </div>
              {vm.canInterest && (vm.isMember
                ? <button type="button" className="tbtn" disabled={vm.interestBusy} onClick={vm.toggleInterest}>{vm.interested ? '관심 해제' : '관심 등록'}</button>
                : <Go to="/login" className="tbtn" onClick={vm.requireLogin}>관심 등록</Go>)}
              {vm.canReport && <button type="button" className="tbtn weak" aria-label={`${w.title} 소설 신고`} onClick={vm.startReport}><Flag /> 소설 신고</button>}
              <ScreenTour screen="work" steps={tour} tabs={tabTours} tab={current} ready={!serial.isLoading} />
            </div>
            {!!(w.hash || p?.hash)?.length && <div className="hashes">{(w.hash || p?.hash || []).map((h) => <Go key={h} to={`/tag/${encodeURIComponent(h.replace(/^#/, ''))}`} title={`${h} 소설 모아 보기`}>{h}</Go>)}</div>}
            <div className="stats">
              {(w.canonical || w.statisticsSupported!==false) && <span title="좋아요"><Like /><span className="sr-only">좋아요 </span><b id="lkc">{kfmt(likes)}</b></span>}
              {w.statisticsSupported!==false && <><span title="조회"><Eye /><span className="sr-only">조회 </span><b>{kfmt(w.views)}</b></span><span title="댓글"><Bubble /><span className="sr-only">댓글 </span><b>{w.cmts || 0}</b></span></>}
              <span title="포크 소설"><Branch /><span className="sr-only">이 소설에서 갈라진 포크 소설 </span><b>{forks.length}</b><span className="sr-only">편</span></span>
            </div>
            {d.summary && <p className="sum">{d.summary}</p>}
          </div>
        </section>
        <div className="wgrid">
          <section className="tcard eps">
            {/* 첫 조회가 실패했으면 정상 비활성(탭 없음)과 구별해 알리고 다시 읽게 한다. 다시 읽다 실패한 경우는 탭 안 배너가 맡는다. */}
            {serial.isError && !serial.data && (
              <div role="alert" className="ws-retry ws-top">
                <span className="muted">다음 회차 게시판을 불러오지 못했어요. 연결 상태를 확인한 뒤 다시 시도해 주세요.</span>
                <button type="button" className="btn sm" onClick={serial.retry}>다시 불러오기</button>
              </div>
            )}
            <div className="wtabs" role="tablist" aria-label="소설 상세 탭" data-tour="work-tabs" onKeyDown={moveTab}>
              {tabs.map(([k, label]) => <button key={k} type="button" role="tab" id={`tab-${k}`} data-tour={k === 'serial' ? 'work-serial' : undefined} aria-selected={current === k} aria-controls="panel-work" tabIndex={current === k ? 0 : -1} className={current === k ? 'on' : ''} onClick={() => setTab(k)}>{label}</button>)}
            </div>
            <div id="panel-work" role="tabpanel" aria-labelledby={`tab-${current}`}>
            {current === 'info' ? <WorkInfo work={w} parent={p} episodeCount={visible.length} /> : current === 'notice' ? <WorkNotices key={w.id} work={w} /> : current === 'serial' ? <SerialBoard key={w.id} work={w} read={serial} /> : <>
            <div className="eptool" data-tour="work-eps-tools">
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
                  <Go key={n} to={`/read/${id}/${n}`} className={`ep ${read.includes(n) ? 'read' : ''}`} data-tour={n === firstShown ? 'work-eps-first' : undefined} style={match ? undefined : { display: 'none' }}>
                    <span className="no">{n}</span>
                    <div><b>{e.t}</b><div className="d">{hidden ? '원작 삭제로 볼 수 없는 회차' : <>{inh ? '원작 스냅샷 회차' : read.includes(n) ? '읽음' : last === n ? '읽는 중' : '무료'} <i className="sep" /> {chars.toLocaleString()}자 (공백 제외){views !== undefined && <> <i className="sep" /> <span title="조회"><Eye /><span className="sr-only">조회</span> {kfmt(views)}</span></>}</>}{fc > 0 && <> <i className="sep" /> <span title="이 회차에서 갈라진 포크"><Branch /> <span className="sr-only">이 회차에서 갈라진 포크 </span>{fc}<span className="sr-only">편</span></span></>}</div></div>
                  </Go>
                )
              }) : <p className="muted" style={{ padding: 20 }}>아직 공개된 회차가 없어요.</p>}
            </div>
            <p className="muted small" id="epnone" style={{ padding: 20, display: vm.noMatch ? 'block' : 'none' }}>검색 결과가 없어요.</p>
            </>}
            </div>
          </section>
          <aside className="tcard forkbox" data-tour={!p && !w.parentDeleted && forkList.length ? 'work-eps-fork' : undefined}>
            {p ? (
              <><h2>원작 보기</h2><p>이 소설은 「{p.title}」 {w.forkAt}화를 기준으로 분기했어요.{w.canonical ? ' 그 뒤 이야기는 이 소설에서 따로 이어져요.' : ' 이후 바뀐 설정은 이 소설에만 저장돼요.'}</p><Go to={`/work/${p.id}`} className="tbtn">원작으로 가기</Go></>
            ) : w.parentDeleted ? (
              <><h2>삭제된 원작</h2><p>이 소설은 「{w.parentTitle}」 {w.forkAt}화를 기준으로 분기했어요. 원작이 삭제돼 원작으로 이동할 수 없고, 분기 전 회차 본문은 독자에게 보이지 않아요.</p></>
            ) : forkList.length ? (
              <><h2>이 소설, 다르게 쓰고 싶다면</h2><p>{w.owner === '운영팀' ? '운영팀이' : '작가가'} <b style={{ color: 'var(--pri-ink)' }}>{w.forkAll || (w.forkEps ?? []).length === w.eps.length ? '전체 회차' : forkList.join('·') + '화'}</b>에서 포크를 허용했어요.<br />고른 회차까지의 세계관과 인물을 그대로 가져가요.</p>{noWorld
                ? <><button type="button" className="tbtn pri" disabled aria-describedby="fork-world-note">✎ 포크하기</button><p id="fork-world-note" className="small muted">{FORK_WORLD_REQUIRED}</p></>
                : <Go to={qs('/writing-policy', { method: 'fork', work: id })} className="tbtn pri">✎ 포크하기</Go>}</>
            ) : (
              <><h2>포크를 허용하지 않은 소설</h2><p>이 작품에서는 포크 생성이 지원되지 않거나 허용된 회차가 없어요. 공개된 회차를 읽을 수 있어요.</p></>
            )}
            {!w.parent && (
              <div className="ifs">
                <div className="pop-h"><b>이 원작의 포크 소설</b></div>
                {d.topForks.length ? d.topForks.slice(0, 3).map((f, i) => (
                  <Go key={f.id} to={`/work/${f.id}`} className="ifl pk"><span className={`rkn${f.canonical ? '' : ` md md${i + 1}`}`}>{i + 1}</span><div><b>{f.title}</b><small>{f.forkAt}화에서 포크 · {f.author} · “{f.dir}”{f.statisticsSupported!==false && ` · ♥ ${kfmt(f.likes)}`}</small></div></Go>
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

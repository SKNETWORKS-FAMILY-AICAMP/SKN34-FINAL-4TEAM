import { useRef, useState } from 'react'
import { publicationActionLabel, type Work } from '../../../../domain/entities/content'
import type { EpisodeUseCase } from '../../../../domain/usecases/EpisodeUseCase'
import { Go } from '../../../shared/Go'
import { Branch } from '../../../shared/icons'
import { ManuscriptBody } from '../../../shared/media/MediaPanel'
import { paginate } from '../../../shared/paginate'
import { Pager } from '../../../shared/Pager'
import { EditSuggestionInbox } from '../../inbox/view/EditSuggestionInbox'
import { FeedbackReportInbox } from '../../inbox/view/FeedbackReportInbox'
import { inheritedRangeLabel } from '../viewmodel/inheritedRange'
import { useEpisodeForkCounts } from '../viewmodel/useEpisodeForkCounts'
import type { useEpisodeViewModel } from '../viewmodel/useEpisodeViewModel'
import { ContextPreview } from './ContextPreview'
import { WorkOverview } from './WorkOverview'
import { WorldPanel } from './WorldPanel'

type Props = {
  vm: ReturnType<typeof useEpisodeViewModel>
  work: Work
  /** 테스트가 넣는 UseCase. 세계관·설정집이 같은 UseCase를 쓴다. */
  useCase?: EpisodeUseCase
  onForked: (id: string) => void
  onDeleted: () => void
}

/**
 * 고른 내 작품의 관리 영역: 히어로·분기 정책(또는 포크 정보) + 탭(회차 목록·세계관·설정집 요약·이야기 분기·받은 피드백·이력).
 * 작품이 바뀌면 호출 측이 key로 새로 만들어 탭·분기 입력이 처음 상태로 돌아간다.
 */
export function WorkManagement({ vm, work: w, useCase, onForked, onDeleted }: Props) {
  const [tab, setTab] = useState<'read' | 'fork' | 'history' | 'world' | 'feedback'>('read')
  const [mediaBusy, setMediaBusy] = useState(false)
  const [forkTitle, setForkTitle] = useState('')
  const [direction, setDirection] = useState('')
  const [at, setAt] = useState(1)
  // 회차 목록은 10개씩 나눠 보인다. page는 목록이 줄어도 paginate가 범위 안으로 보정한다.
  const [page, setPage] = useState(1)
  const episodeList = useRef<HTMLOListElement>(null)
  const view = paginate(w.episodes, page)
  const locked = vm.busy || mediaBusy
  // 서버가 없는 목업 빌드는 서버 수정 제안을 부르지 않는다(InboxPage와 같다). 정적 JSX에 두면 모듈 로드 때 한 번만 평가되므로 렌더 시점 변수로 읽는다.
  const mockup = import.meta.env.MODE === 'mockup'
  // 상속 회차가 있으면 '1~2화'처럼 줄여, 그 회차들은 수정할 수 없다고 따로 알린다.
  const inherited = inheritedRangeLabel(w.episodes)
  // 회차별로 갈라진 공개 포크 수(소설 상세와 같은 목록). 불러오는 중이거나 읽지 못하면 undefined라 수를 감춘다(0편으로 채우지 않는다).
  const forkCounts = useEpisodeForkCounts(w.id)
  return (
    <>
      <WorkOverview
        work={w}
        locked={locked}
        busy={vm.busy}
        nextNo={w.writingEpisodeNumber ?? w.episodes.length + 1}
        coverRevision={vm.coverRevision}
        onMediaBusy={setMediaBusy}
        onSaveInfo={vm.updateWork}
        onSavePolicy={vm.policy}
        onStopFork={vm.stopFork}
        onDeleteFork={async () => {
          const deleted = await vm.deleteFork()
          if (deleted) onDeleted()
          return deleted
        }}
      />
      <nav className='ep-tabs' aria-label='작품 메뉴'>
        {([
          ['read', `회차 · ${w.episodes.length}`],
          ['world', '세계관·설정집'],
          ['fork', '이야기 분기'],
          ['feedback', '받은 피드백'],
          ['history', '저장·AI·발행 이력'],
        ] as const).map(([value, label]) => (
          <button
            key={value}
            disabled={locked}
            aria-current={tab === value ? 'page' : undefined}
            onClick={() => {
              setTab(value)
              if (value === 'history') void vm.loadHistory()
            }}
          >
            {label}
          </button>
        ))}
      </nav>
      {tab === 'world' && <WorldPanel workId={w.id} useCase={useCase} />}
      {tab === 'history' && (
        <section className='ep-reading'>
          <h2>저장·AI·발행 이력</h2>
          <p>저장본은 보존돼요. 이 화면에서는 이력을 읽기만 하고, 복원과 공개는 집필실에서 해요.</p>
          {vm.history && (
            <>
              <h3>발행 이력</h3>
              {!vm.history.publicationHistory?<p role="alert">발행 이력 응답을 확인할 수 없어요.</p>:vm.history.publicationHistory.length?<ol>{vm.history.publicationHistory.map((event,i)=><li key={i}>
                {event.episode}화 · {publicationActionLabel[event.action]} · {new Date(event.publishedAt).toLocaleString('ko-KR')} · 버전 {event.versionId}
              </li>)}</ol>:<p>발행 이력이 없어요.</p>}
              <h3>원고 저장본</h3>
              {vm.history.versions.length === 0 && (
                <p>
                  아직 보관된 저장본이 없어요. 원고를 저장하면 버전 이력을 확인할 수 있어요.
                </p>
              )}
              {vm.history.versions.map((v) => (
                <article key={v.id}>
                  <h3>{v.episode}화 · 저장 버전 {v.revision} · {v.title}</h3>
                  <time>{new Date(v.savedAt).toLocaleString('ko-KR')}</time>
                  <ManuscriptBody workId={w.id} number={v.episode} body={v.body} />
                </article>
              ))}
              <h3>AI 요청·제안</h3>
              {vm.history.proposals.length === 0 && <p>아직 AI 제안이 없어요.</p>}
              {vm.history.proposals.map((p) => (
                <article key={p.id}>
                  <h3>
                    {p.model} · {p.status === 'accepted' ? '적용 완료' : '검토 대기'}
                  </h3>
                  <p>{p.prompt ?? '지시문 기록 없음'}</p>
                  {p.baseBody !== undefined && (
                    <details>
                      <summary>요청 당시 원고</summary>
                      <div>{p.baseBody}</div>
                    </details>
                  )}
                  {p.context && (
                    <details>
                      <summary>요청 당시 설정·문맥 근거</summary>
                      <ContextPreview value={p.context} />
                    </details>
                  )}
                  <div>{p.text}</div>
                </article>
              ))}
            </>
          )}
        </section>
      )}
      {tab === 'read' && (
        <>
          <div className='ep-notes'>
            <p>
              {w.visibility === 'public'
                ? '공개된 회차만 표시해요. 작성 중인 초안은 포함되지 않아요.'
                : '아직 독자에게 공개하지 않은 작품이에요.'}
            </p>
            {inherited && <p>{inherited}는 원작에서 이어받은 회차라 수정할 수 없어요.</p>}
          </div>
          {w.episodes.length
            ? (
              // 소설 상세(/work/:id)의 회차 행(.ep)을 그대로 쓰고, 오른쪽에 자체 회차는 집필실로 가는 '수정하기', 상속 회차는 읽기 전용 칩을 둔다. 본문은 펼치지 않는다.
              // 10개씩 나눠 보인다. 쪽을 옮기면 이 머리로 스크롤하므로 위의 sticky 상단바(.gnb)가 가리지 않게 scroll-margin을 둔다.
              <ol ref={episodeList} className='tcard eps ep-list' style={{ scrollMarginTop: 80 }}>
                {view.items.map((e) => {
                  const forks = forkCounts?.[e.number] ?? 0
                  return (
                    <li key={e.number} className='ep'>
                      <span className='no'>{e.number}</span>
                      <div>
                        <b>{e.title}</b>
                        <div className='d'>
                          {e.body.replace(/\s/g, '').length.toLocaleString()}자 <i className='sep' /> v{e.version}
                          {forks > 0 && <> <i className='sep' /> <span title='이 회차에서 갈라진 포크'><Branch /> <span className='sr-only'>이 회차에서 갈라진 포크 </span>{forks}<span className='sr-only'>편</span></span></>}
                        </div>
                      </div>
                      {e.inherited
                        ? <span className='chip'>원작 회차</span>
                        : (
                          <Go to={`/studio/${w.id}?ep=${e.number}`} className='btn sm' aria-label={`${e.number}화 ${e.title} 수정하기`}>
                            수정하기
                          </Go>
                        )}
                    </li>
                  )
                })}
              </ol>
            )
            : (
              <div className='ep-empty'>
                아직 공개한 회차가 없어요. 첫 회차를 작성해 보세요.
              </div>
            )}
          {/* 쪽을 옮기면 목록 머리로 스크롤만 한다. 초점은 누른 쪽 버튼에 남아 이어서 옮길 수 있다(scrollIntoView가 없는 jsdom에서는 건너뛴다). */}
          <Pager page={view.page} pages={view.pages} onPage={(next) => { setPage(next); episodeList.current?.scrollIntoView?.({ block: 'start' }) }} />
          <div className='ep-list-foot'>
            <Go to={`/studio/${w.id}`} className='btn pri'>새 회차 집필하기</Go>
          </div>
        </>
      )}
      {tab === 'fork' && (
        <section className='ep-fork'>
          <h2>그 순간, 다른 선택을 했다면</h2>
          <p className='ep-lead'>
            선택한 회차까지의 공개 원고를 보존하고,<br />그 다음 회차부터 새로운 이야기를
            써 내려가세요. 기준 회차의 공개 설정·상태·지식·관계도 함께 이어져요.
          </p>
          {w.source || w.visibility !== 'public' || !w.allowFork
            ? (
              <div className='ep-empty'>
                분기를 허용한 공개 원작에서만 시작할 수 있어요. 분기 작품은 다시 분기할 수
                없어요.<br />분기 정책에서 분기 만들기를 허용하고, 회차는 집필실에서 공개해 주세요.
              </div>
            )
            : (
              <form
                onSubmit={async (e) => {
                  e.preventDefault()
                  const id = await vm.fork(at, forkTitle, direction)
                  if (id) onForked(id)
                }}
              >
                <label>
                  기준 회차<select
                    value={at}
                    onChange={(e) => setAt(Number(e.target.value))}
                    disabled={locked}
                  >
                    {w.episodes.map((e) => (
                      <option key={e.number} value={e.number}>
                        {e.number}화 · {e.title} · v{e.version}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  분기 작품 제목<input
                    value={forkTitle}
                    onChange={(e) => setForkTitle(e.target.value)}
                    maxLength={120}
                    required
                    disabled={locked}
                  />
                </label>
                <label>
                  무엇이 달라지나요? (선택)<textarea
                    value={direction}
                    onChange={(e) => setDirection(e.target.value)}
                    placeholder='주인공이 그 편지를 읽지 않았다면…'
                    maxLength={2000}
                    rows={4}
                    disabled={locked}
                  />
                </label>
                <button className='btn pri' disabled={locked}>
                  이 회차에서 분기 만들기
                </button>
              </form>
            )}
        </section>
      )}
      {tab === 'feedback' && (
        // 독자가 이 작품에 보낸 문장 제보·수정 제안. 작가 피드백함(/inbox)의 View를 그대로 쓰고, 서버에 workId로 이 작품 것만 묻는다.
        <div className='ep-feedback'>
          <FeedbackReportInbox workId={w.id} />
          {!mockup && <EditSuggestionInbox workId={w.id} />}
        </div>
      )}
    </>
  )
}

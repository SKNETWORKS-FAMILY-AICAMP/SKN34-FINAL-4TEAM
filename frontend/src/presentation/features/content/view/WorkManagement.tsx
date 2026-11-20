import { useEffect, useId, useRef, useState } from 'react'
import { publicationActionLabel, savedVersionLabel, type Version, type Work } from '../../../../domain/entities/content'
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
import { EpisodeBulkImportSheet } from './EpisodeBulkImportSheet'
import { LinkedWorldPanel } from './LinkedWorldPanel'
import { WorkOverview } from './WorkOverview'
import { WorkSettingsPanel } from './WorkSettingsPanel'
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
 * 고른 내 작품의 관리 영역: 왼쪽 사이드바 메뉴(회차 목록·세계관 연결과 설정집 요약·이야기 분기·받은 피드백·운영 설정·이력)와 오른쪽 내용 열(맨 위 히어로·분기 정책(또는 포크 정보), 그 아래 고른 메뉴의 내용).
 * 작품이 바뀌면 호출 측이 key로 새로 만들어 메뉴 선택·분기 입력이 처음 상태로 돌아간다. 메뉴 틀(.ep-manage·.ep-menu·.ep-content)은 shared/episode.css이고 세계관 관리 화면과 함께 쓴다.
 */
export function WorkManagement({ vm, work: w, useCase, onForked, onDeleted }: Props) {
  const [tab, setTab] = useState<'read' | 'fork' | 'history' | 'world' | 'feedback' | 'settings'>('read')
  const [mediaBusy, setMediaBusy] = useState(false)
  const [bulkImportOpen, setBulkImportOpen] = useState(false)
  const [forkTitle, setForkTitle] = useState('')
  const [direction, setDirection] = useState('')
  const [at, setAt] = useState(1)
  // 회차 목록은 10개씩 나눠 보인다. page는 목록이 줄어도 paginate가 범위 안으로 보정한다.
  const [page, setPage] = useState(1)
  const episodeList = useRef<HTMLOListElement>(null)
  // 탭 내용은 위의 히어로·분기 정책 카드 아래(접힌 선 밖)에서 시작해 눌러도 바뀐 것이 안 보였다. 메뉴를 눌러 탭이 바뀐 직후에만(첫 렌더·새로 고침 제외) 렌더가 커밋된 뒤 내용 머리로 스크롤하고, 초점은 누른 버튼에 그대로 둔다(아래 Pager와 같은 이유).
  const tabContent = useRef<HTMLDivElement>(null)
  const picked = useRef(false)
  useEffect(() => {
    if (!picked.current) return
    picked.current = false
    tabContent.current?.scrollIntoView?.({ block: 'start' })
  }, [tab])
  const view = paginate(w.episodes, page)
  // 작성 중인 초안: 발행 전이고 초안이 있는 자체 회차. 공개를 중단한 회차(suspended)는 발행본이 없어도 초안이 아니다.
  const drafts = vm.writing?.rows?.filter(e => !e.inherited && !e.publishedVersionId && e.publicationStatus !== 'suspended' && e.hasDraft !== false)
  // 저장 버전 순번은 소유자 회차 조회의 versions 순서다. 그 목록을 아직 읽는 중이면 못 찾은 '미확인'과 구분해 '불러오는 중'으로 보인다.
  const savedVersion = (episode: number, id?: string) => !vm.writing
    ? '저장 버전 불러오는 중'
    : savedVersionLabel(vm.writing.rows?.find(r => r.number === episode)?.versions ?? [], id)
  const locked = vm.busy || mediaBusy
  // 서버가 없는 목업 빌드는 서버 수정 제안을 부르지 않는다(InboxPage와 같다). 정적 JSX에 두면 모듈 로드 때 한 번만 평가되므로 렌더 시점 변수로 읽는다.
  const mockup = import.meta.env.MODE === 'mockup'
  // 상속 회차가 있으면 '1~2화'처럼 줄여, 그 회차들은 수정할 수 없다고 따로 알린다.
  const inherited = inheritedRangeLabel(w.episodes)
  // 회차별로 갈라진 공개 포크 수(소설 상세와 같은 목록). 불러오는 중이거나 읽지 못하면 undefined라 수를 감춘다(0편으로 채우지 않는다).
  const forkCounts = useEpisodeForkCounts(w.id)
  return (
    <div className='ep-manage'>
      <div className='ep-menu'>
        <nav aria-label='작품 메뉴'>
          {([
            ['read', `공개 회차 · ${w.episodes.length}`],
            ['world', '세계관·설정집'],
            ['fork', '이야기 분기'],
            ['feedback', '받은 피드백'],
            ...(!mockup ? [['settings', '운영 설정']] as const : []),
            ['history', '저장·AI·발행 이력'],
          ] as const).map(([value, label]) => (
            <button
              key={value}
              // 요청 중에는 다른 탭으로 옮기지 못하게 잠그되, 지금 탭은 두어 방금 누른 버튼에서 키보드 초점이 사라지지 않게 한다(이력 탭은 누르면 곧 요청이 시작된다).
              disabled={locked && tab !== value}
              aria-current={tab === value ? 'page' : undefined}
              onClick={(e) => {
                // 900px 이하의 가로 스크롤 줄에서 가장자리에 잘린 메뉴를 눌러도 그 버튼이 줄 안에 다 보이게 옆으로만 옮긴다(세로는 위 effect가 탭 내용 머리로 옮긴다).
                e.currentTarget.scrollIntoView?.({ inline: 'nearest', block: 'nearest' })
                picked.current = true
                setTab(value)
                if (value === 'history') void vm.loadHistory()
              }}
            >
              {label}
            </button>
          ))}
        </nav>
      </div>
      <div className='ep-content'>
        <WorkOverview
          work={w}
          locked={locked}
          busy={vm.busy}
          draftCount={vm.writing ? drafts?.length : null}
          coverRevision={vm.coverRevision}
          onMediaBusy={setMediaBusy}
          onSaveInfo={vm.updateWork}
          onSuggestTags={vm.suggestTags}
          onSavePolicy={vm.policy}
          onStopFork={vm.stopFork}
          onDeleteWork={async () => {
            const deleted = await vm.deleteWork()
            if (deleted) onDeleted()
            return deleted
          }}
        />
        {/* 탭 내용 묶음: 메뉴를 누르면 이 머리로 스크롤한다. scroll-margin은 sticky 상단바(.gnb)가 머리를 가리지 않게(회차 목록과 같은 값). */}
        <div ref={tabContent} className='ep-tab' style={{ scrollMarginTop: 80 }}>
          {tab === 'settings' && <WorkSettingsPanel workId={w.id} useCase={useCase} />}
          {tab === 'world' && (
            <>
              <LinkedWorldPanel work={w} busy={locked} onLink={vm.linkWorld} onDetach={vm.detachWorld} error={vm.origin === 'link' ? vm.error : ''} notice={vm.origin === 'link' ? vm.notice : ''} detachError={vm.origin === 'detach' ? vm.error : ''} useCase={useCase} />
              <WorldPanel workId={w.id} useCase={useCase} locked={locked} onMediaBusy={setMediaBusy} />
            </>
          )}
          {tab === 'history' && (
            <section className='ep-reading'>
              <h2>저장·AI·발행 이력</h2>
              <p>저장본은 보존돼요. 이 화면에서는 이력을 읽기만 하고, 복원과 공개는 집필실에서 해요.</p>
              {/* 이력 요청의 진행·실패는 맨 위 알림(탭 머리로 스크롤하면 화면 밖)이 아니라 여기서 알린다. 다른 요청과 섞이지 않게 origin이 history일 때만 보인다. */}
              {vm.origin === 'history' && vm.error && <p className="ep-alert" role="alert">{vm.error}</p>}
              {vm.origin === 'history' && vm.busy && !vm.history && <p role='status'>이력을 불러오고 있어요…</p>}
              {vm.history && (
                <>
                  <h3>발행 이력</h3>
                  {!vm.history.publicationHistory?<p className="ep-alert" role="alert">발행 이력 응답을 확인할 수 없어요.</p>:vm.history.publicationHistory.length?<ol role='list' className='ep-settings-history'>{vm.history.publicationHistory.map((event,i)=><li key={i}>
                    {event.episode}화 · {publicationActionLabel[event.action]} · {new Date(event.publishedAt).toLocaleString('ko-KR')} · {savedVersion(event.episode, event.versionId)}
                  </li>)}</ol>:<p>발행 이력이 없어요.</p>}
                  <h3>원고 저장본</h3>
                  {vm.history.versions.length === 0 && (
                    <p>
                      아직 보관된 저장본이 없어요. 원고를 저장하면 버전 이력을 확인할 수 있어요.
                    </p>
                  )}
                  {vm.history.versions.map((v) => <SavedVersion key={v.id} workId={w.id} version={v} label={savedVersion(v.episode, v.id)} />)}
                  <h3>AI 요청·제안</h3>
                  {vm.history.proposals.length === 0 && <p>아직 AI 제안이 없어요.</p>}
                  {vm.history.proposals.map((p) => (
                    <article key={p.id}>
                      <h4>
                        {p.model} · {p.status === 'accepted' ? '적용 완료' : '검토 대기'}
                      </h4>
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
              {vm.writing?.error && <p className="ep-alert" role="alert">{vm.writing.error}</p>}
              {!!drafts?.length && (
                <section className="ep-drafts">
                  <h2>작성 중인 초안</h2>
                  <ul role="list">
                    {drafts.map(e => (
                      <li key={e.number}>
                        <Go to={`/studio/${w.id}?ep=${e.number}`}>
                          {e.number}화 · {e.draft.title}
                        </Go>
                      </li>
                    ))}
                  </ul>
                </section>
              )}
              <div className='ep-notes'>
                <p>
                  {w.visibility === 'public'
                    ? '아래 목록은 독자가 볼 수 있는 발행본이에요.'
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
                              {e.body.length.toLocaleString()}자 (공백 포함)
                              {/* 상속 회차는 저장 버전이 없다(원작 기준 원고). 공개 중인 저장 버전만 순번으로 알린다. */}
                              {!e.inherited && <> <i className='sep' /> 공개 중 · {savedVersion(e.number, e.versionId)}</>}
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
                    아직 공개한 회차가 없어요.{!drafts?.length && ' 첫 회차를 작성해 보세요.'}
                  </div>
                )}
              {/* 쪽을 옮기면 목록 머리로 스크롤만 한다. 초점은 누른 쪽 버튼에 남아 이어서 옮길 수 있다(scrollIntoView가 없는 jsdom에서는 건너뛴다). */}
              <Pager page={view.page} pages={view.pages} onPage={(next) => { setPage(next); episodeList.current?.scrollIntoView?.({ block: 'start' }) }} />
              <div className='ep-list-foot'>
                <Go to={`/studio/${w.id}`} className='btn'>새 회차 집필하기</Go>
                {!mockup && <button type="button" className="btn" disabled={locked}
                  onClick={() => setBulkImportOpen(true)}>회차 파일 일괄 업로드</button>}
              </div>
              {bulkImportOpen && <EpisodeBulkImportSheet workId={w.id} onClose={(refresh) => {
                setBulkImportOpen(false)
                if (refresh) void vm.reload()
              }} />}
            </>
          )}
          {tab === 'fork' && (
            <section className='ep-fork'>
              <h2>그 순간, 다른 선택을 했다면</h2>
              <p className='ep-lead'>
                선택한 회차까지의 공개 원고를 보존하고, 그 다음 회차부터 새로운 이야기를
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
                    {/* 분기를 만들지 못한 사유는 누른 버튼 바로 위에 알린다(화면 맨 위 알림은 이 자리에서 보이지 않는다). */}
                    {vm.origin === 'fork' && vm.error && <div className='ep-alert' role='alert'>{vm.error}</div>}
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
        </div>
      </div>
    </div>
  )
}

/**
 * 이력 탭의 저장 버전 한 건. 제목과 저장 시각만 먼저 보이고 본문은 '원고 보기'로 펼칠 때 그린다.
 * 저장본이 쌓여도 모든 본문과 그 안의 이미지를 한꺼번에 그리거나 내려받지 않는다.
 */
function SavedVersion({ workId, version: v, label }: { workId: string; version: Version; label: string }) {
  const [open, setOpen] = useState(false)
  const title = useId()
  return (
    <article>
      <h4 id={title}>{v.episode}화 · {label} · {v.title}</h4>
      <p><time>{new Date(v.savedAt).toLocaleString('ko-KR')}</time></p>
      <p>
        <button type='button' className='btn sm' aria-expanded={open} aria-describedby={title} onClick={() => setOpen((shown) => !shown)}>
          {open ? '원고 접기' : '원고 보기'}
        </button>
      </p>
      {open && <ManuscriptBody workId={workId} number={v.episode} body={v.body} />}
    </article>
  )
}

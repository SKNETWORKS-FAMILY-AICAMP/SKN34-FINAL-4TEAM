import { useId, type ReactNode } from 'react'
import { publicationActionLabel, type Work } from '../../../../domain/entities/content'
import type { EpisodeUseCase } from '../../../../domain/usecases/EpisodeUseCase'
import { kstDateTime } from '../../../shared/format'
import { Go } from '../../../shared/Go'
import { useWorkDashboard, type ReaderMetrics } from '../viewmodel/useWorkDashboard'

const number = (value: number) => value.toLocaleString('ko-KR')
/** 읽는 중: 모르는 값을 0으로 채우지 않고 자리만 잡는다. */
const LOADING = <>…<span className='sr-only'>불러오는 중</span></>
const FAILED = '불러오지 못했어요'

/** 글자(공개 전·집계 없음·실패)는 숫자 칸보다 작은 보조 글이다. */
function Metric({ label, note, children }: { label: string; note?: boolean; children: ReactNode }) {
  return <div><dt>{label}</dt><dd className={note ? 'ep-muted' : undefined}>{children}</dd></div>
}

/** 바로가기 한 칸. 잠기면(편집·요청 중) 같은 모양의 잠긴 버튼으로 그린다: 링크는 잠글 수 없어, 그대로 두면 집필실·소설 상세로 떠나 저장하지 않은 입력을 잃는다. */
function Shortcut({ to, disabled, children }: { to: string; disabled: boolean; children: string }) {
  return disabled
    ? <button type='button' className='btn ep-shortcut' disabled>{children}</button>
    : <Go to={to} className='btn ep-shortcut'>{children}</Go>
}

function ReaderMetric({ label, state, pick }: { label: string; state: { data: ReaderMetrics | undefined; isLoading: boolean; isError: boolean }; pick: (stats: { likes: number; views: number }) => string }) {
  if (state.isError) return <Metric label={label} note>{FAILED}</Metric>
  if (state.isLoading) return <Metric label={label}>{LOADING}</Metric>
  if (state.data === 'before') return <Metric label={label} note>공개 전</Metric>
  if (!state.data) return <Metric label={label} note>집계 없음</Metric>
  return <Metric label={label}>{pick(state.data)}</Metric>
}

type Props = {
  work: Work
  /** 작성 중인 초안 수. null이면 아직 읽는 중이라 자리만 보이고, undefined이면 읽지 못해 항목을 감춘다(0으로 채우지 않는다). */
  draftCount?: number | null
  /** 회차별 공개 포크 수. 읽는 중이거나 읽지 못하면 undefined라 항목을 감춘다(0편으로 채우지 않는다). */
  forkCounts?: Record<number, number>
  mockup: boolean
  /** 요청 중이거나 편집 폼이 열려 있는 동안은 바로가기 이동을 잠근다(메뉴와 같은 규칙). */
  disabled: boolean
  /** 테스트가 넣는 UseCase(발행 이력). 없으면 컨테이너의 것을 쓴다. */
  useCase?: EpisodeUseCase
}

/**
 * 작품 관리 개요 탭 히어로 아래의 현황: 작품 지표 카드·최근 발행 이력 5건·바로가기. 구획마다 따로 읽어(useWorkDashboard) 한 구획이 실패해도 그 안에서만 알린다.
 * 최근 발행 이력과 바로가기는 이력·세계관 탭과 같은 카드(`tcard ep-card`)다(작품 지표는 칸 하나하나가 카드라 구획을 다시 감싸지 않는다). 발행 이력 줄은 회차·동작이 왼쪽, 시각이 오른쪽 끝이다.
 * 바로가기는 사이드바 메뉴에 없는 목적지(집필실, 공개 작품이면 소설 상세)만 두고, 메뉴와 같은 탭 전환 버튼은 두지 않는다. 버튼 수만큼 같은 폭으로 줄을 채운다.
 * 독자 지표(누적 조회·좋아요)는 새 API 없이 공개 상세의 값이라, 비공개 작품은 '공개 전', 집계가 없으면 '집계 없음'이다. 어느 값도 모르면서 0으로 채우지 않는다.
 * 총 글자 수는 내가 쓴 공개 회차만 센다(이어받은 원작 회차의 글자를 내 것으로 세지 않는다).
 */
export function WorkDashboard({ work: w, draftCount, forkCounts, mockup, disabled, useCase }: Props) {
  const { reader, publications, feedback } = useWorkDashboard(w, mockup, { episodes: useCase })
  const metricsTitle = useId()
  const recentTitle = useId()
  const shortcutsTitle = useId()
  const own = w.episodes.filter((e) => !e.inherited)
  const characters = own.reduce((sum, e) => sum + e.body.length, 0)
  return (
    <div className='ep-dash'>
      <section aria-labelledby={metricsTitle}>
        <h3 id={metricsTitle}>작품 지표</h3>
        <dl className='ep-metrics'>
          <Metric label='공개 회차'>{w.episodes.length}화</Metric>
          {draftCount !== undefined && <Metric label='작성 중인 초안'>{draftCount === null ? LOADING : `${draftCount}개`}</Metric>}
          <Metric label={own.length < w.episodes.length ? '총 글자 수 · 공백 포함, 원작 회차 제외' : '총 글자 수 · 공백 포함'}>{number(characters)}자</Metric>
          {forkCounts && <Metric label='포크 수'>{number(Object.values(forkCounts).reduce((sum, count) => sum + count, 0))}편</Metric>}
          {feedback.isError
            ? <Metric label='받은 피드백' note>{FAILED}</Metric>
            : <Metric label='받은 피드백'>{feedback.data === undefined ? LOADING : `${number(feedback.data)}건`}</Metric>}
          <ReaderMetric label='누적 조회(회원)' state={reader} pick={(stats) => `${number(stats.views)}회`} />
          <ReaderMetric label='좋아요' state={reader} pick={(stats) => number(stats.likes)} />
        </dl>
      </section>
      <section className='tcard ep-card' aria-labelledby={recentTitle}>
        <h3 id={recentTitle}>최근 발행 이력</h3>
        {publications.isError
          ? <p className='ep-alert'>발행 이력을 불러오지 못했어요. <button type='button' className='btn sm' onClick={publications.retry}>다시 불러오기</button></p>
          : publications.isLoading
          ? <p className='ep-muted'>불러오고 있어요…</p>
          : publications.data?.length
          ? (
            <ol role='list' className='ep-settings-history'>
              {publications.data.map((event) => (
                <li key={`${event.publishedAt}-${event.episode}-${event.action}`}>
                  {event.episode}화 · {publicationActionLabel[event.action]}{' '}
                  <time dateTime={event.publishedAt}>{kstDateTime(event.publishedAt)}</time>
                </li>
              ))}
            </ol>
          )
          : <p className='ep-muted'>발행 이력이 없어요.</p>}
      </section>
      <section className='tcard ep-card' aria-labelledby={shortcutsTitle}>
        <h3 id={shortcutsTitle}>바로가기</h3>
        <div className='ep-shortcuts'>
          <Shortcut to={`/studio/${w.id}`} disabled={disabled}>집필실 열기</Shortcut>
          {w.visibility === 'public' && <Shortcut to={`/work/${w.id}`} disabled={disabled}>소설 상세 보기</Shortcut>}
        </div>
      </section>
    </div>
  )
}

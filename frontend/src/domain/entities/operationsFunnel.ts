import { count } from './llmOps'

/**
 * 운영 개요의 서비스 지표(DEC-57). Content가 센 전체 기간 수이고 회원 수는 서로 다른 회원 ID 기준입니다.
 * 비율·오차는 서버가 아니라 화면이 이 파일의 순수 함수로 계산합니다. Content를 읽지 못하면 대시보드의 funnel이 null이라 이 값이 없습니다.
 */
export type Funnel = {
  readers: { viewed: number; readAny: number; readNext: number }
  reactions: { publishedEpisodes: number; likes: number; interests: number; comments: number }
  /** baseEpisodes는 Fork 기준 회차 구간별 Fork 수(1·2·3·4-5·6-10·11+)이고, 구간 이름과 순서는 서버가 정한 그대로 씁니다. */
  forks: { readers: number; readerForked: number; baseEpisodes: { bucket: string; count: number }[] }
  /** medianHoursToPublish는 Fork 생성부터 첫 직접 발행까지 시간의 중앙값이며 직접 발행이 한 건도 없으면 null입니다. */
  writers: { forks: number; saved: number; published: number; medianHoursToPublish?: number | null }
  proposals: { adopted: number; total: number }
  feedback: { approved: number; decided: number }
}

/**
 * 분자 ÷ 분모를 `42.5% ±5.0%p · n=400`으로 적습니다. 오차는 95% 최악 기준 ±1/√n(%p)이고 n은 분모입니다.
 * 분모가 0이면 0%로 채우지 않고 `— · n=0`입니다.
 */
export const proportionText = (part: number, whole: number) =>
  whole > 0 ? `${(part / whole * 100).toFixed(1)}% ±${(100 / Math.sqrt(whole)).toFixed(1)}%p · n=${count(whole)}` : `— · n=${count(whole)}`

type Step = { label: string; count: number }
type Rate = { label: string; text: string }
export type FunnelGroup = { key: 'readers' | 'forks' | 'writers' | 'ai'; title: string; unit: string; steps: Step[]; rates: Rate[]; note?: string }

/** 단계 막대 4묶음. 단계 사이 비율은 직전 단계를 분모로 하고, AI 채택과 수정 제안 승인은 각자의 분모(생성 수·승인+거절 수)를 씁니다. */
export function funnelGroups({ readers, forks, writers, proposals, feedback }: Funnel): FunnelGroup[] {
  return [
    {
      key: 'readers', title: '독자 이어 읽기', unit: '명',
      steps: [{ label: '조회 기록이 있는 독자', count: readers.viewed }, { label: '1화 이상 읽음', count: readers.readAny }, { label: '이어 읽기', count: readers.readNext }],
      rates: [
        { label: '조회 → 1화 이상 읽음', text: proportionText(readers.readAny, readers.viewed) },
        { label: '1화 이상 → 이어 읽기', text: proportionText(readers.readNext, readers.readAny) },
      ],
    },
    {
      key: 'forks', title: '독자의 Fork', unit: '명',
      steps: [{ label: '1화 이상 읽은 독자', count: forks.readers }, { label: 'Fork를 만든 독자', count: forks.readerForked }],
      rates: [{ label: '독자 → Fork 생성', text: proportionText(forks.readerForked, forks.readers) }],
    },
    {
      key: 'writers', title: 'Fork 작가의 저장·발행', unit: '개',
      steps: [{ label: 'Fork 작품', count: writers.forks }, { label: '직접 저장한 Fork', count: writers.saved }, { label: '직접 발행한 Fork', count: writers.published }],
      rates: [
        { label: 'Fork → 직접 저장', text: proportionText(writers.saved, writers.forks) },
        { label: '저장 → 직접 발행', text: proportionText(writers.published, writers.saved) },
      ],
      note: writers.medianHoursToPublish == null
        ? '첫 발행까지 걸린 시간의 중앙값 — (직접 발행한 Fork가 아직 없어요)'
        : `첫 발행까지 걸린 시간의 중앙값 ${writers.medianHoursToPublish.toFixed(1)}시간`,
    },
    {
      key: 'ai', title: 'AI 제안 채택·수정 제안 승인', unit: '건',
      steps: [
        { label: 'AI 제안 생성', count: proposals.total }, { label: 'AI 제안 채택', count: proposals.adopted },
        { label: '수정 제안 결정(승인+거절)', count: feedback.decided }, { label: '수정 제안 승인', count: feedback.approved },
      ],
      rates: [
        { label: 'AI 제안 채택률', text: proportionText(proposals.adopted, proposals.total) },
        { label: '수정 제안 승인률', text: proportionText(feedback.approved, feedback.decided) },
      ],
    },
  ]
}

/** 차트 한 장을 말로 옮긴 요약(role="img"의 aria-label). 자세한 값은 차트 아래 비율 목록에 있습니다. */
export const groupSummary = ({ title, unit, steps }: FunnelGroup) => `${title}: ${steps.map((step) => `${step.label} ${count(step.count)}${unit}`).join(', ')}`

/** 회차당 반응은 평균이라 ±1/√n %p 오차(비율용)를 붙이지 않고 분모(발행 회차 수 n)만 적습니다. */
export type Reaction = { label: string; perEpisode: number | null; n: number }
export function reactionsPerEpisode({ publishedEpisodes, likes, interests, comments }: Funnel['reactions']): Reaction[] {
  const per = (total: number) => publishedEpisodes > 0 ? total / publishedEpisodes : null
  return [
    { label: '좋아요', perEpisode: per(likes), n: publishedEpisodes },
    { label: '관심', perEpisode: per(interests), n: publishedEpisodes },
    { label: '댓글', perEpisode: per(comments), n: publishedEpisodes },
  ]
}
const perEpisodeValue = (value: number | null) => value === null ? '—' : value.toFixed(2)
export const reactionText = ({ perEpisode, n }: Reaction) => `${perEpisodeValue(perEpisode)} · 발행 회차 n=${count(n)}`
export const reactionSummary = (rows: Reaction[]) =>
  `회차당 반응(발행 회차 ${count(rows[0]?.n ?? 0)}개): ${rows.map((row) => `${row.label} ${perEpisodeValue(row.perEpisode)}`).join(', ')}`

/** '1' → 1화, '4-5' → 4~5화, '11+' → 11화 이상. 모르는 이름은 그대로 보입니다. */
const bucketLabel = (bucket: string) => {
  if (/^\d+$/.test(bucket)) return `${bucket}화`
  if (/^\d+-\d+$/.test(bucket)) return `${bucket.replace('-', '~')}화`
  return /^\d+\+$/.test(bucket) ? `${bucket.slice(0, -1)}화 이상` : bucket
}
export const baseEpisodeBars = ({ baseEpisodes }: Funnel['forks']) => baseEpisodes.map(({ bucket, count: forks }) => ({ label: bucketLabel(bucket), count: forks }))
export const baseEpisodeSummary = (bars: { label: string; count: number }[]) => `Fork 기준 회차 분포: ${bars.map((bar) => `${bar.label} ${count(bar.count)}개`).join(', ')}`

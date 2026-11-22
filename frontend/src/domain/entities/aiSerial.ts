import { isMine, type Work } from './work'

/**
 * AI 자율 연재(UC-18, [계약](../../../../docs/design/ai-serial-contract.md)). 소유자가 운영 설정의 집필 방식에서 AI 자율 집필을 고르면(= 켜짐) 1화 발행 뒤 회차마다 "다음 회차" 게시판이 열린다:
 * AI가 만든 다음 전개 4지선다에 독자가 투표하고(회원당 1표), 제안 게시판에 글을 쓰고 추천한다. 마감 때 1위 선택지와 추천 많은 제안 글로 AI가 다음 회차를 써서 발행한다.
 * 설정 카드 제안은 범위 밖이라 제안 글은 일반·시뮬레이션뿐이다.
 */

/** 연재 요일(계약 days 값)과 화면 이름. 월~일 순이다. */
export const SERIAL_DAYS = [['MON', '월'], ['TUE', '화'], ['WED', '수'], ['THU', '목'], ['FRI', '금'], ['SAT', '토'], ['SUN', '일']] as const
export type SerialDay = (typeof SERIAL_DAYS)[number][0]

/** 소유자의 AI 집필 설정(GET /works/{id}/ai-serial). enabled는 읽기 전용이다: 운영 설정의 집필 방식(autonomous)을 저장하면 서버가 켜고 끈다. 시각은 한국시간 HH:mm이고 하루 한 번이다. */
export type SerialSettings = { enabled: boolean; days: SerialDay[]; time: string; direction: string }
export const SERIAL_DIRECTION_MAX = 2000

/** 설정 입력 안내 문구(통과하면 null). 서버와 같이 켜져 있을 때는 요일 1개 이상(꺼져 있으면 비어도 된다), 시각 HH:mm, 방향(앞뒤 공백 제외) 2,000자 이하다. */
export function serialSettingsError({ enabled, days, time, direction }: SerialSettings) {
  if (enabled && !days.length) return '연재 요일을 하나 이상 골라 주세요.'
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) return '연재 시각을 시:분(예: 21:00) 형식으로 입력해 주세요.'
  if (direction.trim().length > SERIAL_DIRECTION_MAX) return `연재 방향은 ${SERIAL_DIRECTION_MAX.toLocaleString('ko-KR')}자까지 쓸 수 있어요.`
  return null
}

/** 저장 요청 본문(PUT /works/{id}/ai-serial): 요일·시각·방향만 보낸다. 켜짐은 집필 방식이 정하므로 보내지 않는다(서버도 받지 않는다). */
export type SerialScheduleInput = Omit<SerialSettings, 'enabled'>

/** 저장 요청 본문을 만든다: 방향의 앞뒤 공백을 지운다(요일은 순서와 상관없이 서버가 월~일로 저장한다). */
export const serialSettingsInput = ({ days, time, direction }: SerialSettings): SerialScheduleInput => ({ days, time, direction: direction.trim() })

/** 게시판 상태(계약 status)와 화면 이름 */
export const BOARD_STATUS = { open: '투표·제안 받는 중', queued: '실행 대기', running: '집필 중', published: '발행됨', failed: '실패' } as const
export type BoardStatus = keyof typeof BOARD_STATUS

/** 소유자 기록 표의 한 줄(GET /works/{id}/ai-serial/boards). 시각은 UTC ISO-8601이다. */
export type SerialBoardRecord = {
  id: string
  /** 이 게시판이 정하는 회차 */
  episodeNumber: number
  status: BoardStatus
  publishedEpisodeNumber: number | null
  failureReason: string | null
  closedAt: string | null
}

/**
 * 크레딧 부족(409 INSUFFICIENT_CREDIT)은 서버 문구 대신 이 문구를 보인다. 그 밖의 409(SERIAL_*·VOTE_CONFLICT 등)는 서버가 한국어 detail을 주므로 그대로 보인다.
 * 게시판 기록의 실패 사유(failureReason: '크레딧이 부족합니다.'·'크레딧 상한을 넘었습니다.' 등)도 서버 문구를 그대로 보인다.
 */
export const INSUFFICIENT_CREDIT_MESSAGE = '크레딧이 부족해서 시뮬레이션 미리보기를 만들지 못했어요. 크레딧을 확인해 주세요.'

/** 대기·실행 중인 게시판이 있는가. 기록을 읽지 못했으면(undefined) 실행 중으로 보지 않는다. */
export const serialRunning = (boards: SerialBoardRecord[] | undefined) => !!boards?.some(({ status }) => status === 'queued' || status === 'running')

/**
 * AI 자율 집필 중 작가는 1화만 쓴다(계약 'AI 자율 집필 = 집필 방식'). 서버는 2화부터의 회차 쓰기와 작품 단위 쓰기(작품 단위 버전 저장·발행, 가져오기, 수정 제안 반영)를 409 SERIAL_LOCKED로 막고 이 문장을 준다.
 * 집필실·작품 관리는 이 문장으로 미리 알리며 입력·버튼을 잠근다. 화면 잠금은 보조이고 판정은 서버가 한다(켜짐 여부를 읽지 못하면 잠그지 않는다).
 */
export const SERIAL_LOCK_NOTICE = 'AI 자율 집필 중에는 1화만 직접 쓸 수 있어요. 운영 설정 > 집필 방식을 바꾸면 모든 회차를 쓸 수 있어요.'

/** 이 회차의 원고를 쓸 수 없는가: AI 자율 집필 중에는 1화만 쓸 수 있다. 회차를 아직 못 골랐으면(undefined) 잠그지 않는다. */
export const serialEpisodeLocked = (autonomous: boolean, number: number | undefined) => autonomous && number !== undefined && number !== 1

/** 새 회차를 만들 수 없는가: AI 자율 집필 중에는 활성 회차가 하나도 없을 때(1화 만들기)만 만든다. 회차 수를 아직 못 읽었으면(undefined) 잠그지 않는다. */
export const serialNewEpisodeLocked = (autonomous: boolean, count: number | undefined) => autonomous && (count ?? 0) > 0

/**
 * 지금 마감·실행을 못 하는 이유(할 수 있으면 null). 서버가 같은 조건을 409(SERIAL_DISABLED·SERIAL_RUNNING·SERIAL_NO_BOARD)로 다시 검사한다.
 * saved는 서버에 저장된 설정이다: 집필 방식을 저장하기 전에는 실행되지 않는다. failed는 설정·기록 읽기가 실패했다는 표시다
 * (읽지 못했는데 '불러오는 중'이라고 하면 기다려도 풀리지 않는 실패를 숨기게 된다).
 */
export function serialRunBlock(saved: SerialSettings | undefined, boards: SerialBoardRecord[] | undefined, failed = false) {
  if (!saved || !boards) return failed ? '설정이나 기록을 불러오지 못해 실행할 수 없어요. 새로 고친 뒤 다시 시도해 주세요.' : '설정과 기록을 불러오는 중이에요.'
  if (!saved.enabled) return '운영 설정 > 집필 방식에서 AI 자율 집필을 고르면 실행할 수 있어요.'
  if (serialRunning(boards)) return '이미 실행 중이에요. 끝나면 기록에서 결과를 확인해 주세요.'
  if (!boards.some(({ status }) => status === 'open')) return '열린 게시판이 없어요. 1화를 발행하면 게시판이 열려요.'
  return null
}

/** 저장·실행·투표 같은 요청의 결과 알림(성공은 role=status, 실패는 role=alert로 그린다) */
export type SerialNotice = { ok: boolean; text: string }

/** 제안 글 유형(계약 kind)과 화면 이름 */
export const PROPOSAL_KINDS = [['general', '일반'], ['simulation', '시뮬레이션']] as const
export type ProposalKind = (typeof PROPOSAL_KINDS)[number][0]

/** 4지선다 선택지 한 건(GET /works/{id}/serial-board의 choices). position은 1~4이고 득표는 서버가 센다. */
export type SerialChoice = { id: string; position: number; text: string; votes: number }

/** 제안 글 한 건(GET /works/{id}/serial-board의 proposals). simulation은 시뮬레이션 글에만 있고 scene(AI 장면 미리보기)은 아직 없으면 null이다. mine은 내가 쓴 글이다. */
export type SerialProposal = {
  id: string
  authorName: string
  kind: ProposalKind
  title: string
  body: string
  simulation: { premise: string; beats: string[]; scene: string | null } | null
  likes: number
  likedByMe: boolean
  mine: boolean
  createdAt: string
}

/**
 * 독자에게 보이는 '다음 회차' 게시판(공개 작품은 누구나 읽는다). enabled는 AI 자율 집필 여부라 소설 상세의 '다음 회차' 탭을 보일지 정한다.
 * board가 null이면 열린 게시판이 없다(다음 회차를 쓰는 중). 선택지가 아직 없으면 choices가 비어 있다. proposals는 서버가 준 최신순이고 숨긴 글은 빠져 있다.
 */
export type SerialBoardView = {
  enabled: boolean
  board: { id: string; episodeNumber: number } | null
  choices: SerialChoice[]
  /** 로그인한 회원이 투표한 선택지. 투표하지 않았거나 비로그인이면 null이다. */
  myChoiceId: string | null
  proposals: SerialProposal[]
  /** 마지막으로 닫힌 게시판의 AI 종합 문장 */
  summary: string | null
}

export const PROPOSAL_TITLE_MAX = 100
export const PROPOSAL_BODY_MAX = 2000
export const PREMISE_MAX = 500
export const BEATS_MAX = 5
export const BEAT_MAX = 200

/** 화면에서 받은 제안 글 입력. 시뮬레이션의 비트는 한 줄이 하나이고 빈 줄은 버린다. */
export type ProposalInput =
  | { kind: 'general'; title: string; body: string }
  | { kind: 'simulation'; title: string; body: string; premise: string; beats: string[] }
/** 제안 글 제출 요청 본문(계약 POST …/serial-board/proposals). 시뮬레이션은 전제·비트를 simulation에 싣는다. */
export type ProposalRequest =
  | { kind: 'general'; title: string; body: string }
  | { kind: 'simulation'; title: string; body: string; simulation: { premise: string; beats: string[] } }

const beatsOf = (beats: string[]) => beats.map((beat) => beat.trim()).filter(Boolean)

/** 제안 글 입력 안내 문구(통과하면 null). 제목 1~100자·내용 1~2,000자(공백 제외, 일반·시뮬레이션 모두), 시뮬레이션은 전제 1~500자와 비트 5개 이하·각 200자 이하(비트는 없어도 된다)다. */
export function proposalInputError(input: ProposalInput) {
  const title = input.title.trim()
  if (!title) return '제목을 입력해 주세요.'
  if (title.length > PROPOSAL_TITLE_MAX) return `제목은 ${PROPOSAL_TITLE_MAX}자까지 쓸 수 있어요.`
  const body = input.body.trim()
  if (!body) return '내용을 입력해 주세요.'
  if (body.length > PROPOSAL_BODY_MAX) return `내용은 ${PROPOSAL_BODY_MAX.toLocaleString('ko-KR')}자까지 쓸 수 있어요.`
  if (input.kind === 'general') return null
  const premise = input.premise.trim()
  if (!premise) return '시뮬레이션 전제를 입력해 주세요.'
  if (premise.length > PREMISE_MAX) return `전제는 ${PREMISE_MAX}자까지 쓸 수 있어요.`
  const beats = beatsOf(input.beats)
  if (beats.length > BEATS_MAX) return `장면 비트는 ${BEATS_MAX}개까지 넣을 수 있어요.`
  return beats.some((beat) => beat.length > BEAT_MAX) ? `비트 하나는 ${BEAT_MAX}자까지 쓸 수 있어요.` : null
}

/** 검증을 통과한 입력을 요청 본문으로 바꾼다(앞뒤 공백·빈 비트 제거). */
export function proposalRequest(input: ProposalInput): ProposalRequest {
  const title = input.title.trim()
  const body = input.body.trim()
  if (input.kind === 'general') return { kind: 'general', title, body }
  return { kind: 'simulation', title, body, simulation: { premise: input.premise.trim(), beats: beatsOf(input.beats) } }
}

/** 제안 글 목록 정렬: 최신순(작성 시각이 늦은 글부터)·추천순(추천이 많은 글부터, 같으면 먼저 쓴 글이 앞: 서버가 AI에 넘기는 추천 상위 글의 동률 규칙과 같다). 받은 목록은 바꾸지 않는다. */
export type ProposalSort = 'new' | 'likes'
export function sortProposals(proposals: SerialProposal[], sort: ProposalSort) {
  const time = (p: SerialProposal) => new Date(p.createdAt).getTime()
  return [...proposals].sort((a, b) => (sort === 'likes' ? b.likes - a.likes || time(a) - time(b) : time(b) - time(a)))
}

/**
 * 제안 글 숨김 버튼 노출: 작품 소유자(내 작품이거나 서버 소유자 ID가 내 ID)만이다. 버튼을 숨기는 것은 표시일 뿐이고 권한은 서버가 다시 확인한다.
 */
export const canHideProposals = (w: Work, memberId: string | null) => isMine(w) || (memberId !== null && w.owner === memberId)

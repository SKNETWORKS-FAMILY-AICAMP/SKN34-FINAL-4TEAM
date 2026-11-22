import { isMine, type Work } from './work'

/**
 * AI 자율 연재(UC-18, [계약](../../../../docs/design/ai-serial-contract.md)). 소유자가 AI 집필을 켜면 회차마다 독자 의견 게시판이 열리고,
 * 마감 때 득표 상위 의견을 AI가 종합해 다음 회차를 써서 발행한다. 설정 카드 제안은 범위 밖이라 의견은 일반·시뮬레이션뿐이다.
 */

/** 연재 요일(계약 days 값)과 화면 이름. 월~일 순이다. */
export const SERIAL_DAYS = [['MON', '월'], ['TUE', '화'], ['WED', '수'], ['THU', '목'], ['FRI', '금'], ['SAT', '토'], ['SUN', '일']] as const
export type SerialDay = (typeof SERIAL_DAYS)[number][0]

/** 소유자의 AI 집필 설정(GET·PUT /works/{id}/ai-serial). 시각은 한국시간 HH:mm이고 하루 한 번이다. */
export type SerialSettings = { enabled: boolean; days: SerialDay[]; time: string; direction: string }
export const SERIAL_DIRECTION_MAX = 2000

/** 설정 입력 안내 문구(통과하면 null). 서버와 같이 켤 때는 요일 1개 이상(끄는 저장은 비어도 된다), 시각 HH:mm, 방향(앞뒤 공백 제외) 2,000자 이하다. */
export function serialSettingsError({ enabled, days, time, direction }: SerialSettings) {
  if (enabled && !days.length) return '연재 요일을 하나 이상 골라 주세요.'
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) return '연재 시각을 시:분(예: 21:00) 형식으로 입력해 주세요.'
  if (direction.trim().length > SERIAL_DIRECTION_MAX) return `연재 방향은 ${SERIAL_DIRECTION_MAX.toLocaleString('ko-KR')}자까지 쓸 수 있어요.`
  return null
}

/** 저장 요청 본문: 방향의 앞뒤 공백을 지운다(요일은 순서와 상관없이 서버가 월~일로 저장한다). */
export const serialSettingsInput = (settings: SerialSettings): SerialSettings => ({ ...settings, direction: settings.direction.trim() })

/** 게시판 상태(계약 status)와 화면 이름 */
export const BOARD_STATUS = { open: '의견 받는 중', queued: '실행 대기', running: '집필 중', published: '발행됨', failed: '실패' } as const
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

/** 서버 오류 코드별 고정 문구. 서버 문구가 영문이거나 달라도 같은 안내를 보이려고 code를 우선한다(모르는 code는 서버 문구 그대로). */
export const SERIAL_ERROR_MESSAGES: Record<string, string> = {
  SERIAL_DISABLED: 'AI 집필이 꺼져 있어요. 켜고 저장한 뒤 실행해 주세요.',
  SERIAL_NO_BOARD: '지금 열린 의견 게시판이 없어요. AI 집필이 켜져 있고 1화가 발행된 작품에 게시판이 열려요.',
  SERIAL_RUNNING: '이미 실행 중이에요. 끝나면 기록에서 결과를 확인해 주세요.',
  OPINION_EXISTS: '이미 이 게시판에 의견을 냈어요. 의견은 게시판마다 하나만 낼 수 있어요.',
  INSUFFICIENT_CREDIT: '크레딧이 부족해서 시뮬레이션 미리보기를 만들지 못했어요. 크레딧을 확인해 주세요.',
}

/**
 * 지금 마감·실행을 못 하는 이유(할 수 있으면 null). 서버가 같은 조건을 409(SERIAL_DISABLED·SERIAL_RUNNING·SERIAL_NO_BOARD)로 다시 검사하므로 문구도 그 고정 문구와 같다.
 * saved는 서버에 저장된 설정이다: 켠 값을 저장하기 전의 화면 입력으로는 실행되지 않는다.
 */
export function serialRunBlock(saved: SerialSettings | undefined, boards: SerialBoardRecord[] | undefined) {
  if (!saved || !boards) return '설정과 기록을 불러오는 중이에요.'
  if (!saved.enabled) return SERIAL_ERROR_MESSAGES.SERIAL_DISABLED
  if (boards.some(({ status }) => status === 'queued' || status === 'running')) return SERIAL_ERROR_MESSAGES.SERIAL_RUNNING
  if (!boards.some(({ status }) => status === 'open')) return SERIAL_ERROR_MESSAGES.SERIAL_NO_BOARD
  return null
}

/** 저장·실행·투표 같은 요청의 결과 알림(성공은 role=status, 실패는 role=alert로 그린다) */
export type SerialNotice = { ok: boolean; text: string }

/** 의견 유형(계약 kind)과 화면 이름 */
export const OPINION_KINDS = [['general', '일반 의견'], ['simulation', '시뮬레이션']] as const
export type OpinionKind = (typeof OPINION_KINDS)[number][0]

/** 독자 의견 한 건(GET /works/{id}/serial-board의 opinions). simulation은 시뮬레이션 의견에만 있고 scene(AI 장면 미리보기)은 아직 없으면 null이다. */
export type SerialOpinion = {
  id: string
  authorName: string
  kind: OpinionKind
  body: string
  simulation: { premise: string; beats: string[]; scene: string | null } | null
  votes: number
  createdAt: string
}

/** 독자에게 열린 의견 게시판. board가 null이면 열린 게시판이 없다. opinions는 서버가 득표순으로 주고 숨긴 의견은 빠져 있다. */
export type SerialBoardView = {
  board: { id: string; episodeNumber: number } | null
  opinions: SerialOpinion[]
  /** 로그인한 회원의 이 게시판 의견(숨겨졌어도 알린다)과 투표. 비로그인은 null이다. */
  myOpinionId: string | null
  myVoteOpinionId: string | null
  /** 마지막으로 닫힌 게시판의 AI 종합 문장 */
  summary: string | null
}

export const OPINION_BODY_MAX = 1000
export const PREMISE_MAX = 500
export const BEATS_MAX = 5
export const BEAT_MAX = 200

/** 화면에서 받은 의견 입력. 시뮬레이션의 비트는 한 줄이 하나이고 빈 줄은 버린다. */
export type OpinionInput = { kind: 'general'; body: string } | { kind: 'simulation'; premise: string; beats: string[] }
/** 의견 제출 요청 본문(계약 POST …/serial-board/opinions). 시뮬레이션의 body는 선택 코멘트라 비워 보내고, 서버가 전제를 대신 보인다. */
export type OpinionRequest =
  | { kind: 'general'; body: string }
  | { kind: 'simulation'; body: string; simulation: { premise: string; beats: string[] } }

const beatsOf = (beats: string[]) => beats.map((beat) => beat.trim()).filter(Boolean)

/** 의견 입력 안내 문구(통과하면 null). 일반 1~1,000자, 시뮬레이션은 전제 1~500자와 비트 5개 이하·각 200자 이하(비트는 없어도 된다)다. */
export function opinionInputError(input: OpinionInput) {
  if (input.kind === 'general') {
    const body = input.body.trim()
    if (!body) return '의견을 입력해 주세요.'
    return body.length > OPINION_BODY_MAX ? `의견은 ${OPINION_BODY_MAX.toLocaleString('ko-KR')}자까지 쓸 수 있어요.` : null
  }
  const premise = input.premise.trim()
  if (!premise) return '시뮬레이션 전제를 입력해 주세요.'
  if (premise.length > PREMISE_MAX) return `전제는 ${PREMISE_MAX}자까지 쓸 수 있어요.`
  const beats = beatsOf(input.beats)
  if (beats.length > BEATS_MAX) return `장면 비트는 ${BEATS_MAX}개까지 넣을 수 있어요.`
  return beats.some((beat) => beat.length > BEAT_MAX) ? `비트 하나는 ${BEAT_MAX}자까지 쓸 수 있어요.` : null
}

/** 검증을 통과한 입력을 요청 본문으로 바꾼다(앞뒤 공백·빈 비트 제거). */
export function opinionRequest(input: OpinionInput): OpinionRequest {
  if (input.kind === 'general') return { kind: 'general', body: input.body.trim() }
  const premise = input.premise.trim()
  return { kind: 'simulation', body: '', simulation: { premise, beats: beatsOf(input.beats) } }
}

/**
 * 의견 숨김 버튼 노출: 작품 소유자(내 작품이거나 서버 소유자 ID가 내 ID)만이다. 버튼을 숨기는 것은 표시일 뿐이고 권한은 서버가 다시 확인한다.
 */
export const canHideOpinions = (w: Work, memberId: string | null) => isMine(w) || (memberId !== null && w.owner === memberId)

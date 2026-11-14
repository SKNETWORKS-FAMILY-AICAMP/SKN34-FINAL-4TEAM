import { cardTypeOf } from './studioCards'
import type { StoryPlan } from './storyPlan'
import type { StudioSetting } from './studioWorld'

/**
 * 인물 시뮬레이션(#58) 단계 결과. 모양은 [계약](../../../../docs/design/character-simulation-contract.md)의 'SSE·응답' JSON 그대로다.
 * 시뮬레이션 기록은 대화 체크포인트에만 있고, 작가가 승인해야 회차 초안에 이어 붙는다.
 * 무대(Stage) 확장: 장면은 턴(나레이션 또는 인물 한 명)마다 멈추고(`paused`), 작가가 줄을 고치거나 끼어들 수 있다.
 */
export type SimulationStatus = 'running' | 'paused' | 'completed' | 'stopped' | 'failed'
export type SimulationBeat = { index: number; text: string; status: 'done' | 'pending' | 'rejected' }
export type SimulationCheckKind = 'knowledge_leak' | 'voice_mix' | 'relation' | 'premise' | 'beat'
export type SimulationCheck = { kind: SimulationCheckKind; passed: boolean; detail: string }
export type SimulationEvidence = { ref: string; source: 'graph' | 'manuscript' | 'bm25' }
export type SimulationTurnKind = 'narration' | 'character' | 'monologue'
/** 그 줄이 쓰인 시점: 전지적, 한 인물의 3인칭 제한 시점(`limited:<인물id>`), 한 인물의 1인칭(`first:<인물id>`). */
export type SimulationPov = 'omniscient' | `limited:${string}` | `first:${string}`
export type SimulationTurn = {
  index: number
  /** 나레이션은 메인 에이전트(나레이터)의 지문, 독백은 시점 인물의 속마음(역시 나레이터가 쓴다). 인물 줄은 그 인물이 대사와 겉으로 보이는 행동만 쓴다. */
  kind: SimulationTurnKind
  pov: SimulationPov
  /** 나레이션은 null이다. 독백 줄이 시점 인물을 가리키면 그 인물 id가 온다. */
  characterId: string | null
  characterName: string
  /** 지문과 `"대사"`로 된 문단. 그릴 때는 원고 기본 서식 규칙(공용 ManuscriptBody)을 따른다. */
  prose: string
  checks: SimulationCheck[]
  regenerated: number
  evidence: SimulationEvidence[]
  /** 작가가 직접 고친 줄이다(고친 뒤 검사 결과는 비어 있다). */
  editedByAuthor: boolean
}
/** 작가의 끼어들기 기록. afterTurn은 그 메모를 남긴 직전의 턴 번호다(첫 턴 전이면 0 미만). */
export type SimulationNote = { afterTurn: number; text: string }
export type CharacterSimulation = {
  mode: 'if' | 'flow'
  /** IF 모드의 "만약 ~했다면?" 전제. 흐름 모드는 없다. */
  premise?: string | null
  beats: SimulationBeat[]
  turns: SimulationTurn[]
  notes: SimulationNote[]
  status: SimulationStatus
  /** 멈춘·실패한 이유(서버 문구 그대로). */
  stopReason?: string | null
}

export const statusLabel: Record<SimulationStatus, string> = { running: '진행 중', paused: '다음 턴 대기', completed: '완료', stopped: '멈춤', failed: '실패' }
export const checkKindLabel: Record<SimulationCheckKind, string> = {
  knowledge_leak: '알면 안 되는 정보', voice_mix: '말투 섞임', relation: '호칭·관계', premise: 'IF 전제', beat: '비트 진행',
}
export const evidenceLabel: Record<SimulationEvidence['source'], string> = { graph: '설정 그래프', manuscript: '원고 발췌', bm25: '설정 본문' }
export const beatLabel: Record<SimulationBeat['status'], string> = { done: '완료', pending: '대기', rejected: '거부됨' }

/** 장면 본문: 턴의 지문·대사를 빈 줄로 이은 글. 승인하면 이 글이 회차 초안 뒤에 이어 붙는다(계약). */
export const sceneProse = (sim: Pick<CharacterSimulation, 'turns'>) => sim.turns.map((turn) => turn.prose).join('\n\n')

export function checkSummary(checks: SimulationCheck[]) {
  const passed = checks.filter((check) => check.passed).length
  return { passed, violated: checks.length - passed }
}

/** 머리의 모드 문구. 흐름 모드는 끝낸 비트 수/전체 비트 수다. */
export const modeLabel = (sim: Pick<CharacterSimulation, 'mode' | 'beats'>) =>
  sim.mode === 'if' ? 'IF 전제' : `흐름 비트 진행 ${sim.beats.filter((beat) => beat.status === 'done').length}/${sim.beats.length}`

/** 말풍선 글용 한 줄 요약. 본문은 장면 카드가 그리고, 끝나지 않은 장면은 상태를 앞에 둬 완료처럼 보이지 않게 한다. */
export function sceneSummary(sim: CharacterSimulation) {
  const { passed, violated } = checkSummary(sim.turns.flatMap((turn) => turn.checks))
  return `${statusLabel[sim.status]} · 장면 ${sim.turns.length}턴 · 검사 통과 ${passed} · 위반 ${violated}`
}

/** 인물 id → 이름. 장면의 인물 줄·독백 줄이 알려 주는 이름이 먼저이고, 아직 말하지 않은 인물은 known(시작 양식에서 고른 이름)으로 채운다. */
export function characterNames(sim: Pick<CharacterSimulation, 'turns'>, known: Record<string, string> = {}) {
  const names = { ...known }
  for (const turn of sim.turns) if (turn.characterId) names[turn.characterId] = turn.characterName
  return names
}

// 시점 표지가 가리키는 인물 id(전지적이면 없다).
const povCharacter = (pov: SimulationPov) => (pov === 'omniscient' ? null : pov.slice(pov.indexOf(':') + 1))

/** 시점 이름: 전지적 / ○○ 시점(3인칭) / ○○ 1인칭. 이름을 모르는 인물은 '인물'로 부른다. */
export function povLabel(pov: SimulationPov, nameOf: (characterId: string) => string | undefined) {
  if (pov === 'omniscient') return '전지적'
  const name = nameOf(povCharacter(pov) ?? '') ?? '인물'
  return pov.startsWith('first:') ? `${name} 1인칭` : `${name} 시점(3인칭)`
}

/** 독백 줄의 주인: 그 줄이 가리키는 인물, 없으면 시점 인물의 이름이다. 끝내 모르면 '인물'이다. */
export function monologueOwner(turn: SimulationTurn, names: Record<string, string>) {
  const id = turn.characterId ?? povCharacter(turn.pov)
  return (id && names[id]) || (turn.characterId ? turn.characterName : '인물')
}

/** 무대 대본의 한 줄: 장면 턴, 작가의 끼어들기 기록, 시점이 바뀌는 곳의 구분선이다. */
export type SceneRow = { kind: 'turn'; turn: SimulationTurn } | { kind: 'note'; note: SimulationNote } | { kind: 'pov'; text: string }

/**
 * 턴과 끼어들기 기록을 일어난 순서로 잇는다. 메모는 그 직전 턴(afterTurn) 바로 뒤에 놓고, 맞는 턴이 없는 기록도 잃지 않는다.
 * 시점이 앞 줄과 달라지는 줄 앞에는 구분선을 둔다(전지적이 기본이라 처음이 전지적이면 구분선이 없다).
 */
export function sceneRows(sim: Pick<CharacterSimulation, 'turns' | 'notes'>, known: Record<string, string> = {}): SceneRow[] {
  const names = characterNames(sim, known)
  let pov: SimulationPov = 'omniscient'
  const rows: SceneRow[] = []
  let left = sim.notes
  const place = (match: (note: SimulationNote) => boolean) => {
    rows.push(...left.filter(match).map((note): SceneRow => ({ kind: 'note', note })))
    left = left.filter((note) => !match(note))
  }
  place((note) => note.afterTurn < (sim.turns[0]?.index ?? 0))
  for (const turn of sim.turns) {
    if (turn.pov !== pov) rows.push({ kind: 'pov', text: `시점: ${povLabel(turn.pov, (id) => names[id])}` })
    pov = turn.pov
    rows.push({ kind: 'turn', turn })
    place((note) => note.afterTurn === turn.index)
  }
  place(() => true)
  return rows
}

/** 채팅 쪽 한 줄: 대본은 무대가 보이므로 채팅에는 상태와 턴 수만 알린다. 턴 사이 대기는 진행 중으로 읽힌다. */
export const sceneLine = (sim: Pick<CharacterSimulation, 'status' | 'turns'>) =>
  `시뮬레이션 ${sim.status === 'running' || sim.status === 'paused' ? '진행 중' : statusLabel[sim.status]} · ${sim.turns.length}턴`

// ── 버튼 진입: 집필실 [시뮬레이션] 시작 양식이 서버에 보내는 값(Content `WritingAiRequest.simulation`) ──
export const SIM_PREMISE_MAX = 500
export const SIM_BEAT_MAX = 200
export const SIM_BEATS_MAX = 8
export const SIM_CHARACTERS_MAX = 6
/** IF는 "만약 ~했다면" 전제 한 줄, 흐름은 순서대로 따를 비트. 참여 인물은 연결 세계관의 인물 카드 id다. */
export type SimulationStart = { mode: 'if'; premise: string; characterIds: string[] } | { mode: 'flow'; beats: string[]; characterIds: string[] }

// 글자 한가운데(이모지 앞쪽 절반)를 가르지 않고 자른다.
const cut = (text: string, max: number) => {
  const head = text.slice(0, max)
  return /[\uD800-\uDBFF]$/.test(head) ? head.slice(0, -1) : head
}

/** 열린 회차의 장면 계획(kind=scene)을 목록 순서대로 비트로 쓴다: 비트 문장은 `제목: 내용`(내용이 비면 제목만)을 200자로 자르고 최대 8개. */
export function planBeats(plans: Pick<StoryPlan, 'kind' | 'episodeNumber' | 'title' | 'content'>[], episode: number | null) {
  const used = episode === null ? [] : plans.filter((plan) => plan.kind === 'scene' && plan.episodeNumber === episode).slice(0, SIM_BEATS_MAX)
  return used.map((plan) => cut([plan.title.trim(), plan.content.trim()].filter(Boolean).join(': '), SIM_BEAT_MAX))
}

/** 시작 양식의 인물 후보. id는 연결 WorldStudio의 인물 카드 id다. */
export type SimulationCharacter = { id: string; name: string; aliases: string[] }

/**
 * 연결 세계관의 인물 카드. 서버는 simulation.characterIds를 연결 WorldStudio의 활성 인물 카드 id로 검증하므로
 * 레거시 설정집이나 장면 계획의 인물 id가 아니라 이 카드 id를 쓴다. 이름 없는 카드는 고를 수 없어 뺀다.
 */
export const worldCharacters = (settings: StudioSetting[]): SimulationCharacter[] =>
  settings.filter((setting) => cardTypeOf(setting.item) === 'character' && setting.item.title.trim())
    .map((setting) => ({ id: setting.item.id, name: setting.item.title.trim(), aliases: setting.aliases ?? [] }))

/**
 * 흐름 모드가 미리 고르는 참여 인물: 비트 문장(제목·내용)에 이름이나 별칭이 나오는 인물 카드를 목록 순서대로 6명까지.
 * ponytail: 부분 문자열 일치라 조사가 붙은 이름도 잡지만 이름이 다른 낱말의 일부여도 잡힌다. 한 글자 이름은 오탐이 많아 건너뛴다. 작가가 양식에서 고친다.
 */
export function beatCharacterIds(beats: string[], characters: SimulationCharacter[]) {
  const text = beats.join('\n')
  return characters
    .filter((character) => [character.name, ...character.aliases].some((name) => name.trim().length >= 2 && text.includes(name.trim())))
    .map((character) => character.id)
    .slice(0, SIM_CHARACTERS_MAX)
}

// 공백을 정리하고 모드에 맞는 필드만 남기며 중복 인물은 한 번만 센다.
const tidy = (start: SimulationStart): SimulationStart => {
  const characterIds = [...new Set(start.characterIds)]
  return start.mode === 'if'
    ? { mode: 'if', premise: start.premise.trim(), characterIds }
    : { mode: 'flow', beats: start.beats.map((beat) => beat.trim()).filter(Boolean), characterIds }
}

/** 시작 값에서 보낼 수 없는 첫 사유. missing은 아직 덜 채운 것(입력하는 동안은 알리지 않는다), 아니면 한도를 넘기거나 잘못된 값이다. */
export function simulationIssue(raw: SimulationStart): { text: string; missing: boolean } | null {
  const start = tidy(raw)
  const missing = (text: string) => ({ text, missing: true })
  const over = (text: string) => ({ text, missing: false })
  if (start.mode === 'if') {
    if (!start.premise) return missing('전제를 한 줄 적어 주세요.')
    if (start.premise.length > SIM_PREMISE_MAX) return over(`전제는 ${SIM_PREMISE_MAX}자까지 적을 수 있어요.`)
  } else {
    if (!start.beats.length) return missing('비트를 하나 이상 정해 주세요.')
    if (start.beats.length > SIM_BEATS_MAX) return over(`비트는 ${SIM_BEATS_MAX}개까지 쓸 수 있어요.`)
    if (start.beats.some((beat) => beat.length > SIM_BEAT_MAX)) return over(`비트는 한 줄에 ${SIM_BEAT_MAX}자까지 적을 수 있어요.`)
  }
  if (!start.characterIds.length) return missing('참여 인물을 1명 이상 골라 주세요.')
  if (start.characterIds.length > SIM_CHARACTERS_MAX) return over(`참여 인물은 ${SIM_CHARACTERS_MAX}명까지 고를 수 있어요.`)
  if (start.characterIds.some((id) => !id || id.length > 100)) return over('참여 인물을 찾을 수 없어요.')
  return null
}

/** 시작 값을 서버 한도에 맞게 다듬는다. 보낼 수 없으면 이유를 던진다. */
export function cleanSimulation(start: SimulationStart): SimulationStart {
  const issue = simulationIssue(start)
  if (issue) throw new Error(issue.text)
  return tidy(start)
}

/** 채팅 대화에 남는 요청 문장(대화 기록의 내 메시지). 비트가 장면 계획에서 왔는지 직접 입력인지도 알린다. */
export const simulationSummary = (start: SimulationStart, source: 'plan' | 'manual' = 'manual') =>
  start.mode === 'if' ? `IF 모드 시뮬레이션: ${start.premise}` : `흐름 모드 시뮬레이션: ${source === 'plan' ? '장면 계획' : '비트'} ${start.beats.length}개`

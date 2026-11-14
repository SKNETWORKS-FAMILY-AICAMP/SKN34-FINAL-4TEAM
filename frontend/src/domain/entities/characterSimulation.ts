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
export type SimulationTurnKind = 'narration' | 'character'
export type SimulationTurn = {
  index: number
  /** 나레이션은 메인 에이전트(나레이터)의 지문이고 characterId가 없다. 인물 줄은 대사와 겉으로 보이는 행동만 담는다. */
  kind: SimulationTurnKind
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

/** 무대 대본의 한 줄: 장면 턴이거나 작가의 끼어들기 기록이다. */
export type SceneRow = { kind: 'turn'; turn: SimulationTurn } | { kind: 'note'; note: SimulationNote }

/** 턴과 끼어들기 기록을 일어난 순서로 잇는다. 메모는 그 직전 턴(afterTurn) 바로 뒤에 놓고, 맞는 턴이 없는 기록도 잃지 않는다. */
export function sceneRows(sim: Pick<CharacterSimulation, 'turns' | 'notes'>): SceneRow[] {
  const rows: SceneRow[] = []
  let left = sim.notes
  const place = (match: (note: SimulationNote) => boolean) => {
    rows.push(...left.filter(match).map((note): SceneRow => ({ kind: 'note', note })))
    left = left.filter((note) => !match(note))
  }
  place((note) => note.afterTurn < (sim.turns[0]?.index ?? 0))
  for (const turn of sim.turns) {
    rows.push({ kind: 'turn', turn })
    place((note) => note.afterTurn === turn.index)
  }
  place(() => true)
  return rows
}

/** 채팅 쪽 한 줄: 대본은 무대가 보이므로 채팅에는 상태와 턴 수만 알린다. 턴 사이 대기는 진행 중으로 읽힌다. */
export const sceneLine = (sim: Pick<CharacterSimulation, 'status' | 'turns'>) =>
  `시뮬레이션 ${sim.status === 'running' || sim.status === 'paused' ? '진행 중' : statusLabel[sim.status]} · ${sim.turns.length}턴`

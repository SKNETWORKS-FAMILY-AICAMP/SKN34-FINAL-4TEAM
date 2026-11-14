/**
 * 인물 시뮬레이션(#58) 단계 결과. 모양은 [계약](../../../../docs/design/character-simulation-contract.md)의 'SSE·응답' JSON 그대로다.
 * 시뮬레이션 기록은 대화 체크포인트에만 있고, 작가가 승인해야 회차 초안에 이어 붙는다.
 */
export type SimulationStatus = 'running' | 'completed' | 'stopped' | 'failed'
export type SimulationBeat = { index: number; text: string; status: 'done' | 'pending' | 'rejected' }
export type SimulationCheckKind = 'knowledge_leak' | 'voice_mix' | 'relation' | 'premise' | 'beat'
export type SimulationCheck = { kind: SimulationCheckKind; passed: boolean; detail: string }
export type SimulationEvidence = { ref: string; source: 'graph' | 'manuscript' | 'bm25' }
export type SimulationTurn = {
  index: number
  characterId: string
  characterName: string
  /** 지문과 `"대사"`로 된 문단. 그릴 때는 원고 기본 서식 규칙(공용 ManuscriptBody)을 따른다. */
  prose: string
  checks: SimulationCheck[]
  regenerated: number
  evidence: SimulationEvidence[]
}
export type CharacterSimulation = {
  mode: 'if' | 'flow'
  /** IF 모드의 "만약 ~했다면?" 전제. 흐름 모드는 없다. */
  premise?: string | null
  beats: SimulationBeat[]
  turns: SimulationTurn[]
  status: SimulationStatus
  /** 멈춘·실패한 이유(서버 문구 그대로). */
  stopReason?: string | null
}

export const statusLabel: Record<SimulationStatus, string> = { running: '진행 중', completed: '완료', stopped: '멈춤', failed: '실패' }
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

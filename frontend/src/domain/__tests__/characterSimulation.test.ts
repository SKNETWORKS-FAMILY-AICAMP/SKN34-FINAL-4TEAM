import { describe, expect, it } from 'vitest'

import { checkSummary, modeLabel, sceneLine, sceneProse, sceneRows, sceneSummary, statusLabel, type CharacterSimulation, type SimulationTurn } from '../entities/characterSimulation'

const turn = (index: number, prose: string, checks: SimulationTurn['checks'] = []): SimulationTurn =>
  ({ index, kind: 'character', characterId: `c${index}`, characterName: `인물${index}`, prose, checks, regenerated: 0, evidence: [], editedByAuthor: false })
const narration = (index: number, prose: string): SimulationTurn =>
  ({ index, kind: 'narration', characterId: null, characterName: '나레이션', prose, checks: [], regenerated: 0, evidence: [], editedByAuthor: false })
const scene = (extra: Partial<CharacterSimulation> = {}): CharacterSimulation =>
  ({ mode: 'flow', premise: null, beats: [], turns: [], notes: [], status: 'completed', stopReason: null, ...extra })

describe('장면 본문', () => {
  it('턴의 지문·대사를 빈 줄로 이어 승인 때 초안 뒤에 붙는 글과 같게 만든다', () => {
    const text = sceneProse(scene({ turns: [turn(0, '카엘이 문을 밀었다.\n"누구냐."'), turn(1, '"저예요."')] }))
    expect(text).toBe('카엘이 문을 밀었다.\n"누구냐."\n\n"저예요."')
  })

  it('턴이 없으면 빈 글이다', () => {
    expect(sceneProse(scene())).toBe('')
  })
})

describe('검사 요약', () => {
  it('통과와 위반 수를 센다', () => {
    const checks = [
      { kind: 'knowledge_leak', passed: true, detail: '' },
      { kind: 'voice_mix', passed: false, detail: '말투가 섞였어요.' },
      { kind: 'relation', passed: true, detail: '' },
    ] as const
    expect(checkSummary([...checks])).toEqual({ passed: 2, violated: 1 })
    expect(checkSummary([])).toEqual({ passed: 0, violated: 0 })
  })
})

describe('모드·상태 표시 문구', () => {
  it('IF 모드는 전제를, 흐름 모드는 끝낸 비트 수와 전체 비트 수를 보인다', () => {
    expect(modeLabel(scene({ mode: 'if', premise: '카엘이 성문을 열었다면?' }))).toBe('IF 전제')
    const beats = [
      { index: 0, text: '성문 대면', status: 'done' }, { index: 1, text: '협상', status: 'rejected' }, { index: 2, text: '퇴각', status: 'pending' },
    ] as const
    expect(modeLabel(scene({ beats: [...beats] }))).toBe('흐름 비트 진행 1/3')
    expect(modeLabel(scene({ beats: [] }))).toBe('흐름 비트 진행 0/0')
  })

  it('상태를 한국어로 부른다', () => {
    expect(statusLabel).toEqual({ running: '진행 중', paused: '다음 턴 대기', completed: '완료', stopped: '멈춤', failed: '실패' })
  })

  it('말풍선 요약은 상태와 턴·검사 수를 알리고 끝나지 않은 장면을 완료처럼 꾸미지 않는다', () => {
    const turns = [turn(0, 'a', [{ kind: 'voice_mix', passed: false, detail: 'x' }, { kind: 'relation', passed: true, detail: '' }]), turn(1, 'b', [{ kind: 'beat', passed: true, detail: '' }])]
    expect(sceneSummary(scene({ turns }))).toBe('완료 · 장면 2턴 · 검사 통과 2 · 위반 1')
    expect(sceneSummary(scene({ turns: turns.slice(0, 1), status: 'stopped' }))).toBe('멈춤 · 장면 1턴 · 검사 통과 1 · 위반 1')
  })
})

describe('무대 대본(#58 무대)', () => {
  it('나레이션과 인물 줄을 순서대로 빈 줄로 이어 승인 때 초안 뒤에 붙는 글과 같게 만든다', () => {
    expect(sceneProse(scene({ turns: [narration(0, '성문이 닫혀 있었다.'), turn(1, '"열어라."')] }))).toBe('성문이 닫혀 있었다.\n\n"열어라."')
  })

  it('끼어들기 기록을 그 직전 턴 바로 뒤에 두고, 첫 턴 전·마지막 턴 뒤의 기록도 잃지 않는다', () => {
    const rows = sceneRows(scene({
      turns: [narration(0, '밤이었다.'), turn(1, '"누구냐."'), turn(2, '"저예요."')],
      notes: [{ afterTurn: 2, text: '끝에' }, { afterTurn: -1, text: '시작 전에' }, { afterTurn: 0, text: '나레이션 뒤에' }, { afterTurn: 9, text: '없는 턴 뒤에' }],
    }))
    expect(rows.map((row) => (row.kind === 'turn' ? `턴${row.turn.index}` : `메모:${row.note.text}`)))
      .toEqual(['메모:시작 전에', '턴0', '메모:나레이션 뒤에', '턴1', '턴2', '메모:끝에', '메모:없는 턴 뒤에'])
  })

  it('턴도 메모도 없으면 빈 대본이다', () => {
    expect(sceneRows(scene())).toEqual([])
  })

  it('채팅 한 줄은 상태와 턴 수만 알리고, 턴 사이 대기도 진행 중으로 읽힌다', () => {
    const turns = [narration(0, 'a'), turn(1, 'b')]
    expect(sceneLine(scene({ turns, status: 'running' }))).toBe('시뮬레이션 진행 중 · 2턴')
    expect(sceneLine(scene({ turns, status: 'paused' }))).toBe('시뮬레이션 진행 중 · 2턴')
    expect(sceneLine(scene({ turns, status: 'completed' }))).toBe('시뮬레이션 완료 · 2턴')
    expect(sceneLine(scene({ turns: turns.slice(0, 1), status: 'stopped' }))).toBe('시뮬레이션 멈춤 · 1턴')
    expect(sceneLine(scene({ turns: [], status: 'failed' }))).toBe('시뮬레이션 실패 · 0턴')
  })

  it('말풍선 요약은 턴 사이 대기 장면도 완료로 꾸미지 않는다', () => {
    expect(sceneSummary(scene({ turns: [narration(0, 'a')], status: 'paused' }))).toBe('다음 턴 대기 · 장면 1턴 · 검사 통과 0 · 위반 0')
  })
})

import { describe, expect, it } from 'vitest'

import { checkSummary, modeLabel, sceneProse, sceneSummary, statusLabel, type CharacterSimulation, type SimulationTurn } from '../entities/characterSimulation'

const turn = (index: number, prose: string, checks: SimulationTurn['checks'] = []): SimulationTurn =>
  ({ index, characterId: `c${index}`, characterName: `인물${index}`, prose, checks, regenerated: 0, evidence: [] })
const scene = (extra: Partial<CharacterSimulation> = {}): CharacterSimulation =>
  ({ mode: 'flow', premise: null, beats: [], turns: [], status: 'completed', stopReason: null, ...extra })

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
    expect(statusLabel).toEqual({ running: '진행 중', completed: '완료', stopped: '멈춤', failed: '실패' })
  })

  it('말풍선 요약은 상태와 턴·검사 수를 알리고 끝나지 않은 장면을 완료처럼 꾸미지 않는다', () => {
    const turns = [turn(0, 'a', [{ kind: 'voice_mix', passed: false, detail: 'x' }, { kind: 'relation', passed: true, detail: '' }]), turn(1, 'b', [{ kind: 'beat', passed: true, detail: '' }])]
    expect(sceneSummary(scene({ turns }))).toBe('완료 · 장면 2턴 · 검사 통과 2 · 위반 1')
    expect(sceneSummary(scene({ turns: turns.slice(0, 1), status: 'stopped' }))).toBe('멈춤 · 장면 1턴 · 검사 통과 1 · 위반 1')
  })
})

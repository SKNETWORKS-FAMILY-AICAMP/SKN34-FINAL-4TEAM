import { describe, expect, it } from 'vitest'

import { characterNames, checkSummary, cleanSimulation, modeLabel, monologueOwner, planBeats, povLabel, sceneLine, sceneProse, sceneRows, sceneSummary, simulationIssue, simulationSummary, statusLabel, type CharacterSimulation, type SimulationStart, type SimulationTurn } from '../entities/characterSimulation'

const turn = (index: number, prose: string, checks: SimulationTurn['checks'] = []): SimulationTurn =>
  ({ index, kind: 'character', pov: 'omniscient', characterId: `c${index}`, characterName: `인물${index}`, prose, checks, regenerated: 0, evidence: [], editedByAuthor: false })
const narration = (index: number, prose = '성문은 닫혀 있었다.'): SimulationTurn =>
  ({ index, kind: 'narration', pov: 'omniscient', characterId: null, characterName: '나레이션', prose, checks: [], regenerated: 0, evidence: [], editedByAuthor: false })
const speak = (index: number, prose = '"열어라."'): SimulationTurn => turn(index, prose)
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
    expect(rows.map((row) => (row.kind === 'turn' ? `턴${row.turn.index}` : row.kind === 'note' ? `메모:${row.note.text}` : '구분선')))
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

describe('독백·시점(#58 무대)', () => {
  const mono = (index: number, prose: string, pov: SimulationTurn['pov'], extra: Partial<SimulationTurn> = {}): SimulationTurn =>
    ({ ...narration(index, prose), kind: 'monologue', characterId: 'c1', characterName: '카엘', pov, ...extra })
  const names: Record<string, string> = { c1: '카엘', c2: '리안' }

  it('시점을 전지적·3인칭 제한·1인칭으로 이름 붙이고, 이름을 모르는 인물은 인물로 부른다', () => {
    expect(povLabel('omniscient', (id) => names[id])).toBe('전지적')
    expect(povLabel('limited:c1', (id) => names[id])).toBe('카엘 시점(3인칭)')
    expect(povLabel('first:c2', (id) => names[id])).toBe('리안 1인칭')
    expect(povLabel('limited:x9', (id) => names[id])).toBe('인물 시점(3인칭)')
    expect(povLabel('first:x9', () => undefined)).toBe('인물 1인칭')
  })

  it('시점이 바뀌는 줄 앞에만 구분선을 넣고 처음 시점이 전지적이면 구분선이 없다(전지적이 기본이다)', () => {
    const rows = sceneRows(scene({ turns: [
      narration(0, '밤이었다.'), mono(1, '문이 열리면 끝이다.', 'limited:c1'), speak(2), mono(3, '또 속으로.', 'limited:c1'), narration(4, '해가 떴다.'),
    ] }))
    expect(rows.map((row) => (row.kind === 'turn' ? `턴${row.turn.index}` : row.kind === 'pov' ? row.text : '메모')))
      .toEqual(['턴0', '시점: 카엘 시점(3인칭)', '턴1', '시점: 전지적', '턴2', '시점: 카엘 시점(3인칭)', '턴3', '시점: 전지적', '턴4'])
  })

  it('처음부터 제한 시점이면 첫 줄 앞에 구분선을 보이고, 시점이 그대로면 줄마다 반복하지 않는다', () => {
    const rows = sceneRows(scene({ turns: [mono(0, '속으로.', 'first:c1'), mono(1, '또.', 'first:c1')] }))
    expect(rows.map((row) => (row.kind === 'pov' ? row.text : '줄'))).toEqual(['시점: 카엘 1인칭', '줄', '줄'])
  })

  it('구분선과 끼어들기 기록이 함께 있어도 일어난 순서를 지킨다', () => {
    const rows = sceneRows(scene({ turns: [narration(0), mono(1, '속으로.', 'limited:c1')], notes: [{ afterTurn: 0, text: '비가 쏟아진다' }] }))
    expect(rows.map((row) => (row.kind === 'turn' ? `턴${row.turn.index}` : row.kind === 'pov' ? '구분선' : '메모')))
      .toEqual(['턴0', '메모', '구분선', '턴1'])
  })

  it('인물 이름은 인물 줄·독백 줄이 알려 주고, 아직 말하지 않은 인물은 시작 양식에서 고른 이름으로 채운다', () => {
    const sim = scene({ turns: [narration(0), speak(1)] })
    expect(characterNames(sim)).toEqual({ c1: '인물1' })
    const first = scene({ turns: [{ ...narration(0), pov: 'limited:c2' }] })
    expect(sceneRows(first, { c2: '리안' })[0]).toEqual({ kind: 'pov', text: '시점: 리안 시점(3인칭)' })
    expect(sceneRows(first)[0]).toEqual({ kind: 'pov', text: '시점: 인물 시점(3인칭)' })
    // 서버가 알려 준 이름이 양식에서 고른 이름보다 먼저다.
    expect(characterNames(scene({ turns: [mono(0, '속으로.', 'limited:c1')] }), { c1: '옛 이름' })).toEqual({ c1: '카엘' })
  })

  it('독백 줄의 주인은 그 줄이 가리키는 인물이고, 없으면 시점 인물의 이름이며, 끝내 모르면 인물이다', () => {
    expect(monologueOwner(mono(1, '속으로.', 'limited:c1'), {})).toBe('카엘')
    expect(monologueOwner(mono(1, '속으로.', 'limited:c2', { characterId: null, characterName: '나레이션' }), names)).toBe('리안')
    expect(monologueOwner(mono(1, '속으로.', 'first:c9', { characterId: null, characterName: '나레이션' }), names)).toBe('인물')
    expect(monologueOwner(mono(1, '속으로.', 'omniscient', { characterId: null, characterName: '나레이션' }), names)).toBe('인물')
  })

  it('독백 줄도 승인 때 초안 뒤에 붙는 장면 본문에 순서대로 들어간다', () => {
    expect(sceneProse(scene({ turns: [narration(0, '밤이었다.'), mono(1, '문이 열리면 끝이다.', 'limited:c1'), speak(2, '"누구냐."')] })))
      .toBe('밤이었다.\n\n문이 열리면 끝이다.\n\n"누구냐."')
  })
})

describe('장면 계획 → 흐름 비트(버튼 진입)', () => {
  const plan = (title: string, content: string, extra: Partial<Parameters<typeof planBeats>[0][number]> = {}) =>
    ({ kind: 'scene' as const, episodeNumber: 3, title, content, characterIds: [], ...extra })

  it('열린 회차의 장면 계획만 목록 순서대로 `제목: 내용` 비트로 쓰고, 플롯·다른 회차·회차 없는 계획은 뺀다', () => {
    const { beats } = planBeats([
      plan('성문 대면', '카엘이 성문 앞에서 리안과 마주친다.'),
      plan('전체 줄거리', '플롯은 비트가 아니다.', { kind: 'plot', episodeNumber: null }),
      plan('다른 회차', '2화의 장면', { episodeNumber: 2 }),
      plan('회차 없음', '아직 배치 전', { episodeNumber: null }),
      plan('협상', '두 사람이 조건을 흥정한다.'),
    ], 3)
    expect(beats).toEqual(['성문 대면: 카엘이 성문 앞에서 리안과 마주친다.', '협상: 두 사람이 조건을 흥정한다.'])
  })

  it('내용이 비면 제목만 쓰고, 비트는 200자로 자르며(글자 한가운데를 가르지 않는다) 최대 8개만 쓴다', () => {
    const long = planBeats([plan('긴 장면', '가'.repeat(300)), plan('이모지', `${'나'.repeat(197)}😀😀`), plan('제목만', '  ')], 3).beats
    expect(long[0]).toHaveLength(200)
    expect(long[0].startsWith('긴 장면: 가')).toBe(true)
    expect(long[1].length).toBeLessThanOrEqual(200)
    expect(long[1].endsWith('\uD83D')).toBe(false)
    expect(long[2]).toBe('제목만')
    const many = planBeats(Array.from({ length: 10 }, (_, i) => plan(`장면${i}`, '내용')), 3).beats
    expect(many).toHaveLength(8)
    expect(many[7]).toBe('장면7: 내용')
  })

  it('참여 인물은 비트로 쓴 장면 계획들의 인물 합집합이고 처음 나온 순서·중복 없이 센다(8개를 넘어 잘린 계획의 인물은 뺀다)', () => {
    const { characterIds } = planBeats([
      plan('가', '1', { characterIds: ['c2', 'c1'] }), plan('나', '2', { characterIds: ['c1', 'c3'] }),
      plan('다른 회차', '3', { episodeNumber: 9, characterIds: ['c9'] }),
    ], 3)
    expect(characterIds).toEqual(['c2', 'c1', 'c3'])
    const cut = planBeats(Array.from({ length: 9 }, (_, i) => plan(`장면${i}`, '내용', { characterIds: [`c${i}`] })), 3)
    expect(cut.characterIds).toEqual(['c0', 'c1', 'c2', 'c3', 'c4', 'c5', 'c6', 'c7'])
  })

  it('회차를 모르거나 장면 계획이 없으면 빈 결과다', () => {
    expect(planBeats([plan('가', '1')], null)).toEqual({ beats: [], characterIds: [] })
    expect(planBeats([], 3)).toEqual({ beats: [], characterIds: [] })
  })
})

describe('시뮬레이션 시작 값(cleanSimulation)', () => {
  const ifStart = (extra: Partial<Extract<SimulationStart, { mode: 'if' }>> = {}): SimulationStart => ({ mode: 'if', premise: '만약 카엘이 성문을 열었다면?', characterIds: ['c1'], ...extra })
  const flowStart = (extra: Partial<Extract<SimulationStart, { mode: 'flow' }>> = {}): SimulationStart => ({ mode: 'flow', beats: ['성문 대면: 마주친다'], characterIds: ['c1', 'c2'], ...extra })

  it('앞뒤 공백을 지우고 모드에 맞는 필드만 남기며 중복 인물은 한 번만 보낸다', () => {
    expect(cleanSimulation(ifStart({ premise: '  만약 카엘이 성문을 열었다면?  ', characterIds: ['c1', 'c1', 'c2'] })))
      .toEqual({ mode: 'if', premise: '만약 카엘이 성문을 열었다면?', characterIds: ['c1', 'c2'] })
    expect(cleanSimulation(flowStart({ beats: [' 성문 대면 ', '   ', '협상'] }))).toEqual({ mode: 'flow', beats: ['성문 대면', '협상'], characterIds: ['c1', 'c2'] })
  })

  it('IF는 전제(1~500자), 흐름은 비트(1~8개·각 200자)가 있어야 한다', () => {
    expect(() => cleanSimulation(ifStart({ premise: '   ' }))).toThrow('전제를 한 줄 적어 주세요.')
    expect(() => cleanSimulation(ifStart({ premise: 'ㅁ'.repeat(501) }))).toThrow('전제는 500자까지')
    expect(cleanSimulation(ifStart({ premise: 'ㅁ'.repeat(500) }))).toMatchObject({ mode: 'if' })
    expect(() => cleanSimulation(flowStart({ beats: [' ', ''] }))).toThrow('비트를 하나 이상')
    expect(() => cleanSimulation(flowStart({ beats: Array.from({ length: 9 }, () => '장면') }))).toThrow('비트는 8개까지')
    expect(() => cleanSimulation(flowStart({ beats: ['ㅁ'.repeat(201)] }))).toThrow('비트는 한 줄에 200자까지')
    expect(cleanSimulation(flowStart({ beats: ['ㅁ'.repeat(200)] }))).toMatchObject({ mode: 'flow' })
  })

  it('참여 인물은 1~6명이고 인물 번호가 비었거나 100자를 넘으면 보내지 않는다', () => {
    expect(() => cleanSimulation(ifStart({ characterIds: [] }))).toThrow('참여 인물을 1명 이상')
    expect(() => cleanSimulation(ifStart({ characterIds: ['c1', 'c2', 'c3', 'c4', 'c5', 'c6', 'c7'] }))).toThrow('참여 인물은 6명까지')
    expect(cleanSimulation(ifStart({ characterIds: ['c1', 'c2', 'c3', 'c4', 'c5', 'c6'] }))).toMatchObject({ mode: 'if' })
    expect(() => cleanSimulation(ifStart({ characterIds: [''] }))).toThrow('참여 인물을 찾을 수 없어요.')
    expect(() => cleanSimulation(ifStart({ characterIds: ['x'.repeat(101)] }))).toThrow('참여 인물을 찾을 수 없어요.')
  })

  it('아직 덜 채운 값(전제·비트·인물 없음)과 한도를 넘긴 값을 구분해 알려, 입력하는 동안은 덜 채운 것을 꾸짖지 않을 수 있다', () => {
    expect(simulationIssue(ifStart())).toBeNull()
    expect(simulationIssue(ifStart({ premise: '' }))).toEqual({ text: '전제를 한 줄 적어 주세요.', missing: true })
    expect(simulationIssue(flowStart({ beats: [] }))).toMatchObject({ missing: true })
    expect(simulationIssue(ifStart({ characterIds: [] }))).toMatchObject({ missing: true })
    expect(simulationIssue(ifStart({ premise: 'ㅁ'.repeat(501) }))).toMatchObject({ missing: false })
    expect(simulationIssue(flowStart({ beats: ['ㅁ'.repeat(201)] }))).toMatchObject({ missing: false })
    expect(simulationIssue(ifStart({ characterIds: ['1', '2', '3', '4', '5', '6', '7'] }))).toMatchObject({ missing: false })
  })

  it('요청 문장은 모드와 비트 출처(장면 계획·직접 입력)를 한 줄로 알린다', () => {
    expect(simulationSummary(ifStart())).toBe('IF 모드 시뮬레이션: 만약 카엘이 성문을 열었다면?')
    expect(simulationSummary(flowStart({ beats: ['a', 'b', 'c'] }), 'plan')).toBe('흐름 모드 시뮬레이션: 장면 계획 3개')
    expect(simulationSummary(flowStart({ beats: ['a', 'b'] }), 'manual')).toBe('흐름 모드 시뮬레이션: 비트 2개')
  })
})

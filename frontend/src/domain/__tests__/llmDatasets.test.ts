import { describe, expect, it } from 'vitest'

import { DATASET_KINDS, DATASET_MAX_BYTES, DATASET_MAX_LINES, DatasetInvalid, POOL_PREFIX, datasetKindLabel, datasetKindOf, datasetLimitError, decodeUtf8, isJsonlFile, itemSummary, parseDatasetJsonl, poolOf } from '../entities/llmDatasets'
import { OperationsRejected } from '../entities/operations'

const line = (value: unknown) => JSON.stringify(value)
const row = (extra: Record<string, unknown> = {}) => ({ input: { question: '질문' }, expectedOutput: '정답', metadata: { source: '출처' }, ...extra })

describe('평가 데이터셋 JSONL 검사(#868 정확 구현 계약): 줄마다 {input, expectedOutput, metadata?}', () => {
  it('input(객체)·expectedOutput(null·빈 값 불가)이 있으면 통과하고 metadata는 선택이며 null은 없는 것과 같아 보내지 않는다(0·false는 값이다)', () => {
    const parsed = parseDatasetJsonl([
      line(row()), line({ input: { q: 1 }, expectedOutput: '정답' }), line({ input: { q: 2 }, expectedOutput: 0, metadata: null }), line({ input: { q: 3 }, expectedOutput: false }),
    ].join('\n'))
    expect([parsed.total, parsed.errors]).toEqual([4, []])
    expect(parsed.lines).toEqual([row(), { input: { q: 1 }, expectedOutput: '정답' }, { input: { q: 2 }, expectedOutput: 0 }, { input: { q: 3 }, expectedOutput: false }])
  })

  it('빈 줄은 건수에 넣지 않고 건너뛰며, 줄 번호는 파일의 줄 그대로이고, CRLF·CR만 있는 줄바꿈과 맨 앞 BOM도 받아들인다(서버의 lines()와 같다)', () => {
    const parsed = parseDatasetJsonl('\uFEFF' + [line(row()), '', '   ', line(row({ input: { q: 2 } })), ''].join('\r\n'))
    expect([parsed.total, parsed.lines.length, parsed.errors]).toEqual([2, 2, []])
    expect(parseDatasetJsonl([line(row()), '', 'x'].join('\n')).errors).toEqual([{ line: 3, message: 'JSON으로 읽을 수 없어요.' }])
    expect(parseDatasetJsonl([line(row()), line(row({ input: { q: 2 } })), 'x'].join('\r')).errors).toEqual([{ line: 3, message: 'JSON으로 읽을 수 없어요.' }])
  })

  it('JSON이 아니거나(JSON 뒤에 글이 붙은 줄 포함) 객체가 아닌 줄, input이 없거나 null·객체가 아닌 줄, expectedOutput이 없거나 비어 있는 줄, metadata 모양이 틀린 줄은 줄 번호와 이유로 알리고 나머지 줄은 계속 검사한다', () => {
    const ok = { input: { q: 9 }, expectedOutput: '정답' }
    const parsed = parseDatasetJsonl([
      line(row()),
      '{not json',
      '{"input":{"q":1}} 뒤에 붙은 글',
      line([1, 2]),
      line('글자'),
      line(null),
      line({ expectedOutput: 1 }),
      line({ input: null, expectedOutput: 1 }),
      line({ input: '글', expectedOutput: 1 }),
      line({ input: [1], expectedOutput: 1 }),
      line({ input: { q: 2 } }),
      line({ input: { q: 3 }, expectedOutput: null }),
      line({ input: { q: 4 }, expectedOutput: '  ' }),
      line({ input: { q: 5 }, expectedOutput: [] }),
      line({ input: { q: 6 }, expectedOutput: {} }),
      line({ ...ok, metadata: [] }),
      line({ ...ok, input: { q: 7 }, metadata: 'm' }),
      line({ ...ok, input: { q: 8 }, metadata: null }),
    ].join('\n'))
    expect(parsed.total).toBe(18)
    expect(parsed.lines).toHaveLength(2)   // 첫 줄과 metadata가 null인 줄(비어 있는 것과 같다)
    expect(parsed.errors).toEqual([
      { line: 2, message: 'JSON으로 읽을 수 없어요.' },
      { line: 3, message: 'JSON으로 읽을 수 없어요.' },
      { line: 4, message: '줄 하나가 JSON 객체여야 해요.' },
      { line: 5, message: '줄 하나가 JSON 객체여야 해요.' },
      { line: 6, message: '줄 하나가 JSON 객체여야 해요.' },
      { line: 7, message: 'input이 필요해요.' },
      { line: 8, message: 'input이 필요해요.' },
      { line: 9, message: 'input은 JSON 객체여야 해요.' },
      { line: 10, message: 'input은 JSON 객체여야 해요.' },
      { line: 11, message: 'expectedOutput이 필요해요.' },
      { line: 12, message: 'expectedOutput이 필요해요.' },
      { line: 13, message: 'expectedOutput이 필요해요.' },
      { line: 14, message: 'expectedOutput이 필요해요.' },
      { line: 15, message: 'expectedOutput이 필요해요.' },
      { line: 16, message: 'metadata는 JSON 객체여야 해요.' },
      { line: 17, message: 'metadata는 JSON 객체여야 해요.' },
    ])
  })

  it('input·expectedOutput·metadata 밖의 칸은 모두 오류다: 문항 id도(서버가 붙인다) 오타(expected_output)도 값을 버리지 않고 거절하며 이름을 알린다', () => {
    const parsed = parseDatasetJsonl([line({ id: 'x', input: { q: 1 }, expectedOutput: 1 }), line({ input: { q: 2 }, expectedOutput: 1, expected_output: 2 }), line({ input: { q: 3 }, expectedOutput: 1, a: 1, b: 2 })].join('\n'))
    expect(parsed.errors).toEqual([
      { line: 1, message: '알 수 없는 칸이 있어요: id' },
      { line: 2, message: '알 수 없는 칸이 있어요: expected_output' },
      { line: 3, message: '알 수 없는 칸이 있어요: a, b' },
    ])
    expect(parsed.lines).toEqual([])
  })

  it('한 줄에 문제가 여럿이어도 첫 문제 하나만 알린다: 순서는 JSON → 객체 → 알 수 없는 칸 → input → expectedOutput → metadata(고치면 다음 문제가 보인다)', () => {
    expect(parseDatasetJsonl(line({ metadata: 1 })).errors).toEqual([{ line: 1, message: 'input이 필요해요.' }])
    expect(parseDatasetJsonl(line({ id: 'x' })).errors).toEqual([{ line: 1, message: '알 수 없는 칸이 있어요: id' }])
    expect(parseDatasetJsonl(line({ typo: 1, metadata: 1 })).errors).toEqual([{ line: 1, message: '알 수 없는 칸이 있어요: typo' }])
    expect(parseDatasetJsonl(line({ input: { q: 1 }, metadata: 1 })).errors).toEqual([{ line: 1, message: 'expectedOutput이 필요해요.' }])
  })

  it('파일 안에서 같은 input(키 순서와 공백이 달라도 같은 JSON)이 다시 나오면 뒤의 줄을 오류로 알린다(시험 문제를 겹쳐 올리지 않는다): 틀린 줄은 중복으로 치지 않는다', () => {
    const parsed = parseDatasetJsonl([
      line({ input: { a: 1, b: [1, { c: 2, d: 3 }] }, expectedOutput: '정답' }),
      '{"expectedOutput":"다른 정답","input":{"b":[1,{"d":3,"c":2}], "a":1}}',
      line({ input: { a: 1, b: [1, { c: 2 }] }, expectedOutput: '정답' }),
      line({ input: { a: 1 } }),
      line({ input: { a: 1, b: [1, { c: 2, d: 3 }] }, expectedOutput: '또 다른 정답' }),
    ].join('\n'))
    expect(parsed.lines).toHaveLength(2)
    expect(parsed.errors).toEqual([
      { line: 2, message: '같은 input이 1번째 줄에 이미 있어요.' },
      { line: 4, message: 'expectedOutput이 필요해요.' },
      { line: 5, message: '같은 input이 1번째 줄에 이미 있어요.' },
    ])
  })

  it('빈 파일·빈 줄뿐인 파일은 항목 0건에 오류도 없다(올리기는 UseCase가 막는다)', () => {
    expect(parseDatasetJsonl('')).toEqual({ total: 0, lines: [], errors: [] })
    expect(parseDatasetJsonl('\n  \n')).toEqual({ total: 0, lines: [], errors: [] })
  })
})

// 세트 종류별 필수 칸(#868 정확 구현 계약 3): 채점 코드(app/evaluation/service·simulation·extraction.py)와 최적화 풀 읽기가 실제로 읽는 칸이다.
const ACT = { input: { set: 'dialogue', data: { scene: '장면' } }, expectedOutput: '대사', metadata: { judge: { character: '연새', scene: [{ by: '연새', text: '말' }], facts: [{ id: 'E1.1', text: '사실' }] } } }
const NARRATE = { input: { set: 'narration', data: {} }, expectedOutput: '지문', metadata: { judge: { character: '', scene: [{ by: '나레이션', text: '지문' }], facts: [] } } }
const EXTRACT = {
  input: { number: 2, title: '2화', body: '본문' },
  expectedOutput: { mentions: [{ name: '김 첨지', kind: 'character', aliases: [], core: true }], statements: [{ kind: 'goal', document: 'goal', quote: '인용', core: true }], relationships: [{ source: '김 첨지', target: '치삼', label: '친구', core: true }] },
}
const QA = { input: { question: '질문', contexts: ['근거'] }, expectedOutput: '답' }
const GENERAL = { input: { question: '질문' }, expectedOutput: '답', metadata: { criteria: '기준' } }
const problem = (set: string, item: unknown) => parseDatasetJsonl(line(item), set).errors.map((error) => error.message)

describe('세트 종류별 필수 칸(세트 이름으로 정하고 최적화 풀 optimize.<게이트>는 그 게이트와 같다)', () => {
  it('종류는 서버가 주는 값이 정본이고, 없으면 짝 프롬프트가 있으면 평가 게이트·optimize.로 시작하면 최적화 풀·그 밖은 범용이다(계약 1의 정의 그대로)', () => {
    expect(DATASET_KINDS.map(([kind, label]) => [kind, label])).toEqual([['gate', '평가 게이트'], ['pool', '최적화 풀'], ['general', '범용']])
    expect([datasetKindLabel('gate'), datasetKindLabel('pool'), datasetKindLabel('general')]).toEqual(['평가 게이트', '최적화 풀', '범용'])
    expect(datasetKindOf({ name: 'simulation.act', prompt: 'character_simulation.act' })).toBe('gate')
    expect(datasetKindOf({ name: 'optimize.simulation.act', prompt: null })).toBe('pool')
    expect(datasetKindOf({ name: 'leak.spoiler', prompt: null })).toBe('general')
    expect([POOL_PREFIX, poolOf('simulation.act')]).toEqual(['optimize.', 'optimize.simulation.act'])
  })

  it('모든 세트가 같은 서버 기준 모양(input 객체·expectedOutput 필수)이고, 세트를 모르면(이름 없음) 그 공통 규칙만 본다', () => {
    expect(problem('simulation.act', ACT)).toEqual([])
    expect(problem('simulation.narrate', NARRATE)).toEqual([])
    expect(problem('extraction.extract', EXTRACT)).toEqual([])
    expect(problem('qa.grounding', QA)).toEqual([])
    expect(problem('leak.spoiler', GENERAL)).toEqual([])
    expect(parseDatasetJsonl(line(QA)).errors).toEqual([])   // 세트 이름 없이도 공통 규칙은 통과
    expect(parseDatasetJsonl(line({ input: { q: 1 } })).errors).toEqual([{ line: 1, message: 'expectedOutput이 필요해요.' }])
  })

  it('시뮬레이션 세트(simulation.act·narrate, optimize. 풀 포함)는 input.data(객체)·비어 있지 않은 글 expectedOutput·metadata.judge(character 글·scene {by,text} 목록·facts {id,text} 목록)가 필요하다', () => {
    const without = (path: string[]) => { const copy = structuredClone(ACT) as Record<string, any>; let at = copy; for (const key of path.slice(0, -1)) at = at[key]; delete at[path.at(-1)!]; return copy }
    expect(problem('simulation.act', without(['input', 'data']))).toEqual(['input.data(객체)가 필요해요.'])
    expect(problem('simulation.act', { ...ACT, input: { ...ACT.input, data: '글' } })).toEqual(['input.data(객체)가 필요해요.'])
    expect(problem('simulation.act', { ...ACT, expectedOutput: { a: 1 } })).toEqual(['expectedOutput은 비어 있지 않은 글이어야 해요.'])
    expect(problem('simulation.act', { ...ACT, expectedOutput: 7 })).toEqual(['expectedOutput은 비어 있지 않은 글이어야 해요.'])
    expect(problem('simulation.act', { ...ACT, metadata: { source: 'x' } })).toEqual(['metadata.judge(character·scene·facts)가 필요해요.'])
    expect(problem('simulation.act', { ...ACT, metadata: { judge: [] } })).toEqual(['metadata.judge(character·scene·facts)가 필요해요.'])
    const judge = (patch: Record<string, unknown>) => ({ ...ACT, metadata: { judge: { ...ACT.metadata.judge, ...patch } } })
    expect(problem('simulation.act', judge({ character: 1 }))).toEqual(['metadata.judge.character는 글이어야 해요.'])
    expect(problem('simulation.act', judge({ scene: [{ by: '연새' }] }))).toEqual(['metadata.judge.scene은 {by, text}(글) 목록이어야 해요.'])
    expect(problem('simulation.act', judge({ scene: '글' }))).toEqual(['metadata.judge.scene은 {by, text}(글) 목록이어야 해요.'])
    expect(problem('simulation.act', judge({ facts: [{ id: 1, text: '사실' }] }))).toEqual(['metadata.judge.facts는 {id, text}(글) 목록이어야 해요.'])
    expect(problem('simulation.act', judge({ scene: [], facts: [] }))).toEqual([])   // 채점 코드는 빈 목록을 받는다
    expect(problem('optimize.simulation.act', { ...ACT, metadata: { source: 'x' } })).toEqual(['metadata.judge(character·scene·facts)가 필요해요.'])
    // narrate는 input.set이 narration 또는 monologue여야 채점된다(act는 set을 보지 않는다). 나레이션은 인물이 없어 character가 빈 글이다.
    expect(problem('simulation.narrate', { ...NARRATE, input: { set: 'dialogue', data: {} } })).toEqual(['input.set은 narration 또는 monologue여야 해요.'])
    expect(problem('simulation.narrate', { ...NARRATE, input: { data: {} } })).toEqual(['input.set은 narration 또는 monologue여야 해요.'])
    expect(problem('simulation.narrate', { ...NARRATE, input: { set: 'monologue', data: {} } })).toEqual([])
    expect(problem('optimize.simulation.narrate', { ...NARRATE, input: { set: 'x', data: {} } })).toEqual(['input.set은 narration 또는 monologue여야 해요.'])
    expect(problem('simulation.act', { ...ACT, input: { data: {} } })).toEqual([])
  })

  it('추출 세트(extraction.extract, 풀 포함)는 input(number 1 이상 정수·title·body 글)과 정답표 expectedOutput({mentions, statements, relationships} 목록의 정해진 칸)이 필요하다', () => {
    const input = (patch: Record<string, unknown>) => ({ ...EXTRACT, input: { ...EXTRACT.input, ...patch } })
    for (const patch of [{ number: 0 }, { number: 1.5 }, { number: '2' }, { title: 1 }, { body: null }]) expect(problem('extraction.extract', input(patch))).toEqual(['input에는 number(1 이상 정수)·title·body(글)가 필요해요.'])
    expect(problem('extraction.extract', { ...EXTRACT, input: { number: 1, title: '제목' } })).toEqual(['input에는 number(1 이상 정수)·title·body(글)가 필요해요.'])
    const gold = (patch: Record<string, unknown>) => ({ ...EXTRACT, expectedOutput: { ...EXTRACT.expectedOutput, ...patch } })
    const BAD = 'expectedOutput은 정답표({mentions, statements, relationships} 목록의 정해진 칸, core 정답 하나 이상)여야 해요.'
    expect(problem('extraction.extract', { ...EXTRACT, expectedOutput: '글' })).toEqual([BAD])
    expect(problem('extraction.extract', gold({ mentions: undefined }))).toEqual([BAD])
    expect(problem('extraction.extract', gold({ mentions: [{ name: '김', kind: 'character', aliases: [], core: 'yes' }] }))).toEqual([BAD])   // core는 true·false만
    expect(problem('extraction.extract', gold({ mentions: [{ name: '김', kind: 'character', core: true }] }))).toEqual([BAD])   // aliases 목록이 있어야
    expect(problem('extraction.extract', gold({ statements: [{ kind: 'goal', quote: '인용', core: true }] }))).toEqual([BAD])
    expect(problem('extraction.extract', gold({ relationships: [{ source: 'a', target: 'b', core: false }] }))).toEqual([BAD])
    expect(problem('extraction.extract', gold({ mentions: [], statements: [], relationships: [] }))).toEqual([BAD])   // 빈 정답표(expectedOutput의 빈 값)는 정답이 아니다
    expect(problem('optimize.extraction.extract', { ...EXTRACT, expectedOutput: '글' })).toEqual([BAD])
  })

  it('Q&A 세트(qa.로 시작)는 input.question(비지 않은 글)과 input.contexts(비지 않은 글 목록)가 필요하다', () => {
    const BAD = 'input에는 question(글)과 contexts(글 목록)가 필요해요.'
    expect(problem('qa.grounding', { ...QA, input: { contexts: ['근거'] } })).toEqual([BAD])
    expect(problem('qa.grounding', { ...QA, input: { question: ' ', contexts: ['근거'] } })).toEqual([BAD])
    expect(problem('qa.grounding', { ...QA, input: { question: '질문', contexts: [] } })).toEqual([BAD])
    expect(problem('qa.grounding', { ...QA, input: { question: '질문', contexts: ['근거', ''] } })).toEqual([BAD])
    expect(problem('qa.grounding', { ...QA, input: { question: '질문', contexts: '근거' } })).toEqual([BAD])
    expect(problem('qa.other', QA)).toEqual([])
  })

  it('그 밖의 세트(범용: 누설·세계관 충돌·집필 수정과 이름을 모르는 세트)는 GEval이 읽는 metadata.criteria(비지 않은 글)가 필요하다', () => {
    const BAD = 'metadata.criteria(글)가 필요해요.'
    expect(problem('leak.spoiler', { ...GENERAL, metadata: { source: 'x' } })).toEqual([BAD])
    expect(problem('world.conflict', { ...GENERAL, metadata: { criteria: ' ' } })).toEqual([BAD])
    expect(problem('writing.fix', { input: { task: 'a' }, expectedOutput: '답' })).toEqual([BAD])
    expect(problem('whatever.set', { ...GENERAL, metadata: { criteria: 1 } })).toEqual([BAD])
    expect(problem('whatever.set', GENERAL)).toEqual([])
  })

  it('최적화 풀(optimize.<게이트>)은 metadata.split이 없으면 서버가 정해 주고, 있으면 train 또는 val이어야 한다(풀을 읽는 코드가 그 둘만 읽는다). 게이트 세트는 split을 따지지 않는다', () => {
    const BAD = 'metadata.split은 train 또는 val이어야 해요.'
    expect(problem('optimize.simulation.act', ACT)).toEqual([])
    expect(problem('optimize.simulation.act', { ...ACT, metadata: { ...ACT.metadata, split: 'train' } })).toEqual([])
    expect(problem('optimize.simulation.act', { ...ACT, metadata: { ...ACT.metadata, split: 'val' } })).toEqual([])
    expect(problem('optimize.simulation.act', { ...ACT, metadata: { ...ACT.metadata, split: 'test' } })).toEqual([BAD])
    expect(problem('optimize.simulation.act', { ...ACT, metadata: { ...ACT.metadata, split: 1 } })).toEqual([BAD])
    expect(problem('simulation.act', { ...ACT, metadata: { ...ACT.metadata, split: 'test' } })).toEqual([])
  })
})

it('올릴 수 있는 크기는 500줄·2MB까지(경계 포함)이고 넘으면 어느 쪽이 넘었는지 말한다', () => {
  expect([DATASET_MAX_LINES, DATASET_MAX_BYTES]).toEqual([500, 2 * 1024 * 1024])
  expect([datasetLimitError(500, 1000), datasetLimitError(1, DATASET_MAX_BYTES)]).toEqual([null, null])
  expect(datasetLimitError(501, 1000)).toBe('줄이 501개라 너무 많아요. 500줄·2MB까지 올릴 수 있으니 나눠서 올려 주세요.')
  expect(datasetLimitError(10, DATASET_MAX_BYTES + 1)).toBe('파일이 2MB를 넘어요. 500줄·2MB까지 올릴 수 있으니 나눠서 올려 주세요.')
})

it('decodeUtf8은 UTF-8 바이트만 글자로 읽는다(맨 앞 BOM은 버리고, 다른 인코딩이면 null): 서버도 UTF-8만 받고, 느슨하게 읽어 보내면 깨진 글자(�)가 평가 데이터에 저장된다', () => {
  const bytes = (...values: number[]) => new Uint8Array(values)
  expect(decodeUtf8(new TextEncoder().encode('{"input":"한글"}'))).toBe('{"input":"한글"}')
  expect(decodeUtf8(bytes(0xef, 0xbb, 0xbf, 0x7b, 0x7d))).toBe('{}')
  expect(decodeUtf8(bytes(0x7b, 0xb1, 0xc2, 0x7d))).toBeNull()   // EUC-KR 같은 다른 인코딩
  expect(decodeUtf8(bytes(0xff))).toBeNull()
  expect(decodeUtf8(bytes())).toBe('')
})

it('isJsonlFile은 .jsonl 파일만 받는다(대소문자 무시, .json·.jsonl.txt·확장자 없음은 거절)', () => {
  expect(['a.jsonl', 'A.JSONL', 'set.v2.jsonl', '.jsonl'].map(isJsonlFile)).toEqual([true, true, true, true])
  expect(['a.json', 'a.jsonl.txt', 'jsonl', '', 'a.csv'].map(isJsonlFile)).toEqual([false, false, false, false, false])
})

it('itemSummary는 input을 한 줄로(공백 접기) 보이고 80자를 넘으면 …로 줄인다', () => {
  expect(itemSummary({ input: '첫 줄\n\n  둘째   줄' })).toBe('첫 줄 둘째 줄')
  expect(itemSummary({ input: { question: '질문' } })).toBe('{"question":"질문"}')
  expect(itemSummary({ input: 'x'.repeat(100) })).toBe('x'.repeat(80) + '…')
  expect(itemSummary({ input: 'x'.repeat(80) })).toBe('x'.repeat(80))
  expect(itemSummary({ input: undefined })).toBe('')
})

it('DatasetInvalid는 거절된 줄 목록을 들고 있고, 줄 수를 문구로 말한다(서버의 400 DATASET_INVALID와 올리기 전 검사가 같은 오류다)', () => {
  const errors = [{ line: 2, message: 'JSON으로 읽을 수 없어요.' }, { line: 5, message: 'input이 필요해요.' }]
  const error = new DatasetInvalid(errors)
  expect([error instanceof OperationsRejected, error.errors, error.message]).toEqual([true, errors, '형식이 맞지 않는 줄이 2개 있어요. 고친 뒤 다시 올려 주세요.'])
  expect(new DatasetInvalid([]).message).toBe('형식이 맞지 않아요. 파일을 확인한 뒤 다시 올려 주세요.')
})

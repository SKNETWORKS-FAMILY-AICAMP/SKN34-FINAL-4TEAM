import { readFileSync, readdirSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

import { DATASET_KINDS, DATASET_MAX_BYTES, DATASET_MAX_LINES, DatasetInvalid, GATE_UPLOAD_NOTICE, POOL_PREFIX, datasetKindLabel, datasetKindOf, datasetLimitError, decodeUtf8, isJsonlFile, itemSummary, parseDatasetJsonl, poolOf } from '../entities/llmDatasets'
import { OperationsRejected } from '../entities/operations'

const line = (value: unknown) => JSON.stringify(value)
const row = (extra: Record<string, unknown> = {}) => ({ input: { question: '질문' }, expectedOutput: '정답', metadata: { source: '출처' }, ...extra })

// 서버(운영 DatasetService·DatasetRules)가 돌려주는 줄 오류 문구. 화면 검사는 같은 문구를 써서 파일이 양쪽에서 똑같이 읽힌다: 아래 마지막 시험이 서버 소스에 이 문구가 그대로 있는지 본다.
const MSG = {
  json: 'JSON으로 읽을 수 없어요.', object: '줄 하나가 JSON 객체여야 해요.', unknownKeys: '알 수 없는 칸이 있어요: ', input: 'input이 필요해요.', metadata: 'metadata는 JSON 객체여야 해요.',
  inputObject: 'input은 JSON 객체여야 해요.', expected: 'expectedOutput이 필요해요.', expectedText: 'expectedOutput은 글이어야 해요.',
  question: 'input.question이 필요해요.', contexts: 'input.contexts(글 목록)가 필요해요.', data: 'input.data(객체)가 필요해요.', set: 'input.set은 narration 또는 monologue여야 해요.',
  episode: 'input에는 number(1 이상 정수)·title·body가 필요해요.', goldShape: 'expectedOutput이 정답표(mentions·statements·relationships) 모양이 아니에요.',
  noCore: '정답표에 설정에 드는 core 정답이 하나 이상 있어야 해요.', criteria: 'metadata.criteria가 필요해요.', judge: 'metadata.judge(character·scene·facts)가 필요해요.',
  split: 'metadata.split은 train 또는 val이어야 해요.',
}
const sameInput = (first: number) => '파일의 ' + first + '번째 줄과 input이 같아요.'

describe('평가 데이터셋 JSONL 검사(서버 DatasetService와 같은 줄 규칙): 줄마다 {input, expectedOutput, metadata?}', () => {
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
    expect(parseDatasetJsonl([line(row()), '', 'x'].join('\n')).errors).toEqual([{ line: 3, message: MSG.json }])
    expect(parseDatasetJsonl([line(row()), line(row({ input: { q: 2 } })), 'x'].join('\r')).errors).toEqual([{ line: 3, message: MSG.json }])
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
      { line: 2, message: MSG.json },
      { line: 3, message: MSG.json },
      { line: 4, message: MSG.object },
      { line: 5, message: MSG.object },
      { line: 6, message: MSG.object },
      { line: 7, message: MSG.input },
      { line: 8, message: MSG.input },
      { line: 9, message: MSG.inputObject },
      { line: 10, message: MSG.inputObject },
      { line: 11, message: MSG.expected },
      { line: 12, message: MSG.expected },
      { line: 13, message: MSG.expected },
      { line: 14, message: MSG.expected },
      { line: 15, message: MSG.expected },
      { line: 16, message: MSG.metadata },
      { line: 17, message: MSG.metadata },
    ])
  })

  it('input·expectedOutput·metadata 밖의 칸은 모두 오류다: 문항 id도(서버가 붙인다) 오타(expected_output)도 값을 버리지 않고 거절하며 이름을 알린다', () => {
    const parsed = parseDatasetJsonl([line({ id: 'x', input: { q: 1 }, expectedOutput: 1 }), line({ input: { q: 2 }, expectedOutput: 1, expected_output: 2 }), line({ input: { q: 3 }, expectedOutput: 1, a: 1, b: 2 })].join('\n'))
    expect(parsed.errors).toEqual([
      { line: 1, message: MSG.unknownKeys + 'id' },
      { line: 2, message: MSG.unknownKeys + 'expected_output' },
      { line: 3, message: MSG.unknownKeys + 'a, b' },
    ])
    expect(parsed.lines).toEqual([])
  })

  it('한 줄에 문제가 여럿이어도 첫 문제 하나만 알린다. 서버와 같은 순서: JSON → 객체 → 알 수 없는 칸 → input 있음 → metadata 객체 → input 객체 → expectedOutput 있음(고치면 다음 문제가 보인다)', () => {
    const first = (value: unknown) => parseDatasetJsonl(line(value)).errors
    expect(first({ metadata: 1 })).toEqual([{ line: 1, message: MSG.input }])
    expect(first({ id: 'x' })).toEqual([{ line: 1, message: MSG.unknownKeys + 'id' }])
    expect(first({ typo: 1, metadata: 1 })).toEqual([{ line: 1, message: MSG.unknownKeys + 'typo' }])
    // metadata 모양은 input이 객체인지·expectedOutput이 있는지보다 먼저 본다(서버 line()이 그 순서다).
    expect(first({ input: { q: 1 }, metadata: 1 })).toEqual([{ line: 1, message: MSG.metadata }])
    expect(first({ input: 'x', metadata: 1 })).toEqual([{ line: 1, message: MSG.metadata }])
    expect(first({ input: 'x' })).toEqual([{ line: 1, message: MSG.inputObject }])
    expect(first({ input: 'x', expectedOutput: '정답' })).toEqual([{ line: 1, message: MSG.inputObject }])
    expect(first({ input: { q: 1 } })).toEqual([{ line: 1, message: MSG.expected }])
  })

  it('파일 안에서 같은 input(키 순서·공백이 달라도 같은 JSON)이 다시 나오면 뒤의 줄을 서버와 같은 문구로 알린다(첫 줄을 가리킨다). 배열 순서가 다르거나 수와 글이 다르면 다른 input이다', () => {
    const parsed = parseDatasetJsonl([
      line({ input: { a: 1, b: [1, { c: 2, d: 3 }] }, expectedOutput: '정답' }),
      '{"expectedOutput":"다른 정답","input":{"b":[1,{"d":3,"c":2}], "a":1}}',
      line({ input: { a: 1, b: [{ c: 2, d: 3 }, 1] }, expectedOutput: '정답' }),
      line({ input: { a: '1', b: [1, { c: 2, d: 3 }] }, expectedOutput: '정답' }),
      line({ input: { a: 1, b: [1, { c: 2, d: 3 }] }, expectedOutput: '또 다른 정답' }),
    ].join('\n'))
    expect(parsed.lines).toHaveLength(3)
    expect(parsed.errors).toEqual([{ line: 2, message: sameInput(1) }, { line: 5, message: sameInput(1) }])
  })

  it('질문 검사(같은 input)는 형식이 모두 맞은 뒤에만 한다(서버와 같다): 형식 오류가 있는 파일은 형식 오류만 알리고, 고치면 그제야 중복이 보인다', () => {
    const dup = line({ input: { q: 1 }, expectedOutput: '정답' })
    const broken = parseDatasetJsonl([dup, dup, '{not json'].join('\n'))
    expect(broken.errors).toEqual([{ line: 3, message: MSG.json }])
    expect(broken.lines).toHaveLength(2)   // 형식이 맞은 줄은 통과 건수에 센다
    const fixed = parseDatasetJsonl([dup, dup].join('\n'))
    expect(fixed.errors).toEqual([{ line: 2, message: sameInput(1) }])
    expect(fixed.lines).toHaveLength(1)
  })

  it('빈 파일·빈 줄뿐인 파일은 항목 0건에 오류도 없다(올리기는 UseCase가 막는다)', () => {
    expect(parseDatasetJsonl('')).toEqual({ total: 0, lines: [], errors: [] })
    expect(parseDatasetJsonl('\n  \n')).toEqual({ total: 0, lines: [], errors: [] })
  })
})

// 세트 종류별 필수 칸: 서버 DatasetRules가 채점 코드(app/evaluation/service·simulation·extraction.py)와 seed 항목에서 읽어 정한 규칙이고 문구·순서까지 같다.
const ACT = { input: { set: 'dialogue', data: { scene: '장면' } }, expectedOutput: '대사', metadata: { judge: { character: '연새', scene: [{ by: '연새', text: '말' }], facts: [{ id: 'E1.1', text: '사실' }] } } }
const NARRATE = { input: { set: 'narration', data: {} }, expectedOutput: '지문', metadata: { judge: { character: '', scene: [{ by: '나레이션', text: '지문' }], facts: [] } } }
const BODY = '길동은 칼을 들었다. 칼은 무거웠다. 홍문이 보았다.'
const EPISODE = { number: 3, title: '3화', body: BODY }
const mention = (name: string, kind: string, core = true, aliases: string[] = []) => ({ name, kind, aliases, core })
const statement = (document: string, core = true) => ({ kind: 'fact', document, quote: '길동은 칼을 들었다.', core })
const relation = (source: string, target: string, core = true) => ({ source, target, label: '아버지', core })
const gold = (table: { mentions?: unknown[]; statements?: unknown[]; relationships?: unknown[] } = {}) => ({ mentions: [], statements: [], relationships: [], ...table })
const EXTRACT = { input: EPISODE, expectedOutput: gold({ mentions: [mention('길동', 'character')] }) }
const QA = { input: { question: '질문', contexts: ['근거'] }, expectedOutput: '답' }
const GENERAL = { input: { question: '질문' }, expectedOutput: '답', metadata: { criteria: '기준' } }
const problem = (set: string, item: unknown) => parseDatasetJsonl(line(item), set).errors.map((error) => error.message)
const goldProblem = (table: unknown, input: Record<string, unknown> = EPISODE) => problem('extraction.extract', { input, expectedOutput: table })

describe('세트 종류별 필수 칸(세트 이름으로 정하고 최적화 풀 optimize.<게이트>는 그 게이트와 같다)', () => {
  it('종류는 서버 datasetKind와 같게 이름으로 정한다: 후보 등록 게이트의 짝 세트 4개가 gate, optimize.<게이트>가 pool, 그 밖은 general이다(게이트 없는 optimize.…·대소문자 다른 이름도 general)', () => {
    expect(DATASET_KINDS.map(([kind, label]) => [kind, label])).toEqual([['gate', '평가 게이트'], ['pool', '최적화 풀'], ['general', '범용']])
    expect([datasetKindLabel('gate'), datasetKindLabel('pool'), datasetKindLabel('general')]).toEqual(['평가 게이트', '최적화 풀', '범용'])
    for (const gate of ['qa.grounding', 'simulation.act', 'simulation.narrate', 'extraction.extract']) {
      expect([gate, datasetKindOf(gate)]).toEqual([gate, 'gate'])
      expect([poolOf(gate), datasetKindOf(poolOf(gate))]).toEqual([poolOf(gate), 'pool'])
    }
    for (const name of ['leak.spoiler', 'world.conflict', 'my.set', 'optimize.foo', 'optimize.', 'optimize.optimize.simulation.act', 'Simulation.act', 'qa.mine']) expect([name, datasetKindOf(name)]).toEqual([name, 'general'])
    expect([POOL_PREFIX, poolOf('simulation.act')]).toEqual(['optimize.', 'optimize.simulation.act'])
  })

  it('모든 세트가 같은 기준 모양(input 객체·expectedOutput 필수)이고, 세트를 모르면(이름 없음) 그 공통 규칙만 본다', () => {
    expect(problem('simulation.act', ACT)).toEqual([])
    expect(problem('simulation.narrate', NARRATE)).toEqual([])
    expect(problem('extraction.extract', EXTRACT)).toEqual([])
    expect(problem('qa.grounding', QA)).toEqual([])
    expect(problem('leak.spoiler', GENERAL)).toEqual([])
    expect(parseDatasetJsonl(line(QA)).errors).toEqual([])   // 세트 이름 없이도 공통 규칙은 통과
    expect(parseDatasetJsonl(line({ input: { q: 1 } })).errors).toEqual([{ line: 1, message: MSG.expected }])
    for (const set of ['my.set', 'qa.grounding', 'simulation.act', 'extraction.extract']) expect(problem(set, { input: '글', expectedOutput: '답' }), set).toEqual([MSG.inputObject])
  })

  it('세트 이름이 있으면 input의 세트별 칸을 expectedOutput이 있는지보다 먼저 보고, expectedOutput이 있는지→글인지(추출은 정답표)→metadata 칸→풀의 split 순서로 첫 문제 하나만 알린다', () => {
    expect(problem('simulation.act', { input: { set: 'dialogue' } })).toEqual([MSG.data])   // expectedOutput도 없지만 input 문제가 먼저다
    expect(parseDatasetJsonl(line({ input: { set: 'dialogue' } })).errors).toEqual([{ line: 1, message: MSG.expected }])   // 세트를 모르면 input의 세트별 칸은 보지 않는다
    expect(problem('leak.spoiler', { input: { q: 1 }, expectedOutput: '', metadata: {} })).toEqual([MSG.expected])   // criteria 문제보다 먼저
    expect(problem('simulation.act', { ...ACT, expectedOutput: 7, metadata: {} })).toEqual([MSG.expectedText])   // judge 문제보다 먼저
    expect(problem('optimize.simulation.act', { ...ACT, metadata: { split: 'test' } })).toEqual([MSG.judge])   // split 문제보다 먼저
    expect(problem('optimize.simulation.act', { ...ACT, metadata: { ...ACT.metadata, split: 'test' } })).toEqual([MSG.split])
  })

  it('gate·pool·general 가리지 않고 세트 이름으로 채점 방식을 고르는 AI 규칙을 따른다: expectedOutput은 추출을 뺀 모든 세트에서 글이어야 한다(수·객체·배열은 오류)', () => {
    for (const [set, item] of [['qa.grounding', QA], ['simulation.act', ACT], ['simulation.narrate', NARRATE], ['leak.spoiler', GENERAL], ['optimize.simulation.act', ACT]] as const) {
      expect([set, problem(set, { ...item, expectedOutput: 3 })]).toEqual([set, [MSG.expectedText]])
      expect([set, problem(set, { ...item, expectedOutput: { a: 1 } })]).toEqual([set, [MSG.expectedText]])
      expect([set, problem(set, { ...item, expectedOutput: [1] })]).toEqual([set, [MSG.expectedText]])
      expect([set, problem(set, { ...item, expectedOutput: false })]).toEqual([set, [MSG.expectedText]])
      expect([set, problem(set, { ...item, expectedOutput: '  ' })]).toEqual([set, [MSG.expected]])
    }
  })

  it('시뮬레이션 세트(simulation.act·narrate, optimize. 풀 포함)는 input.data(객체)·글 expectedOutput·metadata.judge(character 글·scene {by,text} 목록·facts {id,text} 목록)가 필요하다', () => {
    const withoutData = { ...ACT, input: { set: 'dialogue' } }
    expect(problem('simulation.act', withoutData)).toEqual([MSG.data])
    expect(problem('simulation.act', { ...ACT, input: { ...ACT.input, data: '글' } })).toEqual([MSG.data])
    expect(problem('simulation.act', { ...ACT, metadata: { source: 'x' } })).toEqual([MSG.judge])
    expect(problem('simulation.act', { ...ACT, metadata: { judge: [] } })).toEqual([MSG.judge])
    const judge = (patch: Record<string, unknown>) => ({ ...ACT, metadata: { judge: { ...ACT.metadata.judge, ...patch } } })
    // 루브릭 입력이 어긋나면 어느 칸이든 같은 한 문구다(서버와 같다).
    for (const bad of [{ character: 1 }, { character: undefined }, { scene: [{ by: '연새' }] }, { scene: '글' }, { scene: undefined }, { scene: [{ by: '연새', text: 3 }] }, { facts: [{ id: 1, text: '사실' }] }, { facts: [{ id: 'f1' }] }, { facts: undefined }]) {
      expect([JSON.stringify(bad), problem('simulation.act', judge(bad))]).toEqual([JSON.stringify(bad), [MSG.judge]])
    }
    expect(problem('simulation.act', judge({ scene: [], facts: [] }))).toEqual([])   // 채점 코드는 빈 목록을 받는다
    expect(problem('simulation.act', judge({ character: '' }))).toEqual([])   // 나레이션은 인물이 없어 빈 글이다
    expect(problem('optimize.simulation.act', { ...ACT, metadata: { source: 'x' } })).toEqual([MSG.judge])
    // narrate는 input.set이 narration 또는 monologue여야 채점된다(act는 set을 보지 않는다).
    expect(problem('simulation.narrate', { ...NARRATE, input: { set: 'dialogue', data: {} } })).toEqual([MSG.set])
    expect(problem('simulation.narrate', { ...NARRATE, input: { data: {} } })).toEqual([MSG.set])
    expect(problem('simulation.narrate', { ...NARRATE, input: { set: 3, data: {} } })).toEqual([MSG.set])
    expect(problem('simulation.narrate', { ...NARRATE, input: { set: 'monologue', data: {} } })).toEqual([])
    expect(problem('simulation.narrate', { ...NARRATE, input: { set: 'narration' } })).toEqual([MSG.data])   // data가 set보다 먼저다
    expect(problem('optimize.simulation.narrate', { ...NARRATE, input: { set: 'x', data: {} } })).toEqual([MSG.set])
    expect(problem('simulation.act', { ...ACT, input: { set: 'anything', data: {} } })).toEqual([])
  })

  it('추출 세트(extraction.extract, 풀 포함)의 input은 회차 {number(1 이상 정수)·title·body 글}이다', () => {
    const input = (patch: Record<string, unknown>) => ({ ...EXTRACT, input: { ...EPISODE, ...patch } })
    for (const patch of [{ number: 0 }, { number: 1.5 }, { number: '2' }, { number: true }, { number: undefined }, { title: 1 }, { title: undefined }, { body: null }, { body: undefined }]) {
      expect([JSON.stringify(patch), problem('extraction.extract', input(patch))]).toEqual([JSON.stringify(patch), [MSG.episode]])
    }
    expect(problem('optimize.extraction.extract', input({ number: 0 }))).toEqual([MSG.episode])
    expect(problem('extraction.extract', input({ title: '', body: '' }))).toEqual([])   // 빈 글도 글이다(회차 입력 모양은 통과)
    expect(problem('extraction.extract', input({ extra: 1 }))).toEqual([])   // 회차 입력은 모르는 칸을 무시한다
  })

  it('추출 정답표 expectedOutput은 {mentions, statements, relationships}의 정해진 칸(core는 진짜 true·false)이어야 한다', () => {
    const ok = mention('길동', 'character')
    for (const bad of ['표', [1], { mentions: [], statements: [] }, { mentions: {}, statements: [], relationships: [] },
      gold({ mentions: [{ kind: 'character', aliases: [], core: true }] }),                       // name 없음
      gold({ mentions: [{ name: '길동', aliases: [], core: true }] }),                            // kind 없음
      gold({ mentions: [{ name: '길동', kind: 'character', core: true }] }),                      // aliases 없음
      gold({ mentions: [{ name: '길동', kind: 'character', aliases: [1], core: true }] }),         // aliases가 글이 아님
      gold({ mentions: [{ name: '길동', kind: 'character', aliases: [], core: 'true' }] }),        // core는 진짜 boolean
      gold({ mentions: [ok], statements: [{ kind: 'fact', quote: 'q', core: true }] }),           // document 없음
      gold({ mentions: [ok], statements: [{ kind: 'fact', document: 'identity', core: true }] }),  // quote 없음
      gold({ mentions: [ok], relationships: [{ source: '길동', target: '홍문', core: true }] }),     // label 없음
      gold({ mentions: [ok], relationships: [{ source: '길동', label: '아버지', core: true }] })]) {   // target 없음
      expect([JSON.stringify(bad), goldProblem(bad)]).toEqual([JSON.stringify(bad), [MSG.goldShape]])
    }
    expect(goldProblem(gold({ mentions: [ok] }))).toEqual([])   // 빈 목록도 정답표다
    expect(goldProblem({})).toEqual([MSG.expected])   // 빈 객체는 expectedOutput이 없는 것과 같다
    expect(problem('optimize.extraction.extract', { input: EPISODE, expectedOutput: '글' })).toEqual([MSG.goldShape])
  })

  it('정답표에는 설정에 드는 core 정답이 하나 이상 있어야 한다(채점기가 recall을 정하는 규칙 그대로): core가 아니거나, 본문에 한 번만 나온 물건·memory 진술·인물 없는 관계뿐이면 채점할 수 없어 거절한다', () => {
    expect(goldProblem(gold())).toEqual([MSG.noCore])   // 아무 정답도 없다
    expect(goldProblem(gold({ mentions: [mention('길동', 'character', false)] }))).toEqual([MSG.noCore])   // core가 아니다
    expect(goldProblem(gold({ mentions: [mention('홍문', 'object')] }))).toEqual([MSG.noCore])   // 본문에 한 번만 나온 물건은 설정이 아니다
    expect(goldProblem(gold({ mentions: [mention('칼', 'object')] }))).toEqual([])   // 본문에 두 번 나온 물건은 설정이다
    expect(goldProblem(gold({ mentions: [mention('검', 'object', true, ['칼'])] }))).toEqual([])   // 이름과 별칭 가운데 가장 많이 나온 것으로 센다
    expect(goldProblem(gold({ mentions: [mention('장소', 'place')] }))).toEqual([])   // 물건이 아니면 몇 번 나오든 설정이다
    expect(goldProblem(gold({ statements: [statement('memory')] }))).toEqual([MSG.noCore])   // 줄거리 사건은 설정이 아니다
    for (const document of ['identity', 'soul', 'goal']) expect([document, goldProblem(gold({ statements: [statement(document)] }))]).toEqual([document, []])
    expect(goldProblem(gold({ statements: [statement('identity', false)] }))).toEqual([MSG.noCore])
    // 관계는 두 끝점이 모두 설정(물건이 아니거나 두 번 이상 나온 물건)이고 한쪽이 인물일 때 센다.
    const ends = [mention('길동', 'character', false), mention('홍문', 'character', false)]
    expect(goldProblem(gold({ mentions: ends, relationships: [relation('길동', '홍문')] }))).toEqual([])
    expect(goldProblem(gold({ mentions: ends, relationships: [relation('길동', '홍문', false)] }))).toEqual([MSG.noCore])
    expect(goldProblem(gold({ mentions: [mention('길동', 'character', false)], relationships: [relation('길동', '홍문')] }))).toEqual([MSG.noCore])   // 끝점이 대상에 없다
    expect(goldProblem(gold({ mentions: [mention('길동', 'character', false), mention('홍문', 'object', false)], relationships: [relation('길동', '홍문')] }))).toEqual([MSG.noCore])   // 한 번만 나온 물건 끝점
    expect(goldProblem(gold({ mentions: [mention('칼', 'object', false), mention('책', 'location', false)], relationships: [relation('칼', '책')] }))).toEqual([MSG.noCore])   // 인물 끝점이 없다
    expect(goldProblem(gold({ mentions: [mention('칼', 'object', false), mention('길동', 'character', false)], relationships: [relation('길동', '칼')] }))).toEqual([])
    // 같은 이름의 대상이 둘이면 뒤의 것이 끝점이다(채점기의 by_name과 같다).
    expect(goldProblem(gold({ mentions: [mention('길동', 'character', false), mention('홍문', 'character', false), mention('홍문', 'object', false)], relationships: [relation('길동', '홍문')] }))).toEqual([MSG.noCore])
  })

  it('물건 이름은 채점기가 세는 대로 센다(파이썬 str.count): 겹치는 것은 하나로, 글자 그대로(패턴이 아님), 빈 이름은 글자 수보다 한 번 더 나온다', () => {
    const check = (body: string, name: string) => goldProblem(gold({ mentions: [mention(name, 'object')] }), { ...EPISODE, body })
    expect(check('가가가', '가가')).toEqual([MSG.noCore])   // 겹치는 것은 하나다
    expect(check('가가 가가', '가가')).toEqual([])
    expect(check('글', '')).toEqual([])   // 빈 이름은 글 한 자 + 1 = 2번
    expect(check('', '')).toEqual([MSG.noCore])   // 빈 본문은 1번
    expect(check('a.b a.b', 'a.b')).toEqual([])   // 이름은 글자 그대로이고 패턴이 아니다
    expect(check('axb ayb', 'a.b')).toEqual([MSG.noCore])   // 패턴이면 두 번 찾는다
    expect(check('😀😀', '😀')).toEqual([])
  })

  it('Q&A 세트(qa.로 시작: 게이트 qa.grounding과 이름이 qa.로 시작하는 세트, 풀 포함)는 input.question(비지 않은 글)과 input.contexts(비지 않은 글 목록)가 필요하다', () => {
    for (const bad of [{ contexts: ['근거'] }, { question: ' ', contexts: ['근거'] }, { question: 3, contexts: ['근거'] }]) expect([JSON.stringify(bad), problem('qa.grounding', { ...QA, input: bad })]).toEqual([JSON.stringify(bad), [MSG.question]])
    for (const bad of [{ question: '질문' }, { question: '질문', contexts: [] }, { question: '질문', contexts: '근거' }, { question: '질문', contexts: ['근거', 3] }, { question: '질문', contexts: ['근거', ' '] }]) {
      expect([JSON.stringify(bad), problem('qa.grounding', { ...QA, input: bad })]).toEqual([JSON.stringify(bad), [MSG.contexts]])
    }
    expect(problem('qa.mine', QA)).toEqual([])   // qa. 접두가 채점기를 고른다(게이트 목록이 아니다)
    expect(problem('qa.mine', { ...QA, input: { question: '질문' } })).toEqual([MSG.contexts])
    expect(problem('optimize.qa.grounding', QA)).toEqual([])
    expect(problem('optimize.qa.grounding', { ...QA, input: {} })).toEqual([MSG.question])
    expect(problem('optimize.qa.mine', QA)).toEqual([MSG.criteria])   // 게이트가 없는 optimize.…는 풀이 아니라 범용이라 이름 전체로 채점기를 고른다
  })

  it('그 밖의 세트(범용: 누설·세계관 충돌·집필 수정과 이름을 모르는 세트)는 GEval이 읽는 metadata.criteria(비지 않은 글)가 필요하다', () => {
    for (const bad of [{ source: 'x' }, { criteria: ' ' }, { criteria: '' }, { criteria: 3 }, undefined]) {
      expect([JSON.stringify(bad), problem('world.conflict', { ...GENERAL, metadata: bad })]).toEqual([JSON.stringify(bad), [MSG.criteria]])
    }
    expect(problem('writing.fix', { input: { task: 'a' }, expectedOutput: '답' })).toEqual([MSG.criteria])
    expect(problem('whatever.set', GENERAL)).toEqual([])
    // 이름으로 채점기를 고르므로 simulation.foo도 GEval 세트다.
    expect(problem('simulation.foo', ACT)).toEqual([MSG.criteria])
    expect(problem('optimize.foo', GENERAL)).toEqual([])
  })

  it('최적화 풀(optimize.<게이트>)은 metadata.split이 없거나 null이면 서버가 정해 주고, 있으면 train 또는 val이어야 한다. 게이트·범용 세트는 split을 따지지 않는다', () => {
    const split = (value: unknown) => ({ ...ACT, metadata: { ...ACT.metadata, split: value } })
    expect(problem('optimize.simulation.act', ACT)).toEqual([])
    expect(problem('optimize.simulation.act', split(null))).toEqual([])
    for (const good of ['train', 'val']) expect(problem('optimize.simulation.act', split(good))).toEqual([])
    for (const bad of ['test', 'Train', '', 1, true, []]) expect([JSON.stringify(bad), problem('optimize.simulation.act', split(bad))]).toEqual([JSON.stringify(bad), [MSG.split]])
    expect(problem('simulation.act', split('test'))).toEqual([])
    expect(problem('optimize.foo', { ...GENERAL, metadata: { criteria: '기준', split: 'test' } })).toEqual([])   // 게이트가 없어 풀이 아니다
  })
})

const DATASETS = new URL('../../../../backend/ai-service/app/evaluation/datasets/', import.meta.url)
const seedSets = [
  ...readdirSync(DATASETS).filter((name) => name.endsWith('.jsonl')).map((name) => [name.replace(/\.jsonl$/, ''), new URL(name, DATASETS)] as const),
  ...readdirSync(new URL('optimize/', DATASETS)).filter((name) => name.endsWith('.jsonl')).map((name) => [POOL_PREFIX + name.replace(/\.jsonl$/, ''), new URL('optimize/' + name, DATASETS)] as const),
]

it('저장소의 실제 평가 세트·풀 파일(7개 세트와 풀 3개)의 모든 문항이 자기 세트의 검사를 통과한다: 검사가 현실보다 엄격하지 않다(서버 DatasetRulesTest와 같은 확인)', () => {
  expect(seedSets.map(([name]) => name)).toHaveLength(10)
  for (const [name, url] of seedSets) {
    const rows = readFileSync(url, 'utf8').split('\n').filter((text) => text.trim()).map((text) => JSON.parse(text))
    // 문항 id는 서버가 붙이므로 올리는 줄에는 없다.
    const parsed = parseDatasetJsonl(rows.map(({ input, expectedOutput, metadata }) => JSON.stringify({ input, expectedOutput, metadata })).join('\n'), name)
    expect([name, parsed.errors.slice(0, 3)]).toEqual([name, []])
    expect([name, parsed.lines.length]).toEqual([name, rows.length])
  }
})

it('화면의 줄 오류 문구는 서버 소스(DatasetService·DatasetRules)에 그대로 있다: 문구가 어긋나면 같은 파일이 양쪽에서 다르게 읽힌다. 게이트 안내도 서버의 notice와 같다', () => {
  const server = ['DatasetService.kt', 'DatasetRules.kt'].map((name) => readFileSync(new URL('../../../../backend/operations-service/src/main/kotlin/ai/storyfork/operations/llmops/service/' + name, import.meta.url), 'utf8')).join('\n')
  for (const message of Object.values(MSG)) expect(server, message).toContain(message)
  expect(server).toContain('"파일의 ${first.getValue(line.hash)}번째 줄과 input이 같아요."')
  expect(sameInput(2)).toBe('파일의 2번째 줄과 input이 같아요.')
  expect(server).toContain('private const val GATE_NOTICE = "' + GATE_UPLOAD_NOTICE + '"')
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
  const errors = [{ line: 2, message: MSG.json }, { line: 5, message: MSG.input }]
  const error = new DatasetInvalid(errors)
  expect([error instanceof OperationsRejected, error.errors, error.message]).toEqual([true, errors, '형식이 맞지 않는 줄이 2개 있어요. 고친 뒤 다시 올려 주세요.'])
  expect(new DatasetInvalid([]).message).toBe('형식이 맞지 않아요. 파일을 확인한 뒤 다시 올려 주세요.')
})

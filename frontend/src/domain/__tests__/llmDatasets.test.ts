import { describe, expect, it } from 'vitest'

import { DATASET_MAX_BYTES, DATASET_MAX_LINES, DatasetInvalid, datasetLimitError, decodeUtf8, isJsonlFile, itemSummary, parseDatasetJsonl } from '../entities/llmDatasets'
import { OperationsRejected } from '../entities/operations'

const line = (value: unknown) => JSON.stringify(value)
const row = (extra: Record<string, unknown> = {}) => ({ input: { question: '질문' }, expectedOutput: '정답', metadata: { source: '출처' }, ...extra })

describe('평가 데이터셋 JSONL 검사(#868, 서버 DatasetService와 같은 규칙): 줄마다 {input, expectedOutput?, metadata?}', () => {
  it('input만 있어도 통과하고 expectedOutput·metadata는 선택이며, null은 없는 것과 같아 보내지 않는다(0·false·빈 문자열은 값이다)', () => {
    const parsed = parseDatasetJsonl([
      line(row()), line({ input: '질문 글' }), line({ input: 1, expectedOutput: null, metadata: null }), line({ input: 1, expectedOutput: 0 }), line({ input: 1, expectedOutput: '' }),
    ].join('\n'))
    expect([parsed.total, parsed.errors]).toEqual([5, []])
    expect(parsed.lines).toEqual([row(), { input: '질문 글' }, { input: 1 }, { input: 1, expectedOutput: 0 }, { input: 1, expectedOutput: '' }])
  })

  it('빈 줄은 건수에 넣지 않고 건너뛰며, 줄 번호는 파일의 줄 그대로이고, CRLF·CR만 있는 줄바꿈과 맨 앞 BOM도 받아들인다(서버의 lines()와 같다)', () => {
    const parsed = parseDatasetJsonl('\uFEFF' + [line(row()), '', '   ', line(row()), ''].join('\r\n'))
    expect([parsed.total, parsed.lines.length, parsed.errors]).toEqual([2, 2, []])
    expect(parseDatasetJsonl([line(row()), '', 'x'].join('\n')).errors).toEqual([{ line: 3, message: 'JSON으로 읽을 수 없어요.' }])
    expect(parseDatasetJsonl([line(row()), line(row()), 'x'].join('\r')).errors).toEqual([{ line: 3, message: 'JSON으로 읽을 수 없어요.' }])
  })

  it('JSON이 아니거나(JSON 뒤에 글이 붙은 줄 포함) 객체가 아닌 줄, input이 없거나 null인 줄, metadata 모양이 틀린 줄은 줄 번호와 이유로 알리고 나머지 줄은 계속 검사한다', () => {
    const parsed = parseDatasetJsonl([
      line(row()),
      '{not json',
      '{"input":1} 뒤에 붙은 글',
      line([1, 2]),
      line('글자'),
      line(null),
      line({ expectedOutput: 1 }),
      line({ input: null }),
      line({ input: 1, metadata: [] }),
      line({ input: 1, metadata: 'm' }),
      line({ input: 1, metadata: null }),
    ].join('\n'))
    expect(parsed.total).toBe(11)
    expect(parsed.lines).toHaveLength(2)   // 첫 줄과 metadata가 null인 줄(비어 있는 것과 같다)
    expect(parsed.errors).toEqual([
      { line: 2, message: 'JSON으로 읽을 수 없어요.' },
      { line: 3, message: 'JSON으로 읽을 수 없어요.' },
      { line: 4, message: '줄 하나가 JSON 객체여야 해요.' },
      { line: 5, message: '줄 하나가 JSON 객체여야 해요.' },
      { line: 6, message: '줄 하나가 JSON 객체여야 해요.' },
      { line: 7, message: 'input이 필요해요.' },
      { line: 8, message: 'input이 필요해요.' },
      { line: 9, message: 'metadata는 JSON 객체여야 해요.' },
      { line: 10, message: 'metadata는 JSON 객체여야 해요.' },
    ])
  })

  it('input·expectedOutput·metadata 밖의 칸은 모두 오류다: 문항 id도(서버가 붙인다) 오타(expected_output)도 값을 버리지 않고 거절하며 이름을 알린다', () => {
    const parsed = parseDatasetJsonl([line({ id: 'x', input: 1 }), line({ input: 1, expected_output: 2 }), line({ input: 1, a: 1, b: 2 })].join('\n'))
    expect(parsed.errors).toEqual([
      { line: 1, message: '알 수 없는 칸이 있어요: id' },
      { line: 2, message: '알 수 없는 칸이 있어요: expected_output' },
      { line: 3, message: '알 수 없는 칸이 있어요: a, b' },
    ])
    expect(parsed.lines).toEqual([])
  })

  it('한 줄에 문제가 여럿이어도 첫 문제 하나만 알린다: 순서는 JSON → 객체 → 알 수 없는 칸 → input → metadata(고치면 다음 문제가 보인다)', () => {
    expect(parseDatasetJsonl(line({ metadata: 1 })).errors).toEqual([{ line: 1, message: 'input이 필요해요.' }])
    expect(parseDatasetJsonl(line({ id: 'x' })).errors).toEqual([{ line: 1, message: '알 수 없는 칸이 있어요: id' }])
    expect(parseDatasetJsonl(line({ typo: 1, metadata: 1 })).errors).toEqual([{ line: 1, message: '알 수 없는 칸이 있어요: typo' }])
  })

  it('빈 파일·빈 줄뿐인 파일은 항목 0건에 오류도 없다(올리기는 UseCase가 막는다)', () => {
    expect(parseDatasetJsonl('')).toEqual({ total: 0, lines: [], errors: [] })
    expect(parseDatasetJsonl('\n  \n')).toEqual({ total: 0, lines: [], errors: [] })
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

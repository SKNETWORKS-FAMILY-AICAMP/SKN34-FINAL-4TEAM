import { describe, expect, it } from 'vitest'

import { isJsonlFile, itemSummary, parseDatasetJsonl } from '../entities/llmDatasets'

const line = (value: unknown) => JSON.stringify(value)
const item = (id: string, extra: Record<string, unknown> = {}) => ({ id, input: { question: '질문' }, expectedOutput: '정답', metadata: { source: '출처' }, ...extra })

describe('평가 데이터셋 JSONL 검사(#857): 줄마다 서버 시드(seed.py)와 같은 항목 모양 {id, input, expectedOutput?, metadata}', () => {
  it('id·input·metadata가 있으면 통과하고 expectedOutput은 없어도 된다', () => {
    const parsed = parseDatasetJsonl([line(item('a')), line({ id: 'b', input: '질문 글', metadata: {} })].join('\n'))
    expect([parsed.total, parsed.items.map((i) => i.id), parsed.errors]).toEqual([2, ['a', 'b'], []])
    expect(parsed.items[0]).toEqual(item('a'))
    expect(parsed.items[1]).toEqual({ id: 'b', input: '질문 글', metadata: {} })
  })

  it('빈 줄은 건수에 넣지 않고 건너뛰며, 줄 번호는 파일의 줄 그대로이고, CRLF와 맨 앞 BOM도 받아들인다', () => {
    const text = '\uFEFF' + [line(item('a')), '', '   ', line(item('b')), ''].join('\r\n')
    const parsed = parseDatasetJsonl(text)
    expect([parsed.total, parsed.items.map((i) => i.id), parsed.errors]).toEqual([2, ['a', 'b'], []])
    expect(parseDatasetJsonl([line(item('a')), '', 'x'].join('\n')).errors).toEqual([{ line: 3, message: 'JSON으로 읽을 수 없어요.' }])
  })

  it('JSON이 아니거나 객체가 아닌 줄, 필수 칸이 없거나 모양이 틀린 줄은 줄 번호와 이유로 알리고 나머지 줄은 계속 검사한다', () => {
    const text = [
      line(item('ok')),
      '{not json',
      line([1, 2]),
      line('글자'),
      line(null),
      line({ input: 1, metadata: {} }),
      line({ id: '', input: 1, metadata: {} }),
      line({ id: 7, input: 1, metadata: {} }),
      line({ id: 'x', metadata: {} }),
      line({ id: 'x', input: null, metadata: {} }),
      line({ id: 'x', input: 1 }),
      line({ id: 'x', input: 1, metadata: [] }),
      line({ id: 'x', input: 1, metadata: 'm' }),
    ].join('\n')
    const parsed = parseDatasetJsonl(text)
    expect(parsed.total).toBe(13)
    expect(parsed.items.map((i) => i.id)).toEqual(['ok'])
    expect(parsed.errors).toEqual([
      { line: 2, message: 'JSON으로 읽을 수 없어요.' },
      { line: 3, message: '줄 하나가 JSON 객체여야 해요.' },
      { line: 4, message: '줄 하나가 JSON 객체여야 해요.' },
      { line: 5, message: '줄 하나가 JSON 객체여야 해요.' },
      { line: 6, message: 'id는 비어 있지 않은 글자여야 해요.' },
      { line: 7, message: 'id는 비어 있지 않은 글자여야 해요.' },
      { line: 8, message: 'id는 비어 있지 않은 글자여야 해요.' },
      { line: 9, message: 'input이 필요해요.' },
      { line: 10, message: 'input이 필요해요.' },
      { line: 11, message: 'metadata는 JSON 객체여야 해요.' },
      { line: 12, message: 'metadata는 JSON 객체여야 해요.' },
      { line: 13, message: 'metadata는 JSON 객체여야 해요.' },
    ])
  })

  it('알 수 없는 칸(expected_output 같은 오타)은 조용히 버리지 않고 오류로 알린다', () => {
    expect(parseDatasetJsonl(line({ id: 'x', input: 1, metadata: {}, expected_output: 'y', note: 'n' })).errors).toEqual([{ line: 1, message: '알 수 없는 칸이 있어요: expected_output, note' }])
  })

  it('한 줄에 문제가 여럿이어도 첫 문제 하나만 알린다(고치면 다음 문제가 보인다)', () => {
    expect(parseDatasetJsonl(line({ input: null })).errors).toEqual([{ line: 1, message: 'id는 비어 있지 않은 글자여야 해요.' }])
  })

  it('같은 id가 다시 나오면 뒤쪽 줄을 오류로 알리고 처음 것만 남긴다(id가 항목을 덮어쓰는 열쇠라 한 파일 안에서 겹치면 한쪽이 사라진다)', () => {
    const parsed = parseDatasetJsonl([line(item('a')), line(item('b')), line(item('a', { input: '다른 입력' }))].join('\n'))
    expect(parsed.items.map((i) => [i.id, i.input])).toEqual([['a', { question: '질문' }], ['b', { question: '질문' }]])
    expect(parsed.errors).toEqual([{ line: 3, message: 'id가 1번째 줄과 같아요.' }])
  })

  it('빈 파일·빈 줄뿐인 파일은 항목 0건에 오류도 없다(올리기는 UseCase가 막는다)', () => {
    expect(parseDatasetJsonl('')).toEqual({ total: 0, items: [], errors: [] })
    expect(parseDatasetJsonl('\n  \n')).toEqual({ total: 0, items: [], errors: [] })
  })
})

it('isJsonlFile은 .jsonl 파일만 받는다(대소문자 무시, .json·.jsonl.txt·확장자 없음은 거절)', () => {
  expect(['a.jsonl', 'A.JSONL', 'set.v2.jsonl', '.jsonl'].map(isJsonlFile)).toEqual([true, true, true, true])
  expect(['a.json', 'a.jsonl.txt', 'jsonl', '', 'a.csv'].map(isJsonlFile)).toEqual([false, false, false, false, false])
})

it('itemSummary는 input을 한 줄로(공백 접기) 보이고 80자를 넘으면 …로 줄인다', () => {
  expect(itemSummary({ id: 'a', input: '첫 줄\n\n  둘째   줄', metadata: {} })).toBe('첫 줄 둘째 줄')
  expect(itemSummary({ id: 'a', input: { question: '질문' }, metadata: {} })).toBe('{"question":"질문"}')
  expect(itemSummary({ id: 'a', input: 'x'.repeat(100), metadata: {} })).toBe('x'.repeat(80) + '…')
  expect(itemSummary({ id: 'a', input: 'x'.repeat(80), metadata: {} })).toBe('x'.repeat(80))
})

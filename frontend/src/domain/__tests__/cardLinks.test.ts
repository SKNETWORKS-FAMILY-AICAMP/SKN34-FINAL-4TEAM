import { describe, expect, it } from 'vitest'

import { cardLinkId, cardLinkMarkdown, cardLinks, replaceCardLinks, stripCardLinks } from '../entities/cardLinks'

const A = 'aaaaaaaa-2222-3333-4444-555555555555'
const B = 'bbbbbbbb-2222-3333-4444-555555555555'

describe('카드 본문 링크의 검증 표 (docs/design/worldstudio-independent-schema.md)', () => {
  // 표의 행을 순서대로 옮긴다. 같은 행을 서버(Kotlin)와 AI 입력 경계(Python)도 따로 검사한다.
  const FOUND: [body: string, links: [text: string, id: string][]][] = [
    [`[승상](card:${A})`, [['승상', A]]],
    [`앞 [갑](card:${A}) 중 [을](card:${B}) 뒤`, [['갑', A], ['을', B]]],
    [`[갑](card:${A})[을](card:${B})`, [['갑', A], ['을', B]]],
    [`[갑](card:${A.toUpperCase()})`, [['갑', A]]], // 대소문자 무시, id는 소문자로
    [`\`[갑](card:${A})\``, [['갑', A]]], // 코드(백틱) 안도 링크
    [`[](card:${A})`, []],
    ['[갑](card:1111)', []],
    [`[갑](card: ${A})`, []],
    [`[갑](CARD:${A})`, []],
    ['[갑](https://example.com)', []],
    [`[[갑]](card:${A})`, []],
    [`[갑\n을](card:${A})`, []],
    [`[${'가'.repeat(200)}](card:${A})`, [['가'.repeat(200), A]]],
    [`[${'가'.repeat(201)}](card:${A})`, []],
    // 중첩 괄호
    [`[갑[을]](card:${A})`, []],
    [`[갑]을](card:${A})`, []],
    [`([갑](card:${A}))`, [['갑', A]]],
    [`card:${A}`, []],
  ]
  it.each(FOUND.map((row, i) => [i + 1, ...row] as const))('%i. 찾는 링크', (_, body, expected) => {
    expect(cardLinks(body).map(({ text, id }) => [text, id])).toEqual(expected)
  })

  it('글자로 벗기기는 대상과 상관없이 [글자](card:id)를 글자로 바꾼다', () => {
    expect(stripCardLinks(`[승상](card:${A})`)).toBe('승상')
    expect(stripCardLinks(`앞 [갑](card:${A}) 중 [을](card:${B})`)).toBe('앞 갑 중 을')
    expect(stripCardLinks(`[](card:${A}) card:${A}`)).toBe(`[](card:${A}) card:${A}`)
  })

  it('replaceCardLinks는 링크마다 바꿀 글을 정하고 링크가 아닌 곳은 그대로 둔다', () => {
    const body = `앞 [갑](card:${A}) 뒤 [을](card:${B})`
    expect(replaceCardLinks(body, ({ text, id }) => (id === B ? cardLinkMarkdown(id, text) : text))).toBe(`앞 갑 뒤 [을](card:${B})`)
  })
})

describe('링크 주소와 삽입 글', () => {
  it('cardLinkId는 card:<uuid> 주소만 소문자 id로 읽는다', () => {
    expect(cardLinkId(`card:${A.toUpperCase()}`)).toBe(A)
    for (const href of [undefined, '', 'card:1111', `CARD:${A}`, ` card:${A}`, `card:${A} `, `https://example.com/card:${A}`]) expect(cardLinkId(href)).toBeUndefined()
  })

  it('삽입하는 글은 선택한 글자를, 없으면 대상 제목을 쓰고 [ ]·줄바꿈은 뺀다', () => {
    expect(cardLinkMarkdown(A, '승상', '이름')).toBe(`[승상](card:${A})`)
    expect(cardLinkMarkdown(A, '', '이름')).toBe(`[이름](card:${A})`)
    expect(cardLinkMarkdown(A, '  ', ' 리안 ')).toBe(`[리안](card:${A})`)
    expect(cardLinkMarkdown(A, '[갑]\n을', '이름')).toBe(`[갑을](card:${A})`)
    expect(cardLinkMarkdown(A, '[]', '')).toBe(`[설정](card:${A})`)
  })

  it('삽입한 글은 다시 읽으면 같은 링크이고 글자는 200자(UTF-16)까지만 쓴다', () => {
    const long = '가'.repeat(250)
    expect(cardLinks(cardLinkMarkdown(A, long, '이름'))).toEqual([{ text: '가'.repeat(200), id: A }])
    // 200번째 글자가 서로게이트 쌍의 앞이면 쌍을 자른 글자는 남기지 않는다.
    const emoji = '가'.repeat(199) + '😀' + '나'
    expect(cardLinks(cardLinkMarkdown(A, emoji, '이름'))).toEqual([{ text: '가'.repeat(199), id: A }])
  })
})

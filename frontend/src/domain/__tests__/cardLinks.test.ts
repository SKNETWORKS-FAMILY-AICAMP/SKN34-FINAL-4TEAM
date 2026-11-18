import { describe, expect, it } from 'vitest'

import { cardLinkMarkdown, cardLinkOf, cardLinks, replaceCardLinks, stripCardLinks } from '../entities/cardLinks'

const A = 'aaaaaaaa-2222-3333-4444-555555555555'
const B = 'bbbbbbbb-2222-3333-4444-555555555555'

describe('카드 본문 링크의 검증 표 (docs/design/worldstudio-independent-schema.md)', () => {
  // 표의 행을 순서대로 옮긴다. 같은 행을 서버(Kotlin)와 AI 입력 경계(Python)도 따로 검사한다(글자로 벗긴 결과 칸).
  // 링크로 인정하지 않는 모양에 남은 card:<uuid>(마크다운 파서는 링크로 읽을 수 있다)는 벗길 때 지운다.
  const ROWS: [body: string, links: [text: string, id: string][], stripped: string][] = [
    [`[승상](card:${A})`, [['승상', A]], '승상'],
    [`앞 [갑](card:${A}) 중 [을](card:${B}) 뒤`, [['갑', A], ['을', B]], '앞 갑 중 을 뒤'],
    [`[갑](card:${A})[을](card:${B})`, [['갑', A], ['을', B]], '갑을'],
    [`[갑](card:${A.toUpperCase()})`, [['갑', A]], '갑'], // 대소문자 무시, id는 소문자로
    [`\`[갑](card:${A})\``, [['갑', A]], '`갑`'], // 코드(백틱) 안도 링크
    [`[](card:${A})`, [], '[]()'],
    ['[갑](card:1111)', [], '[갑](card:1111)'],
    [`[갑](card: ${A})`, [], `[갑](card: ${A})`],
    [`[갑](CARD:${A})`, [], '[갑]()'],
    ['[갑](https://example.com)', [], '[갑](https://example.com)'],
    [`[[갑]](card:${A})`, [], '[[갑]]()'],
    [`[갑\n을](card:${A})`, [], '[갑\n을]()'],
    [`[${'가'.repeat(200)}](card:${A})`, [['가'.repeat(200), A]], '가'.repeat(200)],
    [`[${'가'.repeat(201)}](card:${A})`, [], `[${'가'.repeat(201)}]()`],
    // 중첩 괄호
    [`[갑[을]](card:${A})`, [], '[갑[을]]()'],
    [`[갑]을](card:${A})`, [], '[갑]을]()'],
    [`([갑](card:${A}))`, [['갑', A]], '(갑)'],
    // 링크로 인정하지 않는 모양: 파서는 링크로 읽을 수 있어도 정규식은 링크로 보지 않고 남은 card:<uuid>만 지운다.
    [`card:${A}`, [], ''],
    [`<card:${A}>`, [], '<>'],
    [`[갑](<card:${A}>)`, [], '[갑](<>)'],
    [`[갑](card:${A} "t")`, [], '[갑]( "t")'],
  ]
  it.each(ROWS.map((row, i) => [i + 1, ...row] as const))('%i. 찾는 링크와 글자로 벗긴 결과', (_, body, links, stripped) => {
    expect(cardLinks(body).map(({ text, id }) => [text, id])).toEqual(links)
    expect(stripCardLinks(body)).toBe(stripped)
  })

  it('replaceCardLinks는 링크마다 바꿀 글을 정하고 링크가 아닌 곳은 그대로 둔다', () => {
    const body = `앞 [갑](card:${A}) 뒤 [을](card:${B}) <card:${A}>`
    expect(replaceCardLinks(body, ({ text, id }) => (id === B ? cardLinkMarkdown(id, text) : text))).toBe(`앞 갑 뒤 [을](card:${B}) <card:${A}>`)
  })
})

describe('링크 원문 판정과 삽입 글', () => {
  it('cardLinkOf는 원문 전체가 정규식이 인정한 링크일 때만 소문자 id를 준다(화면이 링크로 그릴지 가린다)', () => {
    expect(cardLinkOf(`[갑](card:${A})`)).toBe(A)
    expect(cardLinkOf(`[갑](card:${A.toUpperCase()})`)).toBe(A)
    for (const raw of [
      '', `[[갑]](card:${A})`, `[갑\n을](card:${A})`, `<card:${A}>`, `[갑](<card:${A}>)`, `[갑](card:${A} "t")`,
      `[갑](CARD:${A})`, '[갑](card:1111)', ` [갑](card:${A})`, `[갑](card:${A}) `, `[갑](card:${A})[을](card:${B})`,
    ]) expect(cardLinkOf(raw), raw).toBeUndefined()
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
    // 삽입한 글 전체가 인정된 링크 하나다.
    expect(cardLinkOf(cardLinkMarkdown(A, '승상', '이름'))).toBe(A)
  })
})

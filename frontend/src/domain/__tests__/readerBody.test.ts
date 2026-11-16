import { describe, expect, it } from 'vitest'

import { seedWorks } from '../../data/mock/seed'
import { readerBody, splitSentences, type ReaderBlock, type Sentence } from '../entities/feedback'
import { imageMarker } from '../entities/media'
import { epsOf } from '../entities/work'

const A = '11111111-2222-3333-4444-555555555555'
/** 서버 작품의 문단: 본문을 빈 줄 둘(`\n\n`)로 나눈 덩어리(readingWork.ts와 같다). */
const paras = (body: string) => body.split('\n\n')
const read = (body: string) => readerBody(paras(body))
const texts = (body: string) => read(body).paragraphs.flat().map((s) => s.t)
/** 블록의 문장을 [사이, 글자…]로 줄여 본다. 굵게는 B{…}, 기울임은 I{…}, 둘 다는 BI{…}로 적는다. */
const shown = (block: ReaderBlock) => 'sentences' in block
  ? block.sentences.map((s) => [s.gap, ...s.parts.map((p) => (p.bold || p.italic ? `${p.bold ? 'B' : ''}${p.italic ? 'I' : ''}{${p.text}}` : p.text))])
  : block.kind
/** 서식을 들이기 전의 문장 나눔(feedback.ts의 옛 splitSentences 그대로). 서식 없는 글은 이 결과와 같아야 한다. */
const legacy = (list: string[]): Sentence[][] =>
  list.map((par, pi) => (par.match(/[^.!?”]+[.!?…]*”?|[^.!?]+$/g) ?? [par]).map((t) => ({ t: t.trim(), pi })).filter((s) => s.t))

describe('서식 없는 글의 문장 나눔은 전과 같다', () => {
  it('데모 작품의 모든 회차', () => {
    const episodes = seedWorks(0).flatMap((w) => epsOf(w))
    expect(episodes.length).toBeGreaterThan(10)
    for (const e of episodes) expect(splitSentences(e.p), e.t).toEqual(legacy(e.p))
  })

  it.each([
    '비가 그친 새벽, 도윤은 자전거를 멈췄다. 가방 맨 아래에 편지가 있었다.\n\n“이건 어디로 가야 하지.” 도윤이 중얼거렸다.',
    '첫 줄이다.\n둘째 줄이다. 셋째\n넷째 줄로 이어진다!\n\n다음 문단?',
    '가.\n\n\n나.\n\n\n\n다.\n\n\n\n\n라.',
    '\n가. 나.\n',
    '\n\n가.',
    '가.\n\n',
    '가.\n   \n나.\n\n \n\n다.',
    '...그리고 그는 떠났다.',
    '“안녕.”. 그는 웃었다.',
    '?!',
    '\n?!',
    '말했다.” ”끝',
    '1.5배 빠르다. 끝',
    '그는 말했다…… 그리고',
    '끝”',
    '첫째.둘째.',
    '“...뭐라고?”',
    '',
    '   ',
    '가\r\n나.\r\n\r\n다.',
    '목록처럼 보이는 줄\n- 하나.\n1. 둘.\n`코드`와 <b>태그</b>, 2 * 3 * 4, #태그, -- 줄표.',
    // 옛 규칙은 덩어리가 줄바꿈으로 시작하거나 끝나면(빈 줄 둘 뒤, 본문 맨 끝) 문장부호로 시작하는 문단을 다르게 나눴다. 그 모양도 그대로다.
    '가.\n\n\n...그리고 그는 떠났다.',
    '가.\n\n...그리고 그는 떠났다.',
    '\n!!나.',
    '가.\n\n?!\n',
    '?!\n',
    '......\n그는 말이 없었다.\n......',
  ])('%j', (body) => {
    expect(splitSentences(paras(body))).toEqual(legacy(paras(body)))
  })

  it('데모 작품처럼 문단 배열을 그대로 받아도 문단 번호는 배열의 순서다', () => {
    const list = ['첫 문단. 둘째 문장.', '', '셋째 문단이다.']
    expect(splitSentences(list)).toEqual(legacy(list))
    expect(splitSentences([])).toEqual([])
  })

  it('문장부호·따옴표·줄바꿈을 무작위로 섞은 글 5천 개', () => {
    // 서식 기호가 될 수 있는 글자(* \ # > - [)는 넣지 않는다. 같은 씨앗이라 늘 같은 글이다.
    const letters = ['가', '나', '다', ' ', ' ', '.', '!', '?', '”', '“', '…', '\n', '\n', ',', '1', 'a', String.fromCharCode(0x3000)]
    let seed = 12345
    const next = (n: number) => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % n }
    for (let i = 0; i < 5000; i++) {
      const body = Array.from({ length: 1 + next(24) }, () => letters[next(letters.length)]).join('')
      expect(splitSentences(paras(body)), JSON.stringify(body)).toEqual(legacy(paras(body)))
    }
  })
})

describe('서식이 있는 글의 문장', () => {
  it('보내는 글(t)은 기호를 포함한 원문 그대로의 조각이고 그리는 글에서는 기호가 빠진다', () => {
    const { paragraphs, blocks } = read('그는 *분명히* 말했다. **끝이었다.**')
    expect(paragraphs).toEqual([[{ t: '그는 *분명히* 말했다.', pi: 0 }, { t: '**끝이었다.**', pi: 0 }]])
    expect(blocks.map(shown)).toEqual([[['', '그는 ', 'I{분명히}', ' 말했다.'], [' ', 'B{끝이었다.}']]])
  })

  it('서식이 문장 경계를 넘으면 문장마다 굵게 보이고, 여는 기호는 뒤 문장·닫는 기호는 앞 문장의 조각에 든다', () => {
    const { paragraphs, blocks } = read('**첫 문장. 둘째 문장.**')
    expect(paragraphs.flat().map((s) => s.t)).toEqual(['**첫 문장.', '둘째 문장.**'])
    expect(blocks.map(shown)).toEqual([[['', 'B{첫 문장.}'], [' ', 'B{둘째 문장.}']]])
    // 문장 사이에서 닫히는 기호는 다음 문장으로 넘어가지 않는다.
    expect(texts('**첫.** 둘째. *셋째.*')).toEqual(['**첫.**', '둘째.', '*셋째.*'])
  })

  it('겹친 서식 안에서 문장이 갈려도 조각마다 굵게·기울임이 맞다', () => {
    const { paragraphs, blocks } = read('**굵게 *둘. 다* 굵게.**')
    expect(paragraphs.flat().map((s) => s.t)).toEqual(['**굵게 *둘.', '다* 굵게.**'])
    expect(blocks.map(shown)).toEqual([[['', 'B{굵게 }', 'BI{둘.}'], [' ', 'BI{다}', 'B{ 굵게.}']]])
  })

  it('기호만 남은 조각은 문장이 되지 않는다: 보이는 글이 없는 문장은 없다', () => {
    for (const body of ['**첫 문장. 둘째 문장.**', '***끝.***', '*가.* **나.**', '**가.**\n*나.*', '## **제목.**', '> ***인용.***']) {
      const { paragraphs, blocks } = read(body)
      const sentences = blocks.flatMap((b) => ('sentences' in b ? b.sentences : []))
      expect(sentences.length, body).toBe(paragraphs.flat().length)
      for (const s of sentences) expect(s.parts.map((p) => p.text).join('').trim(), body).not.toBe('')
      for (const s of paragraphs.flat()) expect(s.t, body).toMatch(/[^*\s]/)
    }
  })

  it('이스케이프한 별표는 글자로 보이고 보내는 글에는 백슬래시가 그대로 있다', () => {
    const { paragraphs, blocks } = read('별표 \\*글자\\* 끝. 다음.')
    expect(paragraphs.flat().map((s) => s.t)).toEqual(['별표 \\*글자\\* 끝.', '다음.'])
    expect(blocks.map(shown)).toEqual([[['', '별표 *글자* 끝.'], [' ', '다음.']]])
  })

  it('모든 문장의 보내는 글은 본문에 글자 그대로, 순서대로 있다', () => {
    const body = ['## 1장 **새벽**', '', '비가 *그친* 새벽이었다. **그는 돌아오지 않았다. 아무도 몰랐다.**', '둘째 줄\\*은 이어진다.', '', '> 그가 말했다. *정말로.*', '>', '> 둘째 줄', '---', imageMarker(A), '\\# 소제목 아님. 끝', '***', '마지막 *문장*'].join('\n')
    let from = 0
    for (const { t } of read(body).paragraphs.flat()) {
      const at = body.indexOf(t, from)
      expect(at, t).toBeGreaterThanOrEqual(from)
      from = at + t.length
    }
    expect(texts(body)).toEqual([
      '1장 **새벽**', '비가 *그친* 새벽이었다.', '**그는 돌아오지 않았다.', '아무도 몰랐다.**', '둘째 줄\\*은 이어진다.',
      '그가 말했다.', '*정말로.*', '둘째 줄', '# 소제목 아님.', '끝', '마지막 *문장*',
    ])
  })
})

describe('소제목·인용·구분선·이미지·빈 줄', () => {
  it('소제목과 인용의 글도 문장이고, 줄 맨 앞 기호(## · > · 문단 줄의 \\)는 보내는 글에 넣지 않는다', () => {
    const { paragraphs, blocks } = read('## 1장 새벽\n> 그가 말했다. 그리고 웃었다.\n\\# 소제목 아님')
    expect(paragraphs.flat().map((s) => s.t)).toEqual(['1장 새벽', '그가 말했다.', '그리고 웃었다.', '# 소제목 아님'])
    expect(blocks.map((b) => b.kind)).toEqual(['heading', 'quote', 'paragraph'])
    expect(blocks.map(shown)).toEqual([[['', '1장 새벽']], [['', '그가 말했다.'], [' ', '그리고 웃었다.']], [['', '# 소제목 아님']]])
  })

  it('인용은 줄마다 문장을 나눠 보내는 글에 다음 줄의 > 가 섞이지 않고, 줄바꿈은 사이로 남는다', () => {
    const { paragraphs, blocks } = read('> 첫 줄\n> 둘째 줄. 셋째\n>\n> 넷째')
    expect(paragraphs.flat().map((s) => s.t)).toEqual(['첫 줄', '둘째 줄.', '셋째', '넷째'])
    expect(blocks.map(shown)).toEqual([[['', '첫 줄'], ['\n', '둘째 줄.'], [' ', '셋째'], ['\n\n', '넷째']]])
  })

  it('문단은 전처럼 블록 전체에서 문장을 나눠 문장이 줄을 넘을 수 있고, 문단 안의 줄바꿈은 사이나 글자에 남는다', () => {
    const { paragraphs, blocks } = read('첫 줄\n둘째 줄. 셋째.\n넷째\n\\- 다섯째')
    expect(paragraphs.flat().map((s) => s.t)).toEqual(['첫 줄\n둘째 줄.', '셋째.', '넷째\n\\- 다섯째'])
    expect(blocks.map(shown)).toEqual([[['', '첫 줄\n둘째 줄.'], [' ', '셋째.'], ['\n', '넷째\n- 다섯째']]])
  })

  it('구분선·이미지·빈 줄은 문장이 아니라 순번에 들지 않는다', () => {
    const body = ['가.', '', '', '---', imageMarker(A), '', '나.', '***', '다.'].join('\n')
    const { paragraphs, blocks } = read(body)
    expect(blocks.map(shown)).toEqual([[['', '가.']], 'blank', 'rule', 'image', 'blank', [['', '나.']], 'rule', [['', '다.']]])
    expect(blocks.filter((b) => b.kind === 'blank').map((b) => b.count)).toEqual([2, 1])
    expect(blocks.find((b) => b.kind === 'image')).toEqual({ kind: 'image', id: A })
    expect(paragraphs.flat().map((s) => s.t)).toEqual(['가.', '나.', '다.'])
  })

  it('문단 번호는 서식과 상관없이 빈 줄 둘로 나눈 덩어리의 순서다', () => {
    const body = '## 제목\n\n> 인용.\n문단.\n\n\n**굵게.**\n\n\n\n끝.'
    expect(paras(body)).toEqual(['## 제목', '> 인용.\n문단.', '\n**굵게.**', '', '끝.'])
    expect(read(body).paragraphs).toEqual([[{ t: '제목', pi: 0 }], [{ t: '인용.', pi: 1 }, { t: '문단.', pi: 1 }], [{ t: '**굵게.**', pi: 2 }], [], [{ t: '끝.', pi: 4 }]])
  })

  it('일부러 만든 긴 줄로 채운 40,000자 본문도 예외 없이 읽는다(줄 안 서식의 길이 상한 2,000자)', () => {
    // 한 줄 40,000자: 상한을 넘어 글자 그대로다. 상한이 없으면 겹침이 만 단계가 되어 스택이 넘친다.
    const line = '*'.repeat(39999) + 'a'
    expect(read(line).paragraphs).toEqual([[{ t: line, pi: 0 }]])
    // 2,000자 줄 19개 + 1,981자 줄: 줄마다 굵게가 약 500겹이다. 문장부호가 없어 문단 전체가 한 문장이다.
    const body = [...Array<number>(19).fill(2000), 1981].map((n) => '*'.repeat(n - 1) + 'a').join('\n')
    const { paragraphs, blocks } = read(body)
    expect(body).toHaveLength(40000)
    expect(paragraphs).toEqual([[{ t: body, pi: 0 }]])
    // 줄마다 가장 안쪽에 짝 없이 남는 별표만 굵은 글자로 보인다(별표 1,999개는 3개, 1,980개는 4개가 남는다).
    const stars = [...Array<string>(19).fill('***'), '****']
    expect(blocks.map(shown)).toEqual([[['', ...stars.flatMap((left, i) => [`B{${left}}`, i < 19 ? 'a\n' : 'a'])]]])
  })

  it('문장의 순서는 그리는 블록의 순서와 같다', () => {
    const body = ['## 제목', '첫 문장. 둘째 문장.', '> 인용 문장.', '---', '끝 문장.'].join('\n')
    const { paragraphs, blocks } = read(body)
    const drawn = blocks.flatMap((b) => ('sentences' in b ? b.sentences : [])).map((s) => s.parts.map((p) => p.text).join(''))
    expect(drawn).toEqual(paragraphs.flat().map((s) => s.t))
  })
})

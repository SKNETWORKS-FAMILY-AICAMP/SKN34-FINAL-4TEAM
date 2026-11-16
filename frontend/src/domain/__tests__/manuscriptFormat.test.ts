import { describe, expect, it } from 'vitest'

import { imageMarker } from '../entities/media'
import { inlineParts, manuscriptBlocks, manuscriptLine, type InlinePart } from '../entities/manuscriptFormat'

const A = '11111111-2222-3333-4444-555555555555'
const UPPER = 'AAAAAAAA-2222-3333-4444-555555555555'
const WIDE_SPACE = String.fromCharCode(0x3000)
const KIND = { '문단 줄': 'paragraph', 소제목: 'heading', 인용: 'quote', 구분선: 'rule', 이미지: 'image' } as const

/**
 * 조각을 계약 검증 표의 표기(B{…} = 굵게, I{…} = 기울임)로 바꾼다. 더 넓게 감싼 쪽이 바깥이고 범위가 같으면 굵게가 바깥이다.
 * 조각은 굵게·기울임 여부만 갖고(그리는 데는 겹친 순서가 필요 없다) 표와 맞춰 보려고 여기서만 겹침을 되살린다.
 */
function show(parts: Pick<InlinePart, 'text' | 'bold' | 'italic'>[], inBold = false, inItalic = false): string {
  let out = ''
  for (let i = 0; i < parts.length;) {
    const run = (flag: 'bold' | 'italic') => { let j = i; while (j < parts.length && parts[j][flag]) j++; return j }
    const [bold, italic] = [inBold ? 0 : run('bold'), inItalic ? 0 : run('italic')]
    if (bold <= i && italic <= i) { out += parts[i++].text; continue }
    const end = Math.max(bold, italic)
    out += bold >= italic ? `B{${show(parts.slice(i, end), true, inItalic)}}` : `I{${show(parts.slice(i, end), inBold, true)}}`
    i = end
  }
  return out
}

/** 줄 하나를 표의 [종류, 내용]으로 읽는다. 이미지는 id, 구분선·빈 줄은 내용이 없다. */
function read(line: string): [kind: string, content?: string] {
  const parsed = manuscriptLine(line)
  if (parsed.kind === 'image') return [parsed.kind, parsed.id]
  if (parsed.kind === 'blank' || parsed.kind === 'rule') return [parsed.kind]
  return [parsed.kind, show(inlineParts(line.slice(parsed.at)))]
}

describe('원고 기본 서식 계약의 검증 표 (docs/design/manuscript-format-contract.md)', () => {
  // 표의 행을 순서대로 그대로 옮긴다. 서버(Kotlin)도 같은 표로 검증한다.
  const TABLE: [line: string, kind: keyof typeof KIND, content?: string][] = [
    ['비가 그친 새벽이었다.', '문단 줄', '비가 그친 새벽이었다.'],
    ['**그는 돌아오지 않았다.**', '문단 줄', 'B{그는 돌아오지 않았다.}'],
    ['그는 *분명히* 말했다.', '문단 줄', '그는 I{분명히} 말했다.'],
    ['***끝***', '문단 줄', 'B{I{끝}}'],
    ['**굵게 *둘 다* 굵게**', '문단 줄', 'B{굵게 I{둘 다} 굵게}'],
    ['2 * 3 * 4', '문단 줄', '2 * 3 * 4'],
    ['**짝 없음', '문단 줄', '**짝 없음'],
    ['별표 \\*글자\\*', '문단 줄', '별표 *글자*'],
    ['** 공백 **', '문단 줄', '** 공백 **'],
    ['## 1장 새벽', '소제목', '1장 새벽'],
    ['# **굵은** 제목', '소제목', 'B{굵은} 제목'],
    ['#태그', '문단 줄', '#태그'],
    ['## ', '문단 줄', '## '],
    ['\\# 소제목 아님', '문단 줄', '# 소제목 아님'],
    ['> 그가 말했다.', '인용', '그가 말했다.'],
    ['>붙여 쓴 인용', '인용', '붙여 쓴 인용'],
    ['>', '인용', ''],
    ['---', '구분선'],
    ['*****', '구분선'],
    ['--', '문단 줄', '--'],
    [' ---', '문단 줄', ' ---'],
    [imageMarker(A), '이미지', A],
    [`앞 ${imageMarker(A)}`, '문단 줄', `앞 ${imageMarker(A)}`],
    ['- 목록 아님', '문단 줄', '- 목록 아님'],
    ['1. 목록 아님', '문단 줄', '1. 목록 아님'],
    ['`코드 아님`', '문단 줄', '`코드 아님`'],
    ['<b>태그 아님</b>', '문단 줄', '<b>태그 아님</b>'],
    ['*a**b**c*', '문단 줄', 'I{aB{b}c}'],
    ['**a** **b**', '문단 줄', 'B{a} B{b}'],
    ['*기울임*과 **굵게**', '문단 줄', 'I{기울임}과 B{굵게}'],
    ['**a***', '문단 줄', 'B{a*}'],
    ['a*b*c', '문단 줄', 'aI{b}c'],
    ['끝에 별표*', '문단 줄', '끝에 별표*'],
    [`**${WIDE_SPACE}전각 공백**`, '문단 줄', `**${WIDE_SPACE}전각 공백**`],
    ['\\---', '문단 줄', '---'],
    ['> \\# 가', '인용', '\\# 가'],
    ['\\\\*가', '문단 줄', '\\*가'],
    [`**${'가'.repeat(1996)}**`, '문단 줄', `B{${'가'.repeat(1996)}}`],
    [`**${'가'.repeat(1997)}**`, '문단 줄', `**${'가'.repeat(1997)}**`],
    [imageMarker(UPPER), '이미지', UPPER],
    ['\\> 인용 아님', '문단 줄', '> 인용 아님'],
    ['***', '구분선'],
  ]

  for (const [line, kind, content] of TABLE) {
    // 길이 상한 행은 2,000자라 이름에는 앞뒤와 길이만 적는다.
    const name = line.length > 60 ? `${line.slice(0, 4)}…${line.slice(-4)} (${line.length}자)` : JSON.stringify(line)
    it(`${name} → ${kind}`, () => {
      expect(read(line)).toEqual(content === undefined ? [KIND[kind]] : [KIND[kind], content])
    })
  }

  it('표의 행 수는 계약 문서와 같다', () => {
    expect(TABLE).toHaveLength(42)
  })
})

describe('줄 판정', () => {
  it('길이 0인 줄만 빈 줄이고 공백만 있는 줄은 문단 줄이다', () => {
    expect(manuscriptLine('')).toEqual({ kind: 'blank' })
    for (const line of [' ', '\t', WIDE_SPACE, '\r']) expect(manuscriptLine(line), JSON.stringify(line)).toEqual({ kind: 'paragraph', at: 0 })
  })

  it('이미지는 줄 전체가 소문자 image 표식일 때뿐이고 식별자는 적힌 그대로 돌려준다', () => {
    expect(manuscriptLine(imageMarker(A.toUpperCase().replace(/[0-9]/g, 'A')))).toEqual({ kind: 'image', id: 'AAAAAAAA-AAAA-AAAA-AAAA-AAAAAAAAAAAA' })
    for (const line of [` ${imageMarker(A)}`, `${imageMarker(A)} `, imageMarker(A).toUpperCase(), '[[image:not-a-uuid]]', `${imageMarker(A)}${imageMarker(A)}`]) {
      expect(manuscriptLine(line), line).toEqual({ kind: 'paragraph', at: 0 })
    }
  })

  it('구분선은 같은 문자(- 또는 *) 3개 이상만 있는 줄이다', () => {
    for (const line of ['---', '----------', '***', '*******']) expect(manuscriptLine(line), line).toEqual({ kind: 'rule' })
    for (const line of ['- - -', '-*-', '--*', '___', '---x', '--- ', '===']) expect(manuscriptLine(line).kind, line).toBe('paragraph')
  })

  it('소제목은 # 1~6개와 공백 하나, 비어 있지 않은 글이고 내용은 그 공백 뒤부터다', () => {
    expect(manuscriptLine('# 가')).toEqual({ kind: 'heading', at: 2 })
    expect(manuscriptLine('###### 가')).toEqual({ kind: 'heading', at: 7 })
    expect(manuscriptLine('##  두 칸')).toEqual({ kind: 'heading', at: 3 })
    for (const line of ['####### 일곱', '#', '##', '#   ', `# ${WIDE_SPACE}`, ' # 앞 공백', '#\t탭']) expect(manuscriptLine(line).kind, JSON.stringify(line)).toBe('paragraph')
  })

  it('인용은 > 로 시작하는 줄이고 그 뒤의 공백 하나만 버린다', () => {
    expect(manuscriptLine('> 가')).toEqual({ kind: 'quote', at: 2 })
    expect(manuscriptLine('>가')).toEqual({ kind: 'quote', at: 1 })
    expect(manuscriptLine('>')).toEqual({ kind: 'quote', at: 1 })
    expect(manuscriptLine('> ')).toEqual({ kind: 'quote', at: 2 })
    expect(manuscriptLine('>  두 칸')).toEqual({ kind: 'quote', at: 2 })
    expect(manuscriptLine(' > 앞 공백')).toEqual({ kind: 'paragraph', at: 0 })
  })

  it('줄 맨 앞의 \\# \\> \\- 는 문단 줄로 두고 백슬래시를 내용에서 뺀다. 그 밖의 백슬래시는 내용이다', () => {
    for (const line of ['\\# 가', '\\> 가', '\\- 가', '\\---', '\\#']) expect(manuscriptLine(line), line).toEqual({ kind: 'paragraph', at: 1 })
    for (const line of ['\\* 가', '\\\\# 가', '\\가', '가 \\# 나']) expect(manuscriptLine(line), line).toEqual({ kind: 'paragraph', at: 0 })
    // 인용·소제목 안에서는 줄 맨 앞이 아니므로 백슬래시가 글자로 남는다.
    expect(read('> \\# 가')).toEqual(['quote', '\\# 가'])
  })

  it('줄 끝에 \\r이 남은 줄(CRLF)은 소제목·인용·구분선이 아니라 문단 줄이다', () => {
    for (const line of ['## 제목\r', '> 인용\r', '---\r']) expect(manuscriptLine(line), JSON.stringify(line)).toEqual({ kind: 'paragraph', at: 0 })
  })
})

describe('줄 안의 서식', () => {
  it('짝이 맞지 않거나 기호 안쪽 끝이 공백이면 글자 그대로다', () => {
    for (const text of ['*', '**', '****', '* 가*', '*가 *', '**가 **', '가 * 나 * 다', '*가', '가*', '가**']) expect(show(inlineParts(text)), text).toBe(text)
  })

  it('\\*는 별표 글자이고 여는·닫는 기호가 되지 않는다', () => {
    expect(show(inlineParts('\\*가\\*'))).toBe('*가*')
    expect(show(inlineParts('*가\\*나*'))).toBe('I{가*나}')
    expect(show(inlineParts('**가\\**'))).toBe('**가**')
    expect(show(inlineParts('\\**가**'))).toBe('**가**')
    // 백슬래시의 이스케이프는 없다: 앞 백슬래시는 글자이고 뒤 백슬래시만 별표와 짝이 된다.
    expect(show(inlineParts('\\\\*가'))).toBe('\\*가')
    expect(show(inlineParts('C:\\길\\이름'))).toBe('C:\\길\\이름')
  })

  it('왼쪽에서 먼저 시작하는 서식을 고르고 그 뒤쪽을 이어서 찾는다', () => {
    expect(show(inlineParts('*가* **나**'))).toBe('I{가} B{나}')
    expect(show(inlineParts('**가** *나*'))).toBe('B{가} I{나}')
    expect(show(inlineParts('***가* 나**'))).toBe('B{I{가} 나}')
    // 굵게가 먼저 0번 자리에서 맞아 `*가`를 감싸고, 남은 별표는 짝이 없어 글자다(표준 마크다운과 다르다).
    expect(show(inlineParts('***가** 나*'))).toBe('B{*가} 나*')
  })

  it('조각마다 굵게·기울임 여부와 원문에서 차지하는 자리를 갖고, 감싼 기호는 안쪽 양 끝 조각의 자리에 든다', () => {
    expect(inlineParts('그는 *분명히* 말했다.')).toEqual([
      { text: '그는 ', bold: false, italic: false, start: 0, at: 0, end: 3 },
      { text: '분명히', bold: false, italic: true, start: 3, at: 4, end: 8 },
      { text: ' 말했다.', bold: false, italic: false, start: 8, at: 8, end: 13 },
    ])
    expect(inlineParts('**굵게 *둘 다* 굵게**')).toEqual([
      { text: '굵게 ', bold: true, italic: false, start: 0, at: 2, end: 5 },
      { text: '둘 다', bold: true, italic: true, start: 5, at: 6, end: 10 },
      { text: ' 굵게', bold: true, italic: false, start: 10, at: 10, end: 15 },
    ])
    // 겹친 기호가 한 조각에 모두 붙는다.
    expect(inlineParts('***끝***')).toEqual([{ text: '끝', bold: true, italic: true, start: 0, at: 3, end: 7 }])
  })

  it('이스케이프 백슬래시는 그 별표로 시작하는 조각의 자리에 들고 글자에서는 빠진다', () => {
    expect(inlineParts('별표 \\*글자\\*')).toEqual([
      { text: '별표 ', bold: false, italic: false, start: 0, at: 0, end: 3 },
      { text: '*글자', bold: false, italic: false, start: 3, at: 4, end: 7 },
      { text: '*', bold: false, italic: false, start: 7, at: 8, end: 9 },
    ])
  })

  it('조각의 자리를 이으면 줄 내용 전체이고 글자는 at부터 원문 그대로다', () => {
    const lines = ['', '가', '**가** *나* 다', '***끝***', '*a**b**c*', '**a***', '별표 \\*글자\\*', '**\\*가\\***', '2 * 3 * 4', '*가 **나', '\\\\*가*나*']
    for (const line of lines) {
      const parts = inlineParts(line, 7)
      expect(parts.map((p) => line.slice(p.start - 7, p.end - 7)).join(''), line).toBe(line)
      for (const p of parts) {
        expect(line.slice(p.at - 7, p.at - 7 + p.text.length), line).toBe(p.text)
        expect(p.start <= p.at && p.at + p.text.length <= p.end && p.text.length > 0, line).toBe(true)
      }
    }
  })
})

describe('줄 안 서식의 길이 상한(2,000자)', () => {
  const plain = (content: string, offset = 0) => [{ text: content, bold: false, italic: false, start: offset, at: offset, end: offset + content.length }]

  it('내용이 2,000자를 넘으면 굵게·기울임·\\* 를 해석하지 않고 내용 그대로 조각 하나로 돌려준다', () => {
    const tail = ' *기울임* **굵게** \\*별표\\*'
    const within = '가'.repeat(2000 - tail.length) + tail
    expect(within).toHaveLength(2000)
    expect(show(inlineParts(within))).toBe(`${'가'.repeat(2000 - tail.length)} I{기울임} B{굵게} *별표*`)
    expect(inlineParts(`가${within}`, 5)).toEqual(plain(`가${within}`, 5))
  })

  it('길이는 줄 종류 기호(## · > · 문단 줄 맨 앞의 \\)를 뗀 내용으로 세고 줄 종류 판정은 그대로다', () => {
    // 문단 줄은 `\#`로 시작해야 백슬래시가 줄 종류 기호이므로 내용이 #으로 시작한다.
    for (const [prefix, lead, kind] of [['## ', '', 'heading'], ['> ', '', 'quote'], ['\\', '#', 'paragraph']] as const) {
      const content = (length: number) => `${lead}**${'가'.repeat(length - lead.length - 4)}**`
      const [within, over] = [manuscriptBlocks(prefix + content(2000))[0], manuscriptBlocks(prefix + content(2001))[0]]
      expect([within.kind, over.kind], kind).toEqual([kind, kind])
      expect('lines' in within && show(within.lines[0]), kind).toBe(`${lead}B{${'가'.repeat(1996 - lead.length)}}`)
      expect('lines' in over && over.lines[0], kind).toEqual(plain(content(2001), prefix.length))
    }
  })

  it('길이는 UTF-16 단위로 센다: 이모지 한 글자는 2다', () => {
    expect(show(inlineParts(`*가*${'😀'.repeat(998)}a`))).toBe(`I{가}${'😀'.repeat(998)}a`)
    expect(show(inlineParts(`*가*${'😀'.repeat(999)}`))).toBe(`*가*${'😀'.repeat(999)}`)
  })

  // 상한이 없으면 아래 두 줄은 겹침이 수천 단계가 되어 RangeError(Maximum call stack size exceeded)로 화면이 죽는다.
  it('일부러 만든 4만 자 한 줄은 예외 없이 글자 그대로다', () => {
    for (const line of ['*'.repeat(39999) + 'a', '**가 '.repeat(5000) + '*'.repeat(10000)]) expect(inlineParts(line)).toEqual(plain(line))
  })

  it('상한을 꽉 채운 2,000자 줄 20개(줄바꿈까지 본문 40,000자)도 예외 없이 풀고 조각을 이으면 원문 그대로다', () => {
    // 2,000자 줄 19개와 1,981자 줄 하나: 줄바꿈 19개를 더해 원고 한도 40,000자다.
    const fill = (line: (length: number) => string) => [...Array<number>(19).fill(2000), 1981].map(line).join('\n')
    const bodies = [
      fill((n) => '*a '.repeat(n).slice(0, n)), // 닫히지 않는 기울임 기호: 정규식이 가장 오래 걸린다
      fill((n) => '**가 '.repeat(n).slice(0, n)), // 닫히지 않는 굵게 기호
      fill((n) => '*'.repeat(n - 1) + 'a'), // 별표만(끝의 a 때문에 구분선이 아니다): 겹침이 가장 깊다(줄마다 약 500단계)
    ]
    for (const body of bodies) {
      expect(body).toHaveLength(40000)
      const blocks = manuscriptBlocks(body)
      expect(blocks.map((block) => block.kind)).toEqual(['paragraph'])
      const [block] = blocks
      expect('lines' in block && block.lines.map((parts) => body.slice(parts[0].start, parts.at(-1)!.end)).join('\n')).toBe(body)
    }
  })
})

describe('블록 묶기', () => {
  const texts = (lines: InlinePart[][]) => lines.map((parts) => show(parts))

  it('이어진 문단 줄·인용 줄을 한 블록으로 묶고 소제목·구분선·이미지는 한 줄이 한 블록이다', () => {
    const body = ['첫 줄', '둘째 줄', '', '', '## 제목', '# 또 제목', '> 인용 1', '>', '> 인용 2', '---', imageMarker(A), '**끝**'].join('\n')
    const blocks = manuscriptBlocks(body)
    expect(blocks.map((b) => b.kind)).toEqual(['paragraph', 'blank', 'heading', 'heading', 'quote', 'rule', 'image', 'paragraph'])
    expect(blocks.map((b) => ('lines' in b ? texts(b.lines) : b.kind === 'blank' ? b.count : b.kind === 'image' ? b.id : null))).toEqual([
      ['첫 줄', '둘째 줄'], 2, ['제목'], ['또 제목'], ['인용 1', '', '인용 2'], null, A, ['B{끝}'],
    ])
  })

  it('빈 줄은 이어진 개수를 세고 본문 맨 앞·맨 끝의 빈 줄도 블록이다', () => {
    expect(manuscriptBlocks('')).toEqual([{ kind: 'blank', count: 1 }])
    expect(manuscriptBlocks('\n\n가\n').map((b) => (b.kind === 'blank' ? b.count : b.kind))).toEqual([2, 'paragraph', 1])
  })

  it('서식은 한 줄 안에서만 닫힌다: 줄을 넘는 기호는 글자 그대로다', () => {
    const [block] = manuscriptBlocks('**굵게\n계속**')
    expect('lines' in block && texts(block.lines)).toEqual(['**굵게', '계속**'])
  })

  it('블록과 조각의 자리는 본문 전체 기준이다', () => {
    const body = ['가', '', '> *인용*', '\\# 글', '## **제목**'].join('\n')
    const blocks = manuscriptBlocks(body).filter((b) => 'lines' in b)
    expect(blocks.map((b) => body.slice(b.start).split('\n')[0])).toEqual(['가', '> *인용*', '\\# 글', '## **제목**'])
    for (const block of blocks) for (const part of block.lines.flat()) expect(body.slice(part.at, part.at + part.text.length)).toBe(part.text)
    // 줄 맨 앞 기호(> · \ · ##)는 어느 조각의 자리에도 들지 않는다.
    expect(blocks.map((b) => body.slice(b.lines[0][0].start, b.lines[0].at(-1)!.end))).toEqual(['가', '*인용*', '# 글', '**제목**'])
  })
})

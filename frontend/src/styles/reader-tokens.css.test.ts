import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const css = readFileSync(new URL('./storyfork.css', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
const readerSource = readFileSync(new URL('../presentation/features/reading/viewmodel/useReaderViewModel.ts', import.meta.url), 'utf8')

type Vars = Record<string, string>
type Rgba = [number, number, number, number]

/** 선택자가 그대로 일치하는 규칙들의 선언을 { 속성: 값 }으로 합쳐 돌려준다(뒤 규칙이 이긴다). */
const rule = (selector: string): Vars => {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const bodies = [...css.matchAll(new RegExp(`(?:^|\\})\\s*${escaped}\\{([^}]*)\\}`, 'g'))].map((m) => m[1])
  return Object.fromEntries(bodies.flatMap((body) => body.split(';')).filter((d) => d.includes(':')).map((d) => [d.slice(0, d.indexOf(':')).trim(), d.slice(d.indexOf(':') + 1).trim()]))
}

/** 괄호 밖 쉼표로 나눈다: `in srgb,rgba(1,2,3,.5) 12%,transparent` → 3조각. */
const split = (text: string) => {
  const parts: string[] = []
  let depth = 0
  let from = 0
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '(') depth++
    else if (text[i] === ')') depth--
    else if (text[i] === ',' && !depth) { parts.push(text.slice(from, i)); from = i + 1 }
  }
  return [...parts, text.slice(from)].map((part) => part.trim())
}

/** #hex · rgb(a)() · transparent · color-mix(in srgb, A p%, B)를 [r, g, b, a]로 계산한다(color-mix는 알파 선곱). */
const color = (value: string): Rgba => {
  const v = value.trim()
  if (v === 'transparent') return [0, 0, 0, 0]
  if (/^#[0-9a-f]{3}$/i.test(v)) return color(`#${[...v.slice(1)].map((c) => c + c).join('')}`)
  if (/^#[0-9a-f]{6}$/i.test(v)) return [parseInt(v.slice(1, 3), 16), parseInt(v.slice(3, 5), 16), parseInt(v.slice(5, 7), 16), 1]
  const fn = v.match(/^(rgba?|color-mix)\(([\s\S]*)\)$/)
  if (fn?.[1] === 'color-mix') {
    const [, first, second] = split(fn[2])
    const w = Number(first.match(/\s([\d.]+)%$/)?.[1]) / 100
    const [a, b] = [color(first.replace(/\s[\d.]+%$/, '')), color(second)]
    const alpha = w * a[3] + (1 - w) * b[3]
    const channel = (i: number) => (alpha ? (w * a[i] * a[3] + (1 - w) * b[i] * b[3]) / alpha : 0)
    return [channel(0), channel(1), channel(2), alpha]
  }
  if (fn) { const p = split(fn[2]).map(Number); return [p[0], p[1], p[2], p[3] ?? 1] }
  throw new Error(`읽을 수 없는 색: ${value}`)
}
const over = (fg: Rgba, bg: Rgba): Rgba => [fg[0] * fg[3] + bg[0] * (1 - fg[3]), fg[1] * fg[3] + bg[1] * (1 - fg[3]), fg[2] * fg[3] + bg[2] * (1 - fg[3]), 1]
const luminance = (c: Rgba) => {
  const [r, g, b] = [c[0], c[1], c[2]].map((v) => v / 255).map((x) => (x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4))
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}
const contrast = (a: Rgba, b: Rgba) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

const root = rule(':root')
/**
 * 독서 화면 요소 하나의 색을 푼다. own(그 요소에 걸린 선언)에 있는 토큰은 그 자리에서, 없는 토큰은 :root에서 계산된 값을 물려받는다(CSS 사용자 속성과 같다).
 * 순환 참조는 CSS에서 토큰을 통째로 무효로 만들므로 여기서는 던진다.
 */
const tokensOf = (dark: boolean, own: Vars) => {
  const read = (name: string, onReader: boolean, depth = 0): string => {
    if (depth > 20) throw new Error(`순환 참조: ${name}`)
    const here = onReader && name in own
    const raw = here ? own[name] : root[name]
    if (raw === undefined) throw new Error(`정의되지 않은 토큰: ${name}`)
    return raw
      .replace(/var\(--l,\s*([^()]+)\)\s+var\(--d,\s*([^()]+)\)/g, (_, light: string, night: string) => (dark ? night : light))
      .replace(/var\((--[\w-]+)\)/g, (_, ref: string) => read(ref, here, depth + 1))
  }
  return (name: string) => color(read(name, true))
}

const remap = rule('.reader')
const calm = { ...rule('.calm'), ...rule('.calm.rd') }
/** 보기 설정 '흰색'·'야간'이 독서 화면에 인라인으로 주는 --t* 값(useReaderViewModel의 LOOK_VARS). */
const inlineLooks = [...readerSource.matchAll(/\{[^{}]*'--tbg'[^{}]*\}/g)].map((m) => Object.fromEntries([...m[0].matchAll(/'(--[\w-]+)':\s*'([^']+)'/g)].map((e) => [e[1], e[2]])) as Vars)
const world = (theme: string, dark: boolean): Vars => ({ ...rule(`.th-${theme}`), ...(dark ? {} : rule(`.th-${theme}.themed.lite`)) })

/** 보기 설정 5종(자동은 라이트에서 소설 분위기, 다크에서 아이보리라 따로 두지 않는다)과 앱 테마의 모든 조합. */
type Case = [name: string, token: (name: string) => Rgba]
const looksOf = (dark: boolean): [string, Vars][] => [
  ['아이보리', calm],
  ...['hanji', 'star', 'neon'].map((theme): [string, Vars] => [`소설 분위기(${theme})`, world(theme, dark)]),
  ...inlineLooks.map((look): [string, Vars] => [`인라인 보기 ${look['--tbg']}`, { ...calm, ...look }]),
]
const cases = [false, true].flatMap((dark) => looksOf(dark).map(([name, own]): Case => [`${name} · 앱 ${dark ? '다크' : '라이트'}`, tokensOf(dark, { ...own, ...remap })]))

describe('storyfork.css 읽기 토큰 계약', () => {
  it(':root에 --t* 기본값을 두고 .calm은 그 값을 다시 선언하지 않는다 — .calm 밖과 body로 포털된 시트에서도 값이 있고, 독서 화면의 재연결과 순환하지 않는다', () => {
    const defaults = { '--tbg': '--bg', '--tfg': '--ink', '--tsub': '--sub', '--tacc': '--pri', '--tline': '--line', '--tcard': '--surface', '--tbtn': '--pri', '--tbtnfg': '--on-pri' }
    for (const [token, source] of Object.entries(defaults)) {
      expect(root[token], token).toBe(`var(${source})`)
      expect(rule('.calm')[token], `.calm ${token}`).toBeUndefined()
    }
    // 본문 서체는 읽기 면에서만 정한다(밖에서는 UI 서체 그대로).
    expect(root['--tfont']).toBeUndefined()
    expect(rule('.calm')['--tfont']).toBe('var(--story)')
  })

  it('독서 화면(.reader)은 전역 표면·글자·경계·primary 토큰을 읽기 토큰에 다시 연결한다', () => {
    expect(inlineLooks.length, 'useReaderViewModel의 보기 설정 색(LOOK_VARS)을 찾지 못했다').toBeGreaterThanOrEqual(2)
    expect(remap).toMatchObject({ '--surface': 'var(--tcard)', '--ink': 'var(--tfg)', '--line': 'var(--tline)', '--line2': 'var(--tline)', '--pri': 'var(--tbtn)', '--on-pri': 'var(--tbtnfg)' })
    for (const token of ['--ink2', '--sub', '--faint', '--muted-bg', '--pri-d', '--pri-soft', '--pri-ink', '--line3']) expect(remap[token], token).toBeDefined()
    // 테마 토큰 정의는 :root 한 곳뿐이다(index-html.test.js): 페이지 배경 토큰은 다시 선언하지 않는다.
    expect(remap['--bg']).toBeUndefined()
  })

  it('.btn은 글자색을 직접 정해 놓인 면의 글자색을 물려받지 않는다', () => {
    expect(rule('.btn').color).toBe('var(--ink)')
  })

  it.each(cases)('%s: 전역 부품이 읽기 면 위에서 읽힌다', (_name, token) => {
    const page = token('--tbg')
    const card = over(token('--tcard'), page)
    const button = over(token('--surface'), card)
    const muted = over(token('--muted-bg'), card)
    const text = {
      '.btn 글자': contrast(over(token('--ink'), button), button),
      '.btn.pri 글자': contrast(over(token('--on-pri'), card), over(token('--pri'), card)),
      '.btn.pri:hover 글자': contrast(over(token('--on-pri'), card), over(token('--pri-d'), card)),
      '.muted(카드)': contrast(over(token('--sub'), card), card),
      '작가의 말(.muted, 본문 배경)': contrast(over(token('--sub'), page), page),
      '.demo(--faint)': contrast(over(token('--faint'), page), page),
      '.sortt·.chip 글자(--muted-bg 위)': contrast(over(token('--sub'), muted), muted),
      '.chip.ok': contrast(over(token('--pri-ink'), over(token('--pri-soft'), card)), over(token('--pri-soft'), card)),
      '댓글 좋아요 켬(--pri 글자)': contrast(over(token('--pri'), card), card),
    }
    for (const [what, ratio] of Object.entries(text)) expect(ratio, what).toBeGreaterThanOrEqual(4.5)
    const nonText = {
      '초점 고리(본문 배경)': contrast(over(token('--pri'), page), page),
      '초점 고리(카드)': contrast(over(token('--pri'), card), card),
      '입력 경계(--line3)': contrast(over(token('--line3'), card), card),
      '선택 테두리(--line3, 트랙)': contrast(over(token('--line3'), muted), muted),
    }
    for (const [what, ratio] of Object.entries(nonText)) expect(ratio, what).toBeGreaterThanOrEqual(3)
  })
})

describe('storyfork.css 분위기 테마 강조색', () => {
  it.each(['.th-hanji', '.th-star', '.th-neon', '.th-star.themed.lite', '.th-neon.themed.lite'])('%s의 --tacc 글자는 자기 배경에서 4.5:1 이상이다', (selector) => {
    const base = rule(selector.split('.themed')[0])
    const own = { ...base, ...rule(selector) }
    expect(contrast(color(own['--tacc']), color(own['--tbg'])), selector).toBeGreaterThanOrEqual(4.5)
  })

  it('라이트 분위기 테마는 배경 그라데이션의 가장 어두운 끝에서도 강조·보조 글자가 4.5:1 이상이다', () => {
    for (const selector of ['.th-star.themed.lite', '.th-neon.themed.lite']) {
      const own = rule(selector)
      // 토큰이 같은 규칙의 다른 토큰을 가리킬 수 있으므로(네온 --tsub는 옛 값을 --tfg 쪽으로 섞는다) 그 규칙 안에서 풀어 계산한다.
      const token = tokensOf(false, own)
      const top = color(own.background.match(/linear-gradient\(180deg,\s*(#[0-9A-Fa-f]{6})/)![1])
      for (const name of ['--tacc', '--tsub']) expect(contrast(token(name), top), `${selector} ${name}`).toBeGreaterThanOrEqual(4.5)
    }
  })
})

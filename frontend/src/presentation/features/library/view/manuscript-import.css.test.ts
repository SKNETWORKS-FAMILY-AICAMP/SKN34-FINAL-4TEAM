import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

// jsdom은 CSS를 적용하지 않아 렌더 테스트로는 대비·터치 크기를 볼 수 없다. 규칙을 글자로 확인한다.
const css = readFileSync(new URL('./manuscript-import.css', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
const rule = (selector: string, source = css) => source.match(new RegExp(`(?:^|\\})\\s*${selector.replace(/[.[\]]/g, '\\$&')}\\s*\\{([^}]*)\\}`))?.[1] ?? ''
const touch = css.match(/@media \(max-width: 600px\), \(pointer: coarse\) \{([\s\S]*)\}\s*$/)?.[1] ?? ''

describe('원고 가져오기 화면 스타일', () => {
  it('제외한 회차 카드는 글자를 흐리게 하지 않고 옅은 면과 점선 테두리로 구분한다', () => {
    const excluded = rule('.mi-episode.is-excluded')
    // opacity로 흐리면 안의 보조 글자(--sub)가 4.5:1 아래로 떨어진다.
    expect(excluded).not.toMatch(/opacity/)
    expect(excluded).toMatch(/background:\s*var\(--muted-bg\)/)
    expect(excluded).toMatch(/border-style:\s*dashed/)
    expect(excluded).toMatch(/border-color:\s*var\(--line3/)
    // 옅은 면 위에서 '제외됨' 칩의 모양이 묻히지 않게 칩은 표면색이다.
    expect(rule('.mi-episode.is-excluded .chip')).toMatch(/background:\s*var\(--surface\)/)
  })

  it('좁은 화면과 터치 기기에서 체크 줄은 44px, 체크박스는 24px이다', () => {
    expect(rule('.mi-check', touch)).toMatch(/min-height:\s*44px/)
    const box = rule('.mi-check input', touch)
    expect(box).toMatch(/width:\s*24px/)
    expect(box).toMatch(/height:\s*24px/)
  })

  it('평평한 목록(.mi-episode의 border: 0)에서도 제외한 회차는 점선 테두리 두께를 되살린다', () => {
    // 두께가 0이면 점선·색만으로는 테두리가 보이지 않는다.
    expect(rule('.mi-episode.is-excluded')).toMatch(/border-width:\s*1px/)
  })

  it('미리보기·등록 실패 사유(p[role=alert])는 위험색 굵은 글씨로 본문과 구분한다', () => {
    // 저장하지 못한 회차 묶음(section.mi-failed)도 role=alert지만 제목만 빨갛게 두므로 문단으로 한정한다.
    const alert = rule('.manuscript-import p[role="alert"]')
    expect(alert).toMatch(/color:\s*var\(--danger\)/)
    expect(alert).toMatch(/font-weight:\s*700/)
  })
})

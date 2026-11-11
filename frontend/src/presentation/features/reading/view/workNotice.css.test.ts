import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const css = readFileSync(new URL('../../../../styles/storyfork.css', import.meta.url), 'utf8')
const rule = (selector: string) => css.match(new RegExp(`${selector.replace(/[.[\]]/g, '\\$&')}\\{([^}]*)\\}`))?.[1] ?? ''

describe('작품 소식 본문 표시', () => {
  // jsdom은 CSS를 적용하지 않아 렌더 테스트로는 입력한 줄바꿈이 화면에서 줄바꿈으로 보이는지 알 수 없다.
  it('본문은 입력한 줄바꿈·빈 줄을 그대로 보이고 긴 줄만 감싼다(white-space: pre-wrap)', () => {
    expect(rule('.wn-body')).toMatch(/white-space:\s*pre-wrap/)
  })
})

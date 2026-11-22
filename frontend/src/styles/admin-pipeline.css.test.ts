import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const css = readFileSync(new URL('./admin-pipeline.css', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
const view = readFileSync(new URL('../presentation/features/admin/view/AdminPipeline.tsx', import.meta.url), 'utf8')
/** 선언 블록 하나씩(중첩 @media 안의 규칙도 포함). */
const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(([, selector, body]) => ({ selectors: selector.split(',').map((s) => s.trim()), body }))
const of = (className: string) => rules.filter((rule) => rule.selectors.some((s) => s.includes(className)))
const values = (className: string, prop: string) => of(className).flatMap((rule) => [...rule.body.matchAll(new RegExp(`(?:^|;)\\s*${prop}\\s*:\\s*([^;]*)`, 'g'))].map((m) => m[1].trim()))

describe('admin-pipeline.css 레이아웃 계약(DEC-58 실화면 확인: 노드 기록이 오른쪽 반쪽 폭에서 넘쳤다)', () => {
  it('노드 기록은 캔버스 옆이 아니라 아래에 쌓이므로 화면 폭과 무관하게 한 칸(minmax(0, 1fr))이고 옆 칸·옆 선이 없다', () => {
    expect(values('.pipe-body', 'grid-template-columns')).toEqual(['minmax(0, 1fr)'])
    expect(values('.pipe-records', 'border-left')).toEqual([])
    expect(css).not.toContain('with-records')
  })

  it('캔버스 쪽과 기록 쪽은 min-width 0이라 넓은 표가 칸을 넘겨 페이지 전체를 가로로 늘리지 못하고, 표는 자기 영역 안에서만 스크롤된다', () => {
    expect(values('.pipe-diagram', 'min-width')).toEqual(['0'])
    expect(values('.pipe-records', 'min-width')).toEqual(['0'])
  })

  it('화면은 선택 여부로 배치 클래스를 바꾸지 않고, 캔버스 쪽 다음에 기록 쪽을 그린다', () => {
    expect(view).not.toContain('with-records')
    expect(view).toContain('className="pipe-body"')
    expect(view.indexOf('className="pipe-diagram"')).toBeGreaterThan(-1)
    expect(view.indexOf('<NodeRecords')).toBeGreaterThan(view.indexOf('className="pipe-diagram"'))
  })
})

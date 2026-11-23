import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

// 개요(data 탭)의 배치는 렌더 테스트(CI 전용)가 DOM으로 지키고, 여기서는 로컬 단위 범위에서 소스의 순서·연결만 고정한다(AdminPage.test의 정적 소스 계약과 같은 방식).
const read = (name: string) => readFileSync(new URL(name, import.meta.url), 'utf8')
const dashboard = read('./OperationsDashboard.tsx')
const metrics = read('./ServiceMetrics.tsx')
const charts = read('./AdminCharts.tsx')
const css = read('./admin-operations.css')

describe('관리 개요 배치 계약', () => {
  it('작은 요약 카드가 맨 위이고 그 아래에 서비스 지표 그래프, 최근 7일 AI 사용 그래프가 온다', () => {
    const order = ['className="admin-summary"', '<ServiceMetrics', '<WeeklyUsage'].map((part) => dashboard.indexOf(part))
    expect(order.every((at) => at > 0)).toBe(true)
    expect(order).toEqual([...order].sort((a, b) => a - b))
  })

  it('요약 띠는 8장이 마지막 줄 없이 나뉘도록 2열, 넓은 화면은 4열이다(auto-fit이면 1440px에서 5열이 되어 5+3으로 갈린다)', () => {
    const summary = css.match(/\.adm \.admin-summary \{[^}]*\}/)![0]
    expect(summary).toMatch(/grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/)
    expect(summary).not.toMatch(/auto-fit/)
    expect(css).toMatch(/@media \(min-width: 1100px\) \{ \.adm \.admin-summary \{ grid-template-columns: repeat\(4, minmax\(0, 1fr\)\); \} \}/)
  })

  it('카드의 바로 가기 링크는 이름에 카드 이름을 넣어 같은 글자의 링크 넷을 구분한다', () => {
    expect(dashboard).toMatch(/<Go to=\{card\.to\} aria-label=\{`\$\{card\.label\} 바로 가기`\}>바로 가기<\/Go>/)
  })

  it('서비스 지표의 비율 목록은 차트 아래가 아니라 캡션과 그림 사이(차트의 lead 자리)에 둔다', () => {
    const frame = charts.slice(charts.indexOf('function ChartFrame'), charts.indexOf('/** 날짜별 요청 수'))
    const order = ['<figcaption>', '{lead}', 'role="img"'].map((part) => frame.indexOf(part))
    expect(order.every((at) => at > 0)).toBe(true)
    expect(order).toEqual([...order].sort((a, b) => a - b))
    for (const chart of ['FunnelChart', 'ReactionsChart']) expect(metrics, chart).toMatch(new RegExp(`<${chart} [^>]*lead=\\{`))
  })
})

import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

// 대시보드(data 탭)와 에이전트 지표(LLM Ops 첫 쪽)의 배치는 렌더 테스트(CI 전용)가 DOM으로 지키고, 여기서는 로컬 단위 범위에서 소스의 순서·연결만 고정한다(AdminPage.test의 정적 소스 계약과 같은 방식).
const read = (name: string) => readFileSync(new URL(name, import.meta.url), 'utf8')
const dashboard = read('./OperationsDashboard.tsx')
const agents = read('./AgentMetrics.tsx')
const panels = read('./OperationsPanels.tsx')
const metrics = read('./ServiceMetrics.tsx')
const charts = read('./AdminCharts.tsx')
const css = read('./admin-operations.css')

describe('대시보드·에이전트 지표 배치 계약', () => {
  it('대시보드는 요약 카드(서비스 지표) 띠가 맨 위이고 그 아래에 서비스 지표 그래프가 오며, AI 사용 그래프는 없다', () => {
    const order = ['<SummaryBand cards={serviceCards(data)}', '<ServiceMetrics'].map((part) => dashboard.indexOf(part))
    expect(order.every((at) => at > 0)).toBe(true)
    expect(order).toEqual([...order].sort((a, b) => a - b))
    expect(dashboard).not.toMatch(/WeeklyUsage|aiCards/)
  })

  it('에이전트 지표는 AI 요청·경고 요약 카드 → 최근 7일 AI 사용 그래프 → 에이전트별 지표(카드·표) 순이다', () => {
    const order = ['<AiOverview', '<WeeklyUsage', '<Metrics'].map((part) => agents.indexOf(part))
    expect(order.every((at) => at > 0)).toBe(true)
    expect(order).toEqual([...order].sort((a, b) => a - b))
    expect(agents).toMatch(/<SummaryBand cards=\{aiCards\(data\)\}/)
  })

  it('요약 띠는 카드 넷이 마지막 줄 없이 나뉘도록 2열, 넓은 화면은 4열이다(auto-fit이면 1440px에서 5열이 되어 갈린다)', () => {
    const summary = css.match(/\.adm \.admin-summary \{[^}]*\}/)![0]
    expect(summary).toMatch(/grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/)
    expect(summary).not.toMatch(/auto-fit/)
    expect(css).toMatch(/@media \(min-width: 1100px\) \{ \.adm \.admin-summary \{ grid-template-columns: repeat\(4, minmax\(0, 1fr\)\); \} \}/)
  })

  it('카드의 바로 가기 링크는 이름에 카드 이름을 넣어 같은 글자의 링크 넷을 구분한다', () => {
    expect(panels).toMatch(/<Go to=\{card\.to\} aria-label=\{`\$\{card\.label\} 바로 가기`\}>바로 가기<\/Go>/)
  })

  it('서비스 지표의 비율 목록은 차트 아래가 아니라 캡션과 그림 사이(차트의 lead 자리)에 둔다', () => {
    const frame = charts.slice(charts.indexOf('function ChartFrame'), charts.indexOf('/** 날짜별 요청 수'))
    const order = ['<figcaption>', '{lead}', 'role="img"'].map((part) => frame.indexOf(part))
    expect(order.every((at) => at > 0)).toBe(true)
    expect(order).toEqual([...order].sort((a, b) => a - b))
    for (const chart of ['FunnelChart', 'ReactionsChart']) expect(metrics, chart).toMatch(new RegExp(`<${chart} [^>]*lead=\\{`))
  })
})

describe('서비스 지표 차트의 눈금·숫자 자리 (#803)', () => {
  const from = (name: string) => charts.slice(charts.indexOf(`export function ${name}`))
  const funnelBar = /<Bar [^>]*>/.exec(from('FunnelChart'))?.[0] ?? ''

  // 눈금 글자의 오른쪽 끝은 축 폭 − 8(Recharts tickSize 6 + tickMargin 2)이다. 12px에서 '0.0105'는 숫자 5개(≤ 7.4px)+점(≤ 3.6px) ≈ 41px라 폭 40(자리 32px)에서는 앞의 0이 잘려 '.0105'였다.
  it('회차당 반응 축은 소수 눈금(0.0105)이 들어가는 폭이다', () => {
    const width = Number(/<YAxis[^>]*\swidth=\{(\d+)\}/.exec(from('ReactionsChart'))?.[1])
    expect(width - 8).toBeGreaterThanOrEqual(5 * 7.4 + 3.6)
  })

  // Recharts는 폭 0 막대와 그 막대에서 만드는 숫자(LabelList)를 그리지 않고, 숫자는 막대 애니메이션이 끝나야 보인다(showLabels = !isAnimating).
  it('단계 막대는 값 0인 단계도 숫자를 남기고 애니메이션을 기다리지 않는다', () => {
    expect(Number(/minPointSize=\{(\d+)\}/.exec(funnelBar)?.[1])).toBeGreaterThan(0)
    expect(funnelBar).toContain('isAnimationActive={false}')
  })
})

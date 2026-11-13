import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'

// /status 시작 화면은 App.tsx 안의 컴포넌트라 렌더 없이 소스로 지킨다(그 밖의 화면은 각 화면 테스트가 렌더로 확인한다).
const app = readFileSync(new URL('../../../App.tsx', import.meta.url), 'utf8')
const start = app.match(/function StartPage\(\) \{[\s\S]*?\n\}\n/)?.[0] ?? ''

it('/status 시작 화면(StartPage)도 다른 화면처럼 공용 Footer를 main의 형제로 둔다', () => {
  expect(start).toMatch(/<\/main>\s*<Footer \/>/)
  expect(app).toContain("import { Footer } from './presentation/shared/shell/Gnb'")
})

it('시작 화면의 main은 min-h-screen으로 한 화면을 다 차지하지 않는다 — 남는 높이는 #root 세로 flex가 채우고, 아니면 푸터가 첫 화면 밖으로 밀린다', () => {
  expect(start).toContain('<main className="mx-auto flex')
  expect(start).not.toContain('min-h-screen')
})

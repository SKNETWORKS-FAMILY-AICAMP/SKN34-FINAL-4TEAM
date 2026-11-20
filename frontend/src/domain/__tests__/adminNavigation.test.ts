import { expect, it } from 'vitest'

import { LLM_PAGES, adminReturnPath, llmPage, llmPageHref } from '../entities/admin'

it('관리자 로그인 복귀는 허용 탭만 보존하고 외부 경로·임의 쿼리를 버린다', () => {
  expect(adminReturnPath('?tab=notices')).toBe('/admin?tab=notices')
  expect(adminReturnPath('?tab=events&next=https://example.invalid')).toBe('/admin?tab=events')
  expect(adminReturnPath('?tab=feedback')).toBe('/admin?tab=feedback')
  expect(adminReturnPath('?tab=genres')).toBe('/admin?tab=genres') // 콘텐츠 관리 > 장르(DEC-56)
  expect(adminReturnPath('?tab=ai')).toBe('/admin?tab=llm')
  expect(adminReturnPath('?tab=https://example.invalid')).toBe('/admin?tab=data')
  expect(adminReturnPath('?next=//example.invalid')).toBe('/admin')
  expect(adminReturnPath('')).toBe('/admin')
})

it('LLM Ops 쪽은 view로 정하고 없거나 모르는 값은 경고이며, 경고만 view 없는 주소다', () => {
  expect(LLM_PAGES.map(([page, label]) => [page, label])).toEqual([['alerts', '경고'], ['traces', '추적·지표'], ['prompts', '프롬프트·모델'], ['quality', '평가·누설 검사']])
  expect(['traces', 'prompts', 'quality'].map(llmPage)).toEqual(['traces', 'prompts', 'quality'])
  expect([null, '', 'alerts', 'nope', 'metrics', 'TRACES'].map(llmPage)).toEqual(['alerts', 'alerts', 'alerts', 'alerts', 'alerts', 'alerts'])
  expect(LLM_PAGES.map(([page]) => llmPageHref(page))).toEqual(['/admin?tab=llm', '/admin?tab=llm&view=traces', '/admin?tab=llm&view=prompts', '/admin?tab=llm&view=quality'])
})

it('LLM Ops 쪽(view)은 로그인 복귀에도 알려진 값만 보존하고, 다른 탭이나 모르는 값은 버린다', () => {
  expect(adminReturnPath('?tab=llm&view=traces')).toBe('/admin?tab=llm&view=traces')
  expect(adminReturnPath('?tab=ai&view=quality')).toBe('/admin?tab=llm&view=quality')
  expect(adminReturnPath('?tab=llm&view=alerts')).toBe('/admin?tab=llm')
  expect(adminReturnPath('?tab=llm&view=https://example.invalid')).toBe('/admin?tab=llm')
  expect(adminReturnPath('?tab=users&view=traces')).toBe('/admin?tab=users')
})

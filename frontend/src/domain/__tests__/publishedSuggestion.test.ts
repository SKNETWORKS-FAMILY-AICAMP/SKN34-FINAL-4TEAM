import { expect, it } from 'vitest'
import { suggestionStatus } from '../entities/editSuggestion'

it('발행 계보에 남은 승인만 발행 반영으로 안내한다', () => {
  expect(suggestionStatus({status:'approved',applyResult:'applied',published:true}).label).toBe('발행 반영됨')
  expect(suggestionStatus({status:'approved',applyResult:'applied',published:false}).label).toContain('초안')
})

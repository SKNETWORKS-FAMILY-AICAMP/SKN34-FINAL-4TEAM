import { expect, it } from 'vitest'

import { initialWorldStudioFlow, worldStudioFlow } from './worldStudioFlow'

it('keeps the authoring step through the separate library and can skip relationships', () => {
  const cards = worldStudioFlow(initialWorldStudioFlow, { type: 'step', step: 'cards' })
  const library = worldStudioFlow(cards, { type: 'list' })
  expect(worldStudioFlow(library, { type: 'resume' })).toEqual(cards)
  expect(worldStudioFlow(cards, { type: 'step', step: 'review' })).toEqual({ screen: 'editor', step: 'review' })
})

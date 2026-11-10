import { expect, it } from 'vitest'

import { initialWorldStudioFlow, worldStudioFlow } from './worldStudioFlow'

it('keeps the authoring step through the separate library and can skip relationships', () => {
  const cards = worldStudioFlow(initialWorldStudioFlow, { type: 'step', step: 'cards' })
  const library = worldStudioFlow(cards, { type: 'list' })
  expect(worldStudioFlow(library, { type: 'resume' })).toEqual(cards)
  expect(worldStudioFlow(cards, { type: 'step', step: 'review' })).toEqual({ screen: 'editor', step: 'review' })
})

it('returns to the library when the loaded world is cleared and opens a newly loaded world at step one', () => {
  const editing = worldStudioFlow(initialWorldStudioFlow, { type: 'step', step: 'review' })
  expect(worldStudioFlow(editing, { type: 'world', id: undefined })).toEqual(initialWorldStudioFlow)
  expect(worldStudioFlow(editing, { type: 'world', id: 'another-world' })).toEqual({ screen: 'editor', step: 'info' })
})

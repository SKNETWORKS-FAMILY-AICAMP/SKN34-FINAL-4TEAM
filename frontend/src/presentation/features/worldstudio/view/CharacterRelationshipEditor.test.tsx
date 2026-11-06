// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { newSetting } from '../../../../domain/entities/studioWorld'
import { CharacterRelationshipEditor } from './CharacterRelationshipEditor'

afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks() })

it('keeps an unapplied relation draft on IME Escape and asks before discarding it', async () => {
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} })
  Object.assign(HTMLDialogElement.prototype, { show: vi.fn(), showModal: vi.fn(), close: vi.fn() })
  const a = newSetting('people'), b = newSetting('people')
  a.item.title = '가람'; b.item.title = '나래'
  const studio = {
    editing: { settings: [a, b] }, selected: '', busy: false, canUndoPersonDeletion: false,
    setSelected: vi.fn(), addCard: vi.fn(), update: vi.fn(), personDeletionInfo: vi.fn(),
    deletePerson: vi.fn(), undoPersonDeletion: vi.fn(),
  } as unknown as Parameters<typeof CharacterRelationshipEditor>[0]['studio']
  render(<CharacterRelationshipEditor studio={studio} renderPair={(_s, _t, _close, onDirty) => <button onClick={() => onDirty(true)}>입력</button>} />)
  fireEvent.click(await screen.findByRole('button', { name: '가람 관계 연결' }))
  fireEvent.click(screen.getByRole('button', { name: '나래 상대 선택' }))
  const draft = screen.getByText('입력')
  fireEvent.click(draft)
  fireEvent.keyDown(draft, { key: 'Escape', isComposing: true })
  expect(screen.queryByText('입력')).not.toBeNull()
  const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true)
  fireEvent.keyDown(draft, { key: 'Escape' })
  expect(screen.queryByText('입력')).not.toBeNull()
  fireEvent.keyDown(draft, { key: 'Escape' })
  expect(confirm).toHaveBeenCalledTimes(2)
  expect(screen.queryByText('입력')).toBeNull()
})

import { expect, it } from 'vitest'

import { createAppStore } from '../../../app/store'
import { initialSession, sessionActions } from '../session/sessionSlice'
import { initialUi, uiActions, uiSlice } from './uiSlice'

it('keeps the existing UI defaults and reader font bounds in one owner', () => {
  expect(uiSlice.reducer(undefined, { type: 'init' })).toEqual({
    theme: null,
    showSid: true,
    screen: { base: 'U01', sheet: null },
    chip: '추천',
    hero: 0,
    look: 'auto',
    fs: 19,
    motion: true,
    epSort: 'old',
    guide: true,
    firstHome: true,
  })
  const larger = uiSlice.reducer(initialUi, uiActions.changeFs(100))
  expect(larger.fs).toBe(24)
  expect(uiSlice.reducer(larger, uiActions.changeFs(-100)).fs).toBe(15)
  expect(initialUi.fs).toBe(19)
})

it('updates appearance, page and sheet IDs, home state and reader preferences without changing session', () => {
  const store = createAppStore()
  const session = store.getState().session
  store.dispatch(uiActions.setTheme('dark'))
  store.dispatch(uiActions.toggleSid())
  store.dispatch(uiActions.setBaseScreen('U05'))
  store.dispatch(uiActions.setSheetScreen('U07'))
  store.dispatch(uiActions.setChip('판타지'))
  store.dispatch(uiActions.setHero(3))
  store.dispatch(uiActions.stepHero(-1))
  store.dispatch(uiActions.setLook('night'))
  store.dispatch(uiActions.changeFs(1))
  store.dispatch(uiActions.setMotion(false))
  store.dispatch(uiActions.setEpSort('new'))
  store.dispatch(uiActions.closeGuide())
  store.dispatch(uiActions.homeVisited())
  expect(store.getState().ui).toEqual({
    theme: 'dark',
    showSid: false,
    screen: { base: 'U05', sheet: 'U07' },
    chip: '판타지',
    hero: 2,
    look: 'night',
    fs: 20,
    motion: false,
    epSort: 'new',
    guide: false,
    firstHome: false,
  })
  store.dispatch(uiActions.setSheetScreen(null))
  expect(store.getState().ui.screen).toEqual({ base: 'U05', sheet: null })
  expect(store.getState().session).toBe(session)
})

it('keeps UI choices across login, logout and invalidation without copying them into session', () => {
  const store = createAppStore({}, { theme: 'dark', look: 'night', chip: '판타지' })
  const ui = store.getState().ui
  store.dispatch(sessionActions.requireLogin({ next: '/lib', msg: '로그인', role: 'admin' }))
  store.dispatch(
    sessionActions.login({
      id: 'reader',
      email: 'reader@example.com',
      nickname: '독자',
      operator: false,
    }),
  )
  store.dispatch(sessionActions.dataChanged())
  store.dispatch(sessionActions.noticeSignal())
  store.dispatch(sessionActions.noticeStreamState('live'))
  store.dispatch(sessionActions.logout())
  expect(store.getState().ui).toBe(ui)
  expect(store.getState().session).toEqual({
    ...initialSession,
    dataVersion: 1,
    noticeVersion: 1,
    noticeStream: 'live',
  })
  expect(store.getState().session).not.toHaveProperty('theme')
  expect(store.getState().ui).not.toHaveProperty('user')
  expect(createAppStore().getState().ui).toEqual(initialUi)
})

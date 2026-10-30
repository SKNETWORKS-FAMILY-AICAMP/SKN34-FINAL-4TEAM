import { configureStore } from '@reduxjs/toolkit'
import { useDispatch, useSelector } from 'react-redux'

import { importSlice } from '../presentation/features/library/state/importSlice'
import { initialSession, sessionSlice, type SessionState } from '../presentation/shared/session/sessionSlice'

export function createAppStore(session: Partial<SessionState> = {}) {
  return configureStore({
    reducer: { session: sessionSlice.reducer, import: importSlice.reducer },
    preloadedState: { session: { ...initialSession, ...session } },
  })
}

export type AppStore = ReturnType<typeof createAppStore>
export type RootState = ReturnType<AppStore['getState']>
export const useAppDispatch = useDispatch.withTypes<AppStore['dispatch']>()
export const useAppSelector = useSelector.withTypes<RootState>()

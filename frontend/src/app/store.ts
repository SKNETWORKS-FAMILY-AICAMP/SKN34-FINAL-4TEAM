import { configureStore } from '@reduxjs/toolkit'
import { useDispatch, useSelector } from 'react-redux'

import { adminViewSlice } from '../presentation/features/admin/state/adminViewSlice'
import { initialSession, sessionSlice, type SessionState } from '../presentation/shared/session/sessionSlice'

export function createAppStore(session: Partial<SessionState> = {}) {
  return configureStore({
    reducer: { session: sessionSlice.reducer, adminView: adminViewSlice.reducer },
    preloadedState: { session: { ...initialSession, ...session } },
  })
}

export type AppStore = ReturnType<typeof createAppStore>
export type RootState = ReturnType<AppStore['getState']>
export const useAppDispatch = useDispatch.withTypes<AppStore['dispatch']>()
export const useAppSelector = useSelector.withTypes<RootState>()

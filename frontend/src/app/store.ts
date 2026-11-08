import { configureStore } from '@reduxjs/toolkit'
import { useDispatch, useSelector } from 'react-redux'

import { adminViewSlice } from '../presentation/features/admin/state/adminViewSlice'
import { newWorkSlice } from '../presentation/features/library/state/newWorkSlice'
import { importSlice } from '../presentation/features/library/state/importSlice'
import {
  initialSession,
  sessionSlice,
  type SessionState,
} from '../presentation/shared/session/sessionSlice'
import { initialUi, uiSlice, type UiState } from '../presentation/shared/ui/uiSlice'

export function createAppStore(session: Partial<SessionState> = {}, ui: Partial<UiState> = {}) {
  return configureStore({
    reducer: {
      session: sessionSlice.reducer,
      ui: uiSlice.reducer,
      adminView: adminViewSlice.reducer,
      import: importSlice.reducer,
      newWork: newWorkSlice.reducer,
    },
    preloadedState: { session: { ...initialSession, ...session }, ui: { ...initialUi, ...ui } },
  })
}

export type AppStore = ReturnType<typeof createAppStore>
export type RootState = ReturnType<AppStore['getState']>
export const useAppDispatch = useDispatch.withTypes<AppStore['dispatch']>()
export const useAppSelector = useSelector.withTypes<RootState>()

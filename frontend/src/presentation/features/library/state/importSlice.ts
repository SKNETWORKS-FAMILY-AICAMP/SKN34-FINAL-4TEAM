import { createSlice, type PayloadAction } from '@reduxjs/toolkit'

import { IMPORT } from '../../../../domain/usecases/LibraryUseCase'

/** 목업 IMP·IMPORT: 화면을 떠나도 남는 가져오기 진행 상태와 고친 정리 결과 */
export type ImportList = 'cast' | 'world' | 'events'
export type ImportState = { startedAt: number | null; picked: boolean; kind: string; ok: boolean; worldId: string } & Record<ImportList, string[]>

const initialState: ImportState = { startedAt: null, picked: false, kind: '다른 사람 소설', ok: false, worldId: '', cast: IMPORT.cast, world: IMPORT.world, events: IMPORT.events }

export const importSlice = createSlice({
  name: 'import',
  initialState,
  reducers: {
    set: (s, a: PayloadAction<Partial<Pick<ImportState, 'picked' | 'kind' | 'ok' | 'worldId'>>>) => { Object.assign(s, a.payload) },
    /** 진행 단계는 시작 시각으로 계산해 화면 밖에서도 끝납니다. */
    start: (s, a: PayloadAction<number>) => { s.startedAt = a.payload },
    edit: (s, a: PayloadAction<{ list: ImportList; i: number; text: string }>) => { s[a.payload.list][a.payload.i] = a.payload.text },
  },
})

export const importActions = importSlice.actions

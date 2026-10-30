import { createSlice, type PayloadAction } from '@reduxjs/toolkit'

import type { NewWorkInput } from '../../../../domain/usecases/LibraryUseCase'

/** 목업 NEW: 다른 화면에 다녀오거나 소설을 만든 뒤에도 남는 새 소설 작성 내용 */
export const EMPTY_NEW_WORK: NewWorkInput = {
  worldIds: [], schedule: ['비정기'], tags: [], title: '', summary: '', localRules: '',
  cast: [{ n: '', d: '' }, { n: '', d: '' }, { n: '', d: '' }], genre: '판타지', rating: '일반', fork: 'all', cover: null,
}

export const newWorkSlice = createSlice({
  name: 'newWork',
  initialState: EMPTY_NEW_WORK,
  reducers: {
    set: (s, a: PayloadAction<Partial<NewWorkInput>>) => ({ ...s, ...a.payload }),
    /** 목업 createWork: 만든 뒤에는 세계관 선택과 표지만 비웁니다. */
    created: (s) => { s.worldIds = []; s.cover = null },
  },
})

export const newWorkActions = newWorkSlice.actions

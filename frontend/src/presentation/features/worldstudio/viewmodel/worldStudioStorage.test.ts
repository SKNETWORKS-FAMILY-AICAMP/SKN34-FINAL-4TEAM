import {expect,it} from 'vitest'
import {worldStudioStorage} from './worldStudioStorage'

it('explicitly distinguishes disposable mockup storage from server storage',()=>{
 const mock=worldStudioStorage('mockup')
 for(const text of Object.values(mock)){
  expect(text).toContain('목업')
  expect(text).not.toMatch(/서버에 (현재 세계관을 )?저장(합니다|해요|했)/)
 }
 expect(mock.intro).toContain('새로고침')
 expect(worldStudioStorage('development').saved).toContain('서버에')
 expect(worldStudioStorage('production')).toEqual(worldStudioStorage('development'))
})

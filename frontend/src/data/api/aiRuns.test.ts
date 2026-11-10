import {describe,it,expect} from 'vitest'
import {parseProgress, nextCursor} from './aiRuns'

describe('AI 진행 cursor',()=>{
  const event={runId:'r',seq:2,taskId:'qa',attempt:1,phase:'task',step:1,code:'TEXT_LOADING',status:'running',message:'untrusted'}
  it('중복은 무시하고 gap은 재조회한다',()=>{
    expect(nextCursor(2,parseProgress(event,'r'))).toBe(2)
    expect(nextCursor(1,parseProgress(event,'r'))).toBe(2)
    expect(()=>nextCursor(0,parseProgress(event,'r'))).toThrow()
  })
  it('다른 실행과 임의 진행 문구를 신뢰하지 않는다',()=>{
    expect(()=>parseProgress(event,'other')).toThrow()
    expect(parseProgress(event,'r').message).toBe('관련 원고를 찾고 있습니다.')
    expect(()=>parseProgress({...event,code:'secret reasoning'},'r')).toThrow()
  })
})

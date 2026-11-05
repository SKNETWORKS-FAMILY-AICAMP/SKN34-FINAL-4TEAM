// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { newSetting, type StudioWorld } from '../../../../domain/entities/studioWorld'
import { WorldMap } from './WorldMap'

vi.mock('react-force-graph-2d',()=>({default:()=> <div aria-label="그래프 캔버스"/>}))
afterEach(()=>{cleanup();vi.unstubAllGlobals()})
it('provides keyboard-accessible search and details for saved data, and an empty state',async()=>{
 vi.stubGlobal('ResizeObserver',class{observe(){}disconnect(){}})
 const a=newSetting('people');a.item.title='가람';a.item.text='북부 기록관';a.tags=['항구']
 const world:StudioWorld={id:'w',version:1,name:'바다',description:'',settings:[a],analysis:null}
 const {rerender}=render(<WorldMap world={world}/> )
 fireEvent.click(screen.getByRole('button',{name:'가람 인물'}))
 expect(screen.getByRole('heading',{name:'가람'})).toBeTruthy()
 fireEvent.change(screen.getByRole('searchbox',{name:'설정 검색'}),{target:{value:'없는설정'}})
 expect(screen.getByText('일치하는 설정이 없습니다.')).toBeTruthy()
 fireEvent.click(screen.getByRole('button',{name:'검색 조건 초기화'}))
 expect(screen.getByRole('button',{name:'가람 인물'})).toBeTruthy()
 rerender(<WorldMap key="new-world" world={{...world,id:'new-world',settings:[]}}/> )
 expect(screen.getByText('저장된 설정이 없습니다.')).toBeTruthy()
 expect(screen.queryByRole('heading',{name:'가람'})).toBeNull()
})

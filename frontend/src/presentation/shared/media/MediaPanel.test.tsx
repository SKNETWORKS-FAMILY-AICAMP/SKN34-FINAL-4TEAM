// @vitest-environment jsdom
import {cleanup,render,screen} from '@testing-library/react'
import {afterEach,expect,it,vi} from 'vitest'
import type {MediaTarget} from '../../../domain/entities/media'
import {MediaPanel} from './MediaPanel'
import {useMediaViewModel,useStoredImage} from './useMediaViewModel'

vi.mock('./useMediaViewModel',()=>({useMediaViewModel:vi.fn(),useStoredImage:vi.fn()}))
afterEach(()=>{cleanup();vi.clearAllMocks()})

function renderPanel(state:Partial<ReturnType<typeof useMediaViewModel>>={},target:MediaTarget={kind:'cover',workId:'work-id'}) {
 vi.mocked(useMediaViewModel).mockReturnValue({items:[],busy:false,mutating:false,error:'',notice:'',revision:0,reload:vi.fn(),upload:vi.fn(),remove:vi.fn(),download:vi.fn(),cancel:vi.fn(),...state})
 vi.mocked(useStoredImage).mockReturnValue({url:'blob:stored-cover',error:''})
 return render(<MediaPanel target={target}/> )
}

it('shows the original local default only after an empty cover list loads',()=>{
 renderPanel()
 const image=screen.getByRole('img',{name:'기본 작품 표지'})
 expect(image.getAttribute('src')).toBe('/default-work-cover.svg')
 expect(image.getAttribute('width')).toBe('180')
 expect(image.getAttribute('height')).toBe('240')
 expect(screen.getByRole('status').textContent).toBe('저장된 파일이 없어요.')
})

it.each([{busy:true},{error:'첨부 목록을 불러오지 못했어요.'}])('does not disguise a pending or failed cover request as an empty cover: %o',(state)=>{
 renderPanel(state)
 expect(screen.queryByRole('img',{name:'기본 작품 표지'})).toBeNull()
 if(state.error)expect(screen.getByRole('alert').textContent).toBe(state.error)
 else expect(screen.getByRole('status').textContent).toContain('파일을 처리하고 있어요')
})

it('keeps an uploaded cover instead of replacing it with the default',()=>{
 renderPanel({items:[{id:'cover-id',filename:'cover.png',mediaType:'image/png',kind:'IMAGE',byteSize:3,createdAt:'2026-11-05T00:00:00Z',url:'/unused'}]})
 expect(screen.getByRole('img',{name:'작품 표지'}).getAttribute('src')).toBe('blob:stored-cover')
 expect(screen.queryByRole('img',{name:'기본 작품 표지'})).toBeNull()
})

it('does not use a work-cover placeholder for manuscript images',()=>{
 renderPanel({}, {kind:'episode',workId:'work-id',number:1})
 expect(screen.queryByRole('img',{name:'기본 작품 표지'})).toBeNull()
})

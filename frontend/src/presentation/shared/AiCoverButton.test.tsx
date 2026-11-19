// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { AiCoverButton } from './AiCoverButton'

const useCase=vi.hoisted(()=>({read:vi.fn(),readByKey:vi.fn(),submit:vi.fn(),image:vi.fn()}))
vi.mock('../../app/appContainer',()=>({appContainer:{resolve:()=>useCase}}))
vi.mock('../../data/api/auth',()=>({authenticatedUserId:()=> 'owner'}))
afterEach(()=>{
 cleanup()
 sessionStorage.clear()
 vi.restoreAllMocks()
 vi.resetAllMocks()
})

it('새 작품은 기본 참조로 시작하고 내 이미지 모드는 파일을 고른 뒤 접수한다',async()=>{
 const create=URL.createObjectURL
 const revoke=URL.revokeObjectURL
 URL.createObjectURL=vi.fn(()=> 'blob:reference')
 URL.revokeObjectURL=vi.fn()
 try {
  useCase.submit.mockResolvedValue({jobId:'new-job',status:'queued',previewUrl:null})
  useCase.read.mockResolvedValue({jobId:'new-job',status:'queued',previewUrl:null})
  render(<AiCoverButton onPick={vi.fn()} />)
  fireEvent.click(screen.getByRole('button',{name:'AI로 생성'}))
  const source=screen.getByRole<HTMLSelectElement>('combobox',{name:'참고 이미지'})
  expect(source.value).toBe('preset')
  expect(screen.getByRole('img',{name:/기본 참고 이미지/}).getAttribute('src')).toContain('landscape-v1')
  fireEvent.change(screen.getByRole('textbox',{name:'이번 장면'}),{target:{value:'새벽 항구'}})
  const submit=screen.getByRole<HTMLButtonElement>('button',{name:'생성 요청'})
  expect(submit.disabled).toBe(false)
  fireEvent.change(source,{target:{value:'custom'}})
  expect(submit.disabled).toBe(true)
  expect(screen.queryByRole('option',{name:'현재 표지'})).toBeNull()
  const image=new File(['test image'],'reference.png',{type:'image/png'})
  fireEvent.change(screen.getByLabelText(/참고 파일/),{target:{files:[image]}})
  fireEvent.change(screen.getByRole('combobox',{name:'참고 목적'}),{target:{value:'subject'}})
  expect(useCase.submit).not.toHaveBeenCalled()
  fireEvent.click(submit)
  await waitFor(()=>expect(useCase.submit).toHaveBeenCalledOnce())
  expect(useCase.submit.mock.calls[0][0]).toMatchObject({
   purpose:'work_cover',prompt:'새벽 항구',reference:{mode:'upload',role:'subject'},referenceFile:image,
  })
 } finally {
  cleanup()
  URL.createObjectURL=create
  URL.revokeObjectURL=revoke
 }
})

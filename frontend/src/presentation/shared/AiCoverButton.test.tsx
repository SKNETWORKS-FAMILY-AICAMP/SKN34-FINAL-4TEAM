// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { Provider } from 'react-redux'
import { afterEach, expect, it, vi } from 'vitest'
import { createAppStore } from '../../app/store'
import { AiCoverButton } from './AiCoverButton'

const useCase=vi.hoisted(()=>({read:vi.fn(),readByKey:vi.fn(),submit:vi.fn(),image:vi.fn()}))
vi.mock('../../app/appContainer',()=>({appContainer:{resolve:()=>useCase}}))
const renderButton = () => render(<Provider store={createAppStore({memberId:'owner'})}><AiCoverButton onPick={vi.fn()} /></Provider>)
afterEach(()=>{
 cleanup()
 sessionStorage.clear()
 vi.restoreAllMocks()
 vi.resetAllMocks()
})

it('콘텐츠 차단은 장면 수정으로 안내하고 조회 오류는 상태를 다시 확인할 수 있다',async()=>{
 useCase.submit.mockResolvedValueOnce({jobId:'blocked',status:'queued',stage:'waiting',previewUrl:null})
 useCase.submit.mockResolvedValueOnce({jobId:'retry',status:'queued',stage:'waiting',previewUrl:null})
 useCase.read.mockResolvedValueOnce({jobId:'blocked',status:'failed',stage:'output_blocked',previewUrl:null})
 useCase.read.mockRejectedValueOnce(new Error('조회 실패'))
 renderButton()
 fireEvent.click(screen.getByRole('button',{name:'AI로 생성'}))
 fireEvent.change(screen.getByRole('textbox',{name:'이번 장면'}),{target:{value:'새벽 항구'}})
 fireEvent.click(screen.getByRole('button',{name:'생성 요청'}))
 await screen.findByText(/장면 설명을 수정해 주세요/)
 expect(screen.queryByRole('button',{name:'상태 다시 확인'})).toBeNull()
 fireEvent.click(screen.getByRole('button',{name:'생성 요청'}))
 await screen.findByText(/상태를 확인하지 못했어요/)
 expect(screen.getByRole('button',{name:'상태 다시 확인'})).toBeTruthy()
 expect(screen.getByRole('status').textContent).toBe('')
})

it('새 작품은 기본 참조로 시작하고 내 이미지 모드는 파일을 고른 뒤 접수한다',async()=>{
 const create=URL.createObjectURL
 const revoke=URL.revokeObjectURL
 URL.createObjectURL=vi.fn(()=> 'blob:reference')
 URL.revokeObjectURL=vi.fn()
 try {
  useCase.submit.mockResolvedValue({jobId:'new-job',status:'queued',previewUrl:null})
  useCase.read.mockResolvedValue({jobId:'new-job',status:'queued',previewUrl:null})
  renderButton()
  fireEvent.click(screen.getByRole('button',{name:'AI로 생성'}))
  const source=screen.getByRole<HTMLSelectElement>('combobox',{name:'참고 이미지'})
  expect(source.value).toBe('preset')
  expect(screen.getByRole('img',{name:/기본 참고 이미지/}).getAttribute('src')).toContain('landscape-v1')
  fireEvent.change(screen.getByRole('textbox',{name:'이번 장면'}),{target:{value:'새벽 항구'}})
  const submit=screen.getByRole<HTMLButtonElement>('button',{name:'생성 요청'})
  expect(submit.disabled).toBe(false)
  fireEvent.change(source,{target:{value:'upload'}})
  expect(submit.disabled).toBe(true)
  expect(screen.queryByRole('option',{name:'현재 표지'})).toBeNull()
  const image=new File(['test image'],'reference.png',{type:'image/png'})
  fireEvent.change(screen.getByLabelText(/참고 이미지 올리기/),{target:{files:[image]}})
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

const generatedKey='image-generation:owner:work_cover:new'
const stubObjectUrl=()=>{
 const create=URL.createObjectURL
 const revoke=URL.revokeObjectURL
 URL.createObjectURL=vi.fn(()=> 'blob:result')
 URL.revokeObjectURL=vi.fn()
 return ()=>{URL.createObjectURL=create;URL.revokeObjectURL=revoke}
}
const requestGeneration=(scene='새벽 항구')=>{
 fireEvent.click(screen.getByRole('button',{name:'AI로 생성'}))
 fireEvent.change(screen.getByRole('textbox',{name:'이번 장면'}),{target:{value:scene}})
 fireEvent.click(screen.getByRole('button',{name:'생성 요청'}))
}

it('상태 문구는 늘 있는 영역에서 바뀌고, 미리보기를 받는 동안 생성 요청을 잠그며, 끝나면 선택 버튼으로 초점이 간다',async()=>{
 const restore=stubObjectUrl()
 try {
  let finish!:(blob:Blob)=>void
  useCase.submit.mockResolvedValue({jobId:'job',status:'queued',stage:'waiting',previewUrl:null})
  useCase.read.mockResolvedValue({jobId:'job',status:'succeeded',stage:'completed',previewUrl:'/content'})
  useCase.image.mockReturnValue(new Promise<Blob>(resolve=>{finish=resolve}))
  renderButton()
  fireEvent.click(screen.getByRole('button',{name:'AI로 생성'}))
  const status=screen.getByRole('status')
  expect(status.textContent).toBe('')
  fireEvent.change(screen.getByRole('textbox',{name:'이번 장면'}),{target:{value:'새벽 항구'}})
  fireEvent.click(screen.getByRole('button',{name:'생성 요청'}))
  await waitFor(()=>expect(status.textContent).toBe('미리보기를 불러오는 중이에요.'))
  expect(screen.getByRole<HTMLButtonElement>('button',{name:'생성 요청'}).disabled).toBe(true)
  finish(new Blob(['image']))
  await waitFor(()=>expect(status.textContent).toBe('이미지가 준비됐어요. 미리보기를 확인해 주세요.'))
  expect(status.isConnected).toBe(true)
  expect(screen.getByText('이미지를 선택한 뒤 표지를 저장해 주세요.')).toBeTruthy()
  await waitFor(()=>expect(document.activeElement).toBe(screen.getByRole('button',{name:'이 이미지 선택'})))
 } finally { cleanup();restore() }
})

it('미리보기가 생겨도 입력 중인 다른 칸에서 초점을 빼앗지 않는다',async()=>{
 const restore=stubObjectUrl()
 try {
  let finish!:(blob:Blob)=>void
  useCase.submit.mockResolvedValue({jobId:'job',status:'queued',stage:'waiting',previewUrl:null})
  useCase.read.mockResolvedValue({jobId:'job',status:'succeeded',stage:'completed',previewUrl:'/content'})
  useCase.image.mockReturnValue(new Promise<Blob>(resolve=>{finish=resolve}))
  render(<Provider store={createAppStore({memberId:'owner'})}><input aria-label='작품 제목' /><AiCoverButton onPick={vi.fn()} /></Provider>)
  requestGeneration()
  await waitFor(()=>expect(screen.getByRole('status').textContent).toBe('미리보기를 불러오는 중이에요.'))
  const title=screen.getByLabelText('작품 제목')
  title.focus()
  finish(new Blob(['image']))
  await waitFor(()=>expect(screen.getByRole('status').textContent).toBe('이미지가 준비됐어요. 미리보기를 확인해 주세요.'))
  expect(document.activeElement).toBe(title)
 } finally { cleanup();restore() }
})

it('이미지를 고르면 저장 안내를 보이고 저장 기록을 지워 다음 화면에 다시 뜨지 않게 한다',async()=>{
 const restore=stubObjectUrl()
 try {
  const onPick=vi.fn()
  useCase.submit.mockResolvedValue({jobId:'job',status:'queued',stage:'waiting',previewUrl:null})
  useCase.read.mockResolvedValue({jobId:'job',status:'succeeded',stage:'completed',previewUrl:'/content'})
  useCase.image.mockResolvedValue(new Blob(['image']))
  render(<Provider store={createAppStore({memberId:'owner'})}><AiCoverButton onPick={onPick} saveHint="'작품 만들기'를 누르면 표지로 저장돼요." /></Provider>)
  requestGeneration()
  await screen.findByText("'작품 만들기'를 누르면 표지로 저장돼요.")
  expect(sessionStorage.getItem(generatedKey)).toBe('job')
  fireEvent.click(screen.getByRole('button',{name:'이 이미지 선택'}))
  expect(onPick).toHaveBeenCalledOnce()
  expect(sessionStorage.getItem(generatedKey)).toBeNull()
 } finally { cleanup();restore() }
})

it('참고 이미지는 선택 칸 하나(기본 이미지·현재 표지·내 이미지 올리기)에서 고른다',()=>{
 render(<Provider store={createAppStore({memberId:'owner'})}><AiCoverButton hasCurrentCover onPick={vi.fn()} /></Provider>)
 fireEvent.click(screen.getByRole('button',{name:'AI로 생성'}))
 const source=screen.getByRole<HTMLSelectElement>('combobox',{name:'참고 이미지'})
 expect(screen.getAllByRole('option').filter(option=>source.contains(option)).map(option=>option.textContent)).toEqual(['기본 이미지','현재 표지','내 이미지 올리기'])
 expect(screen.queryByRole('combobox',{name:'이미지 출처'})).toBeNull()
 fireEvent.change(source,{target:{value:'cover'}})
 expect(source.value).toBe('cover')
 expect(screen.queryByLabelText(/참고 이미지 올리기/)).toBeNull()
 fireEvent.change(screen.getByRole('textbox',{name:'이번 장면'}),{target:{value:'새벽 항구'}})
 expect(screen.getByRole<HTMLButtonElement>('button',{name:'생성 요청'}).disabled).toBe(false)
})

it('참고 파일 입력은 다른 화면과 같은 파일 선택 버튼이고 형식 안내와 고른 파일 이름은 글로 보인다',()=>{
 const create=URL.createObjectURL
 const revoke=URL.revokeObjectURL
 URL.createObjectURL=vi.fn(()=> 'blob:reference')
 URL.revokeObjectURL=vi.fn()
 try {
  renderButton()
  fireEvent.click(screen.getByRole('button',{name:'AI로 생성'}))
  fireEvent.change(screen.getByRole('combobox',{name:'참고 이미지'}),{target:{value:'upload'}})
  const input=screen.getByLabelText(/참고 이미지 올리기/)
  expect(input.closest('label')?.className).toBe('btn sm ep-file-pick')
  expect(input.className).toBe('')
  expect(screen.getByText('PNG·JPEG·WebP, 5 MiB 이하.').className).toBe('small muted')
  fireEvent.change(input,{target:{files:[new File(['image'],'reference.png',{type:'image/png'})]}})
  expect(screen.getByText('선택한 파일: reference.png').className).toBe('small muted')
 } finally {
  cleanup()
  URL.createObjectURL=create
  URL.revokeObjectURL=revoke
 }
})

it('현재 표지가 사라지면 현재 표지 참고에서 내 이미지 올리기로 돌아가 입력이 사라지지 않는다',()=>{
 const store=createAppStore({memberId:'owner'})
 const view=render(<Provider store={store}><AiCoverButton hasCurrentCover onPick={vi.fn()} /></Provider>)
 fireEvent.click(screen.getByRole('button',{name:'AI로 생성'}))
 const source=screen.getByRole<HTMLSelectElement>('combobox',{name:'참고 이미지'})
 fireEvent.change(source,{target:{value:'cover'}})
 expect(source.value).toBe('cover')
 view.rerender(<Provider store={store}><AiCoverButton hasCurrentCover={false} onPick={vi.fn()} /></Provider>)
 expect(source.value).toBe('upload')
 expect(screen.queryByRole('option',{name:'현재 표지'})).toBeNull()
 expect(screen.getByLabelText(/참고 이미지 올리기/)).toBeTruthy()
 fireEvent.change(screen.getByRole('textbox',{name:'이번 장면'}),{target:{value:'새벽 항구'}})
 expect(screen.getByRole<HTMLButtonElement>('button',{name:'생성 요청'}).disabled).toBe(true)
})

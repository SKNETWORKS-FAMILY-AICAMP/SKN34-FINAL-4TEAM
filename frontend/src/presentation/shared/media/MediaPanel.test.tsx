// @vitest-environment jsdom
import {act,cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react'
import {afterEach,expect,it,vi} from 'vitest'
import type {MediaTarget} from '../../../domain/entities/media'
import {MediaPanel,StoredImage} from './MediaPanel'
import {useMediaViewModel,useStoredImage} from './useMediaViewModel'

vi.mock('./useMediaViewModel',()=>({useMediaViewModel:vi.fn(),useStoredImage:vi.fn()}))
afterEach(()=>{cleanup();vi.clearAllMocks();vi.unstubAllGlobals()})

function renderPanel(state:Partial<ReturnType<typeof useMediaViewModel>>={},target:MediaTarget={kind:'cover',workId:'work-id'}) {
 vi.mocked(useMediaViewModel).mockReturnValue({items:[],busy:false,mutating:false,error:'',notice:'',revision:0,reload:vi.fn(),upload:vi.fn(),remove:vi.fn(),download:vi.fn(),rename:vi.fn().mockResolvedValue(true),cancel:vi.fn(),...state})
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

const settingTarget:MediaTarget={kind:'setting',workId:'work-id',settingId:'setting-id'}
const memo={id:'memo-id',filename:'세계관 메모.pdf',mediaType:'application/pdf',kind:'FILE' as const,byteSize:2048,createdAt:'2026-11-05T00:00:00Z',url:'/unused'}

it('renames a setting attachment with the extension fixed and closes the form after the server accepts it',async()=>{
 const rename=vi.fn().mockResolvedValue(true)
 renderPanel({items:[memo],rename},settingTarget)
 expect(screen.queryByLabelText('새 파일 이름 · 세계관 메모.pdf')).toBeNull()
 fireEvent.click(screen.getByRole('button',{name:'이름 변경 · 세계관 메모.pdf'}))
 const input=screen.getByLabelText<HTMLInputElement>('새 파일 이름 · 세계관 메모.pdf')
 expect(input.value).toBe('세계관 메모')
 expect(screen.getByText('.pdf')).toBeTruthy()
 expect(screen.getByText('확장자(.pdf)는 바꿀 수 없어요.')).toBeTruthy()
 fireEvent.change(input,{target:{value:'새 메모'}})
 fireEvent.click(screen.getByRole('button',{name:'이름 저장'}))
 await waitFor(()=>expect(rename).toHaveBeenCalledWith(memo,'새 메모.pdf'))
 await waitFor(()=>expect(screen.queryByLabelText('새 파일 이름 · 세계관 메모.pdf')).toBeNull())
 expect(screen.getByRole('button',{name:'이름 변경 · 세계관 메모.pdf'})).toBeTruthy()
})

it('keeps the form and the typed name open when the rename fails, and cancel closes it without a request',async()=>{
 const rename=vi.fn().mockResolvedValue(false)
 renderPanel({items:[memo],rename,error:'파일 입력을 확인해 주세요.'},settingTarget)
 fireEvent.click(screen.getByRole('button',{name:'이름 변경 · 세계관 메모.pdf'}))
 fireEvent.change(screen.getByLabelText('새 파일 이름 · 세계관 메모.pdf'),{target:{value:'잘못된 이름..'}})
 fireEvent.click(screen.getByRole('button',{name:'이름 저장'}))
 await waitFor(()=>expect(rename).toHaveBeenCalledWith(memo,'잘못된 이름...pdf'))
 expect(screen.getByRole('alert').textContent).toBe('파일 입력을 확인해 주세요.')
 expect(screen.getByLabelText<HTMLInputElement>('새 파일 이름 · 세계관 메모.pdf').value).toBe('잘못된 이름..')
 fireEvent.click(screen.getByRole('button',{name:'취소'}))
 expect(screen.queryByLabelText('새 파일 이름 · 세계관 메모.pdf')).toBeNull()
 expect(rename).toHaveBeenCalledTimes(1)
})

it.each<MediaTarget>([{kind:'cover',workId:'work-id'},{kind:'episode',workId:'work-id',number:1}])('has no rename for %o',target=>{
 renderPanel({items:[memo]},target)
 expect(screen.queryByRole('button',{name:/이름 변경/})).toBeNull()
})

it('locks the rename form with the rest of the panel while a request is running',()=>{
 renderPanel({items:[memo],busy:true},settingTarget)
 expect(screen.getByRole('button',{name:'이름 변경 · 세계관 메모.pdf'}).closest('fieldset')?.disabled).toBe(true)
})

it('StoredImage waits until its placeholder comes near the screen before asking for the picture, then stops watching',()=>{
 const episode:MediaTarget={kind:'episode',workId:'work-id',number:1}
 let report:(entries:{isIntersecting:boolean}[])=>void=()=>{}
 const observe=vi.fn();const disconnect=vi.fn()
 vi.stubGlobal('IntersectionObserver',class {constructor(callback:typeof report){report=callback} observe=observe;disconnect=disconnect})
 vi.mocked(useStoredImage).mockReturnValue({url:'',error:''})
 render(<StoredImage target={episode} id="image-id" alt="본문 이미지 1"/>)
 const placeholder=screen.getByRole('status')
 expect(placeholder.textContent).toBe('이미지를 불러오고 있어요…')
 expect(observe).toHaveBeenCalledExactlyOnceWith(placeholder)
 // 닫힌 접힘 안이나 화면에서 먼 자리(교차하지 않음)에서는 내려받기를 켜지 않는다.
 expect(vi.mocked(useStoredImage)).toHaveBeenLastCalledWith(episode,'image-id',false,0,undefined,false)
 act(()=>report([{isIntersecting:false}]))
 expect(vi.mocked(useStoredImage)).toHaveBeenLastCalledWith(episode,'image-id',false,0,undefined,false)
 act(()=>report([{isIntersecting:true}]))
 expect(vi.mocked(useStoredImage)).toHaveBeenLastCalledWith(episode,'image-id',false,0,undefined,true)
 expect(disconnect).toHaveBeenCalled()
})
it('StoredImage asks for the picture right away where the browser cannot watch the screen position',()=>{
 vi.mocked(useStoredImage).mockReturnValue({url:'',error:''})
 render(<StoredImage target={{kind:'cover',workId:'work-id'}} id="cover-id" alt="작품 표지" revision={2}/>)
 expect(vi.mocked(useStoredImage)).toHaveBeenLastCalledWith({kind:'cover',workId:'work-id'},'cover-id',false,2,undefined,true)
})

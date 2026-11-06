// @vitest-environment jsdom
import { cleanup, render, screen, fireEvent, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import '../../../../test/testLocks'
import { EpisodePage } from './EpisodePage'
import { EpisodeUseCase } from '../../../../domain/usecases/EpisodeUseCase'
import { HttpEpisodeRepository } from '../../../../data/content/HttpEpisodeRepository'
import { login } from '../../../../data/api/auth'

beforeEach(async () => {
  vi.stubGlobal('fetch', vi.fn(async (path: string) => path.endsWith('/csrf')
    ? Response.json({ csrfToken: 'content-csrf' })
    : Response.json({ accessToken: 'content-bearer', user: { id: 'writer', email: 'writer@example.invalid', nickname: 'Writer', operator: false } })))
  await login('writer@example.invalid', 'test-password')
})
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

it('requires selecting a saved version before opening publication preview', async()=>{
  const w={id:'w',title:'선택 필요',summary:'',visibility:'private',allowFork:false,source:null,episodes:[],draft:{title:'회차',body:'초안',revision:0}}
  render(<EpisodePage useCase={new EpisodeUseCase(new HttpEpisodeRepository(vi.fn().mockResolvedValue(new Response(JSON.stringify([w])))))}/>)
  fireEvent.click(await screen.findByRole('button',{name:/선택 필요/}))
  fireEvent.click(screen.getByLabelText('이 원고를 공개할 권리가 있음을 확인합니다.'))
  expect((screen.getByRole('button',{name:'회차 공개하기'}) as HTMLButtonElement).disabled).toBe(true)
  expect(screen.getByText('저장·AI 이력에서 공개할 저장 버전을 먼저 선택해 주세요.')).toBeTruthy()
})

it('requires a fresh rights confirmation for the next episode after publication', async()=>{
  const w = {id:'w1',title:'테스트',summary:'',visibility:'private',allowFork:false,source:null,episodes:[],draft:{title:'첫 화',body:'저장된 원고',revision:1}}
  const published = {...w,visibility:'public',episodes:[{number:1,version:1,title:'첫 화',body:'저장된 원고',inherited:false}],draft:{title:'새 회차',body:'',revision:2}}
  const calls = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify([w]))).mockResolvedValueOnce(new Response(JSON.stringify({versions:[{id:'v1',episode:1,title:'첫 화',body:'저장된 원고',revision:1,savedAt:'2026-11-02T00:00:00Z'}],proposals:[]}))).mockResolvedValueOnce(new Response(JSON.stringify(published)))
  render(<EpisodePage useCase={new EpisodeUseCase(new HttpEpisodeRepository(calls))}/> )
  fireEvent.click(await screen.findByRole('button',{name:/테스트/}))
  fireEvent.click(screen.getByRole('button',{name:'저장·AI 이력'}))
  fireEvent.click(await screen.findByRole('button',{name:'이 버전을 공개 대상으로 선택'}))
  const rights=screen.getByLabelText('이 원고를 공개할 권리가 있음을 확인합니다.')
  fireEvent.click(rights)
  fireEvent.click(screen.getByRole('button',{name:'회차 공개하기'}))
  fireEvent.click(screen.getByRole('button',{name:'이 원고로 공개 확정'}))
  await screen.findByText('회차를 공개했어요. 공개 원고에서 확인할 수 있어요.')
  expect((rights as HTMLInputElement).checked).toBe(false)
})

it('creates a private work through the API and shows its editor', async()=>{
  const calls = vi.fn().mockResolvedValueOnce(new Response('[]')).mockResolvedValueOnce(new Response(JSON.stringify({id:'w1',title:'별의 기록',summary:'',visibility:'private',allowFork:false,source:null,episodes:[],draft:{title:'새 회차',body:'',revision:0}})))
  render(<EpisodePage useCase={new EpisodeUseCase(new HttpEpisodeRepository(calls))}/> )
  await screen.findByText('첫 이야기를 시작해 보세요')
  fireEvent.change(screen.getByLabelText('작품 제목'),{target:{value:'별의 기록'}})
  fireEvent.click(screen.getByRole('button',{name:'작품 만들기'}))
  await waitFor(()=>expect(screen.getByLabelText('원고 본문')).toBeTruthy())
  expect(calls.mock.calls[1][0]).toBe('/api/v1/works')
})

it('does not reuse the previous cover when creating another work',async()=>{
  const first={id:'11111111-1111-4111-8111-111111111111',title:'첫 작품',summary:'',visibility:'private',allowFork:false,source:null,episodes:[],draft:{title:'새 회차',body:'',revision:0}}
  const second={...first,id:'22222222-2222-4222-8222-222222222222',title:'두 번째 작품'}
  const calls=vi.fn().mockResolvedValueOnce(new Response('[]')).mockResolvedValueOnce(Response.json(first)).mockResolvedValueOnce(Response.json(second))
  const uploads=vi.fn(async (path:string,init:RequestInit)=>{
    expect((init.body as FormData).get('file')).toBeInstanceOf(File)
    return Response.json({id:'33333333-3333-4333-8333-333333333333',filename:'first.png',mediaType:'image/png',kind:'IMAGE',byteSize:3,createdAt:'2026-11-03T00:00:00Z',url:`${path}/content`})
  })
  vi.stubGlobal('fetch',vi.fn(async (path:string,init?:RequestInit)=>path.endsWith('/csrf')?Response.json({csrfToken:'content-csrf'}):init?.method==='PUT'?uploads(path,init):new Response(null,{status:404})))
  render(<EpisodePage useCase={new EpisodeUseCase(new HttpEpisodeRepository(calls))}/>)
  await screen.findByText('첫 이야기를 시작해 보세요')
  fireEvent.change(screen.getByLabelText('작품 제목'),{target:{value:first.title}})
  fireEvent.change(screen.getByLabelText('작품 표지 (선택)'),{target:{files:[new File(['png'],'first.png',{type:'image/png'})]}})
  fireEvent.click(screen.getByRole('button',{name:'작품 만들기'}))
  await screen.findByText('비공개 작품과 표지를 저장했어요.')
  expect(uploads).toHaveBeenCalledTimes(1)
  expect(uploads.mock.calls[0][0]).toBe(`/api/v1/works/${first.id}/cover`)
  fireEvent.click(screen.getByRole('button',{name:'＋ 새 작품'}))
  fireEvent.change(screen.getByLabelText('작품 제목'),{target:{value:second.title}})
  fireEvent.click(screen.getByRole('button',{name:'작품 만들기'}))
  await screen.findByRole('heading',{name:second.title})
  await waitFor(()=>expect((screen.getByRole('button',{name:'＋ 새 작품'}) as HTMLButtonElement).disabled).toBe(false))
  expect(uploads).toHaveBeenCalledTimes(1)
  expect(screen.getByText('비공개 작품을 만들었어요. 첫 회차를 작성해 보세요.')).toBeTruthy()
})

it('keeps current tab when unsaved navigation is cancelled',async()=>{
  const w={id:'w',title:'이동 취소',summary:'',visibility:'private',allowFork:false,source:null,episodes:[],draft:{title:'회차',body:'기존',revision:0}}
  const fetcher=vi.fn().mockResolvedValue(new Response(JSON.stringify([w])))
  render(<EpisodePage useCase={new EpisodeUseCase(new HttpEpisodeRepository(fetcher))}/> )
  fireEvent.click(await screen.findByRole('button',{name:/이동 취소/}))
  fireEvent.change(screen.getByLabelText('원고 본문'),{target:{value:'미저장 편집'}})
  fireEvent.click(screen.getByRole('button',{name:'공개 원고 · 0'}))
  const confirm=vi.spyOn(window,'confirm').mockReturnValue(false)
  fireEvent.click(screen.getByRole('button',{name:'＋ 새 작품'}))
  expect(screen.getByRole('button',{name:'공개 원고 · 0'}).getAttribute('aria-current')).toBe('page')
  confirm.mockRestore()
})

it('shows independent fork publication consent and history navigation',async()=>{
 const w={id:'w',title:'권한 분리',summary:'',visibility:'private',allowFork:false,source:null,episodes:[],draft:{title:'회차',body:'본문',revision:0}}
 render(<EpisodePage useCase={new EpisodeUseCase(new HttpEpisodeRepository(vi.fn().mockResolvedValue(new Response(JSON.stringify([w])))))}/> )
 fireEvent.click(await screen.findByRole('button',{name:/권한 분리/}))
 expect(screen.getByLabelText('분기 작품의 최초 공개를 허용합니다.')).toBeTruthy()
 expect(screen.getByRole('button',{name:'저장·AI 이력'})).toBeTruthy()
})

it('opens restored text in the editor as a new saved version',async()=>{
 const w={id:'w',title:'복원 확인',summary:'',visibility:'private',allowFork:false,source:null,episodes:[],draft:{title:'회차',body:'현재',revision:2}}
 const v={id:'v1',title:'회차',body:'과거 원고',revision:1,episode:1,savedAt:'2026-11-02T00:00:00Z'}
 const fetcher=vi.fn().mockResolvedValueOnce(new Response(JSON.stringify([w]))).mockResolvedValueOnce(new Response(JSON.stringify({versions:[v],proposals:[]}))).mockResolvedValueOnce(new Response(JSON.stringify({...v,revision:3})))
 render(<EpisodePage useCase={new EpisodeUseCase(new HttpEpisodeRepository(fetcher))}/> )
 fireEvent.click(await screen.findByRole('button',{name:/복원 확인/}))
 fireEvent.click(screen.getByRole('button',{name:'저장·AI 이력'}))
 fireEvent.click(await screen.findByRole('button',{name:'이 원고를 새 버전으로 복원'}))
 await screen.findByText('과거 원고를 새 버전으로 저장했어요. 공개본은 변경되지 않았어요.')
 expect((screen.getByLabelText('원고 본문') as HTMLTextAreaElement).value).toBe('과거 원고')
})

it('shows the server authentication error instead of claiming the server is offline',async()=>{
 const calls=vi.fn().mockResolvedValue(new Response(JSON.stringify({detail:'서버 인증이 필요합니다.'}),{status:401}))
 render(<EpisodePage useCase={new EpisodeUseCase(new HttpEpisodeRepository(calls))}/>)
 expect(await screen.findByText('서버 인증이 필요합니다. 로그인한 뒤 다시 시도해 주세요.')).toBeTruthy()
 expect(calls).toHaveBeenCalledTimes(2)
 expect(screen.queryByText('Core 서버에 연결하지 못했어요. 서버를 실행한 뒤 새로고침해 주세요.')).toBeNull()
})


it('shows a creation link instead of save and AI controls when the writing episode is missing',async()=>{
 const w={id:'w',title:'회차 삭제됨',summary:'',visibility:'private',allowFork:false,source:null,episodes:[],draft:{title:'새 회차',body:'',revision:4},hasWritingEpisode:false}
 render(<EpisodePage useCase={new EpisodeUseCase(new HttpEpisodeRepository(vi.fn().mockResolvedValue(Response.json([w]))))}/>)
 fireEvent.click(await screen.findByRole('button',{name:/회차 삭제됨/}))
 expect(screen.getByRole('link',{name:'집필실에서 회차 생성'}).getAttribute('href')).toBe('/studio/w')
 expect(screen.queryByRole('button',{name:'원고 저장'})).toBeNull()
 expect(screen.queryByRole('textbox',{name:'원고 본문'})).toBeNull()
})

// @vitest-environment jsdom
import {render,screen,fireEvent,waitFor,cleanup} from '@testing-library/react'
import {MemoryRouter} from 'react-router'
import {afterEach,it,expect,vi} from 'vitest'
import {ManuscriptBuildPanel} from './ManuscriptBuildPanel'
afterEach(cleanup)
it('다른 작품으로 이동하면 이전 결과와 시작 동의를 지우고 새 조회를 기다린다',async()=>{
 const api={read:vi.fn().mockResolvedValueOnce(null).mockImplementationOnce(()=>new Promise(()=>{})),start:vi.fn(),resume:vi.fn()}
 const view=render(<MemoryRouter><ManuscriptBuildPanel work={{id:crypto.randomUUID(),worldStudioId:null,episodes:[]}} useCase={api as never}/></MemoryRouter>)
 await waitFor(()=>expect(api.read).toHaveBeenCalledTimes(1))
 fireEvent.click(screen.getByRole('checkbox'))
 await waitFor(()=>expect((screen.getByRole('button',{name:'세계관 만들기'}) as HTMLButtonElement).disabled).toBe(false))
 view.rerender(<MemoryRouter><ManuscriptBuildPanel work={{id:crypto.randomUUID(),worldStudioId:null,episodes:[]}} useCase={api as never}/></MemoryRouter>)
 await waitFor(()=>expect(api.read).toHaveBeenCalledTimes(2))
 expect((screen.getByRole('checkbox') as HTMLInputElement).checked).toBe(false)
 expect((screen.getByRole('button',{name:'세계관 만들기'}) as HTMLButtonElement).disabled).toBe(true)
 expect(api.start).not.toHaveBeenCalled()
})
const work={id:crypto.randomUUID(),worldStudioId:null,episodes:[{number:1}]} as never
const job={jobId:crypto.randomUUID(),worldId:crypto.randomUUID(),status:'running',completedEpisodes:0,totalEpisodes:4,executionToken:crypto.randomUUID(),failureCode:null,receipts:[]}
it('화면 진입과 업로드만으로 시작하지 않으며 동의 후 명시적으로 접수한다',async()=>{
 const api={read:vi.fn().mockResolvedValue(null),start:vi.fn().mockResolvedValue(job),resume:vi.fn()}
 render(<MemoryRouter><ManuscriptBuildPanel work={work} useCase={api as never}/></MemoryRouter>)
 await screen.findByText('저장된 원고로 비공개 세계관 초안을 만들어요.')
 expect(api.start).not.toHaveBeenCalled()
 expect((screen.getByRole('button',{name:'세계관 만들기'}) as HTMLButtonElement).disabled).toBe(true)
 fireEvent.click(screen.getByRole('checkbox'))
 fireEvent.click(screen.getByRole('button',{name:'세계관 만들기'}))
 await screen.findByText('원고를 분석하고 있어요')
 expect(api.start).toHaveBeenCalledTimes(1)
})
it('실패 이유와 동일 작업 재개를 표시하고 완료 후 기존 작업실을 연다',async()=>{
 const done={...job,status:'completed',completedEpisodes:4,receipts:[{}]}
 const api={read:vi.fn().mockResolvedValue({...job,status:'failed',failureCode:'AI_TIMEOUT'}),start:vi.fn(),resume:vi.fn().mockResolvedValue(done)}
 render(<MemoryRouter><ManuscriptBuildPanel work={work} useCase={api as never}/></MemoryRouter>)
 await screen.findByText(/시간 안에 분석 응답/)
 fireEvent.click(screen.getByRole('button',{name:'같은 작업 재개'}))
 await waitFor(()=>expect(screen.getByRole('link',{name:'세계관 초안 열기'}).getAttribute('href')).toBe('/worldstudio/'+job.worldId))
 expect(api.start).not.toHaveBeenCalled()
 expect(screen.getByText(/초안 생성만으로 확정하거나 공개하지/)).toBeTruthy()
})
it('조회 실패를 새 작업 없음으로 취급하지 않는다',async()=>{
 const api={read:vi.fn().mockRejectedValue(new Error('연결 끊김')),start:vi.fn(),resume:vi.fn()}
 render(<MemoryRouter><ManuscriptBuildPanel work={work} useCase={api as never}/></MemoryRouter>)
 await screen.findByRole('alert')
 expect((screen.getByRole('button',{name:'세계관 만들기'}) as HTMLButtonElement).disabled).toBe(true)
})
it('비공개 업로드 회차가 공개 회차 목록에 없어도 명시적으로 최초 구축을 요청한다',async()=>{
 const api={read:vi.fn().mockResolvedValue(null),start:vi.fn().mockResolvedValue(job),resume:vi.fn()}
 render(<MemoryRouter><ManuscriptBuildPanel work={{id:crypto.randomUUID(),worldStudioId:null,episodes:[]}} useCase={api as never}/></MemoryRouter>)
 await waitFor(()=>expect(api.read).toHaveBeenCalled())
 fireEvent.click(screen.getByRole('checkbox'))
 await waitFor(()=>expect((screen.getByRole('button',{name:'세계관 만들기'}) as HTMLButtonElement).disabled).toBe(false))
 fireEvent.click(screen.getByRole('button',{name:'세계관 만들기'}))
 await screen.findByText('원고를 분석하고 있어요')
 expect(api.start).toHaveBeenCalledTimes(1)
})

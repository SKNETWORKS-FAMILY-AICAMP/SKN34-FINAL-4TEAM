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
const job={jobId:crypto.randomUUID(),worldId:crypto.randomUUID(),status:'running',completedEpisodes:0,totalEpisodes:4,executionToken:crypto.randomUUID(),failureCode:null,skippedItems:0,receipts:[]}
const show=(api:object,w:object=work)=>render(<MemoryRouter><ManuscriptBuildPanel work={w as never} useCase={api as never}/></MemoryRouter>)
it('화면 진입만으로 시작하지 않으며 동의 후 명시적으로 접수한다',async()=>{
 const api={read:vi.fn().mockResolvedValue(null),start:vi.fn().mockResolvedValue(job),resume:vi.fn()}
 render(<MemoryRouter><ManuscriptBuildPanel work={work} useCase={api as never}/></MemoryRouter>)
 await screen.findByText('저장된 원고(비공개 포함)로 비공개 세계관 초안을 만들어요.')
 expect(api.start).not.toHaveBeenCalled()
 expect((screen.getByRole('button',{name:'세계관 만들기'}) as HTMLButtonElement).disabled).toBe(true)
 fireEvent.click(screen.getByRole('checkbox'))
 fireEvent.click(screen.getByRole('button',{name:'세계관 만들기'}))
 await screen.findByText('원고를 분석하고 있어요')
 expect(api.start).toHaveBeenCalledTimes(1)
})
it('안내는 첫 문장(비공개 원고 포함)과 보조색 세부 문단뿐이고, 버튼 아래 반복 안내는 없다',async()=>{
 show({read:vi.fn().mockResolvedValue(null),start:vi.fn(),resume:vi.fn()})
 await screen.findByText('저장된 원고(비공개 포함)로 비공개 세계관 초안을 만들어요.')
 expect(screen.getByText(/최초 구축을 마친 뒤 새 회차를 처음 발행하면, 세계관 초안 업데이트를 자동으로 요청해요\./).className).toBe('ep-muted')
 expect(screen.queryByText(/서버에서 저장된 원고가 있는지/)).toBeNull()
 expect(screen.queryByText(/저장된 비공개 원고도 대상이에요/)).toBeNull()
 expect(screen.queryByText(/새 회차도 자동 반영하지 않아요/)).toBeNull()
 expect(screen.getByText(/기존 카드가 있는 세계관은 자동으로 합치지 않아요/).className).toBe('ep-muted')
})
it('실패 이유와 동일 작업 재개를 표시하고 완료 후 기존 작업실을 연다',async()=>{
 const done={...job,status:'completed',completedEpisodes:4,receipts:[{}]}
 const api={read:vi.fn().mockResolvedValue({...job,status:'failed',failureCode:'AI_TIMEOUT'}),start:vi.fn(),resume:vi.fn().mockResolvedValue(done)}
 render(<MemoryRouter><ManuscriptBuildPanel work={work} useCase={api as never}/></MemoryRouter>)
 await screen.findByText(/분석 응답 대기 시간이 초과됐어요/)
 expect(screen.getByText(/저장된 추출 결과를 이어서 사용/)).toBeTruthy()
 expect(api.resume).not.toHaveBeenCalled()
 fireEvent.click(screen.getByRole('button',{name:'같은 작업 재개'}))
 expect(api.resume).toHaveBeenCalledTimes(1)
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
it('실패하면 같은 작업 재개와 함께 동의한 뒤 새로 시작할 수 있다',async()=>{
 const failed={...job,status:'failed',failureCode:'SOURCE_CHANGED'}
 const api={read:vi.fn().mockResolvedValue(failed),start:vi.fn().mockResolvedValue(job),resume:vi.fn()}
 show(api)
 await screen.findByText(/저장된 원고가 바뀌었어요/)
 expect(screen.getByRole('button',{name:'같은 작업 재개'})).toBeTruthy()
 expect((screen.getByRole('button',{name:'새로 시작'}) as HTMLButtonElement).disabled).toBe(true)
 fireEvent.click(screen.getByRole('checkbox'))
 await waitFor(()=>expect((screen.getByRole('button',{name:'새로 시작'}) as HTMLButtonElement).disabled).toBe(false))
 fireEvent.click(screen.getByRole('button',{name:'새로 시작'}))
 await screen.findByText('원고를 분석하고 있어요')
 expect(api.start).toHaveBeenCalledWith(expect.any(String),failed.worldId,true,expect.anything(),true)
 expect(api.resume).not.toHaveBeenCalled()
})
it('새로 시작은 지금 작품에 연결된 세계관이 있으면 그 세계관으로 접수한다',async()=>{
 const linked=crypto.randomUUID()
 const api={read:vi.fn().mockResolvedValue({...job,status:'failed',failureCode:'WORLD_LINK_CHANGED'}),start:vi.fn().mockResolvedValue(job),resume:vi.fn()}
 show(api,{id:crypto.randomUUID(),worldStudioId:linked,episodes:[]})
 await screen.findByText(/세계관 연결이 바뀌었어요/)
 fireEvent.click(screen.getByRole('checkbox'))
 await waitFor(()=>expect((screen.getByRole('button',{name:'새로 시작'}) as HTMLButtonElement).disabled).toBe(false))
 fireEvent.click(screen.getByRole('button',{name:'새로 시작'}))
 await screen.findByText('원고를 분석하고 있어요')
 expect(api.start).toHaveBeenCalledWith(expect.any(String),linked,true,expect.anything(),true)
})
it('실패가 아닌 작업에는 새로 시작과 동의를 보이지 않는다',async()=>{
 show({read:vi.fn().mockResolvedValue({...job,status:'unknown'}),start:vi.fn(),resume:vi.fn()})
 await screen.findByRole('button',{name:'같은 작업 재개'})
 expect(screen.queryByRole('button',{name:'새로 시작'})).toBeNull()
 expect(screen.queryByRole('checkbox')).toBeNull()
})
it('접수할 때 한 동의는 나중에 실패한 뒤의 새로 시작에 이어지지 않는다',async()=>{
 const api={read:vi.fn().mockResolvedValueOnce(null).mockResolvedValue({...job,status:'failed',failureCode:'AI_TIMEOUT'}),start:vi.fn().mockResolvedValue(job),resume:vi.fn()}
 show(api)
 await waitFor(()=>expect(api.read).toHaveBeenCalledTimes(1))
 fireEvent.click(screen.getByRole('checkbox'))
 await waitFor(()=>expect((screen.getByRole('button',{name:'세계관 만들기'}) as HTMLButtonElement).disabled).toBe(false))
 fireEvent.click(screen.getByRole('button',{name:'세계관 만들기'}))
 await screen.findByText('원고를 분석하고 있어요')
 const fresh=await screen.findByRole('button',{name:'새로 시작'},{timeout:4000})
 expect((screen.getByRole('checkbox') as HTMLInputElement).checked).toBe(false)
 expect((fresh as HTMLButtonElement).disabled).toBe(true)
},10000)
it.each([
 ['AI_REQUEST_REJECTED',/분석 요청이 받아들여지지 않았어요/],
 ['AI_RESPONSE_UNCONFIRMED',/분석 응답을 확인하지 못했어요/],
 ['CONTENT_REJECTED',/서버가 분석 결과를 받아들이지 않았어요/],
 ['NO_SETTINGS_FOUND',/설정을 찾지 못했어요/],
 ['WORLD_CHANGED',/세계관이 바뀌어 초안을 넣지 않았어요/],
 ['EXECUTION_EXPIRED',/실행 기한이 지났어요/],
])('%s 실패 사유를 정해진 한국어 문구로 알린다',async(code,text)=>{
 show({read:vi.fn().mockResolvedValue({...job,status:'failed',failureCode:code}),start:vi.fn(),resume:vi.fn()})
 await screen.findByText(text)
 expect(screen.queryByText(/원고와 작업 상태를 확인해 주세요/)).toBeNull()
})
it('완료 화면에 초안에 넣지 않은 항목 수를 알린다',async()=>{
 show({read:vi.fn().mockResolvedValue({...job,status:'completed',completedEpisodes:4,receipts:[{}],skippedItems:3}),start:vi.fn(),resume:vi.fn()})
 await screen.findByText('항목 3개를 초안에 넣지 않았어요.')
})
it('넣지 않은 항목이 없으면 그 안내를 보이지 않는다',async()=>{
 show({read:vi.fn().mockResolvedValue({...job,status:'completed',completedEpisodes:4,receipts:[{}]}),start:vi.fn(),resume:vi.fn()})
 await screen.findByRole('link',{name:'세계관 초안 열기'})
 expect(screen.queryByText(/항목 \d+개를 초안에 넣지 않았어요/)).toBeNull()
})
it('자동 상태 조회는 상태 문구를 깜빡이거나 버튼을 잠그지 않는다',async()=>{
 const api={read:vi.fn().mockResolvedValueOnce({...job,status:'queued'}).mockImplementation(()=>new Promise(()=>{})),start:vi.fn(),resume:vi.fn()}
 show(api)
 await screen.findByText('분석을 준비하고 있어요')
 await waitFor(()=>expect(api.read).toHaveBeenCalledTimes(2),{timeout:4000})
 await new Promise(r=>setTimeout(r,100))
 expect(screen.queryByText('작업 상태를 확인하고 있어요…')).toBeNull()
 expect((screen.getByRole('button',{name:'작업 상태 다시 확인'}) as HTMLButtonElement).disabled).toBe(false)
 expect((screen.getByRole('button',{name:'같은 작업 재개'}) as HTMLButtonElement).disabled).toBe(false)
},10000)
it('자동 조회가 진행 중일 때 누른 버튼은 그 조회를 중단시키고 바로 실행된다',async()=>{
 const api={read:vi.fn().mockResolvedValueOnce({...job,status:'queued'}).mockImplementation(()=>new Promise(()=>{})),start:vi.fn(),resume:vi.fn().mockResolvedValue(job)}
 show(api)
 await waitFor(()=>expect(api.read).toHaveBeenCalledTimes(2),{timeout:4000})
 fireEvent.click(screen.getByRole('button',{name:'같은 작업 재개'}))
 await screen.findByText('원고를 분석하고 있어요')
 expect(api.resume).toHaveBeenCalledTimes(1)
 expect(api.read.mock.calls[1][1].aborted).toBe(true)
},10000)
// 최초 구축이 끝났어도 발행 회차 업데이트가 진행 중인 동안은 같은 2초 조회를 이어 가고, 업데이트가 끝나면 멈춘다(공개 회차 머리 배지가 이 조회를 쓴다).
it('발행 회차 업데이트가 진행 중이면 2초마다 다시 읽고, 끝난 응답을 받으면 더는 읽지 않는다',async()=>{
  const done={...job,status:'completed',completedEpisodes:4,receipts:[{}]},update=(state:string)=>({jobId:crypto.randomUUID(),status:state,episodes:[5],failureCode:null})
  const api={read:vi.fn().mockResolvedValueOnce({...done,update:update('running')}).mockResolvedValue({...done,update:update('completed')}),start:vi.fn(),resume:vi.fn()}
  show(api)
  await screen.findByRole('link',{name:'세계관 초안 열기'})
  await waitFor(()=>expect(api.read).toHaveBeenCalledTimes(2),{timeout:4000})
  await new Promise(r=>setTimeout(r,2600))
  expect(api.read).toHaveBeenCalledTimes(2)
},12000)

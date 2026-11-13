// @vitest-environment jsdom
import {act,cleanup,renderHook,waitFor} from '@testing-library/react'
import {afterEach,expect,it,vi} from 'vitest'
import type {WorldStudioRepository} from '../../../../domain/repositories/WorldStudioRepository'
import {MemoryRouter,Route,Routes} from 'react-router'
import {useState,type ReactNode} from 'react'
import {RestoreContext} from '../../../shared/session/restoreContext'
import {SessionExpired} from '../../../../domain/repositories/ProfileRepository'
import {useWorldStudioViewModel} from './useWorldStudioViewModel'
import {WorldStudioUseCase} from '../../../../domain/usecases/WorldStudioUseCase'
import {InMemoryWorldStudioRepository} from '../../../../data/world-studio/InMemoryWorldStudioRepository'
import {newSetting} from '../../../../domain/entities/studioWorld'
import {putRelation} from '../../../../domain/entities/studioRelations'
import {EpisodeWorldRepository} from '../../../../test/episodeWorldRepository'
afterEach(cleanup)
it.each([false,true])('waits for session restoration before loading world list and detail (denied=%s)',async denied=>{
 const repository:WorldStudioRepository=new InMemoryWorldStudioRepository(),useCase=new WorldStudioUseCase(repository)
 const world=await useCase.create('세계','')
 const list=vi.spyOn(repository,'listStudio'),read=vi.spyOn(repository,'read')
 let finishRestore!:()=>void
 function Wrapper({children}:{children:ReactNode}) {
  const [restoring,setRestoring]=useState(true)
  finishRestore=()=>setRestoring(false)
  return <RestoreContext.Provider value={restoring}><MemoryRouter initialEntries={['/worldstudio/'+world.id]}><Routes><Route path="/worldstudio/:worldId" element={children}/></Routes></MemoryRouter></RestoreContext.Provider>
 }
 const {result}=renderHook(()=>useWorldStudioViewModel(useCase),{wrapper:Wrapper})
 expect(list).not.toHaveBeenCalled();expect(read).not.toHaveBeenCalled()
 expect(result.current.busy).toBe(true);expect(result.current.error).toBe('');expect(result.current.editing).toBeNull()
 if(denied){list.mockRejectedValue(new SessionExpired('서버 로그인이 필요합니다.'));read.mockRejectedValue(new SessionExpired('서버 로그인이 필요합니다.'))}
 act(()=>finishRestore())
 await waitFor(()=>expect(result.current.busy).toBe(false))
 expect(list).toHaveBeenCalledTimes(1);expect(read).toHaveBeenCalledWith(world.id,expect.any(AbortSignal),undefined)
 if(denied){expect(result.current.error).toContain('서버 로그인이 필요합니다.');expect(result.current.editing).toBeNull()}
 else {expect(result.current.editing?.id).toBe(world.id);expect(result.current.error).toBe('')}
})
it('cancels an outstanding save on leaving without installing its late result',async()=>{
 const repository:WorldStudioRepository=new InMemoryWorldStudioRepository(),useCase=new WorldStudioUseCase(repository)
 const world=await useCase.create('세계','')
 let signal:AbortSignal|undefined
 vi.spyOn(repository,'saveStudio').mockImplementation((_world,requestSignal)=>{signal=requestSignal;return new Promise((_resolve,reject)=>requestSignal?.addEventListener('abort',()=>reject(new DOMException('Aborted','AbortError'))))})
 const wrapper=({children}:{children:ReactNode})=><MemoryRouter initialEntries={['/worldstudio/'+world.id]}><Routes><Route path="/worldstudio/:worldId" element={children}/></Routes></MemoryRouter>
 const {result,unmount}=renderHook(()=>useWorldStudioViewModel(useCase),{wrapper})
 await waitFor(()=>expect(result.current.editing?.id).toBe(world.id))
 let request:Promise<void>|undefined
 act(()=>{request=result.current.save()})
 await waitFor(()=>expect(signal).toBeDefined())
 unmount();expect(signal?.aborted).toBe(true);await request
})
it('opens a world, adds and edits a card without touching server state',async()=>{
 const useCase=new WorldStudioUseCase(new InMemoryWorldStudioRepository())
 const world=await useCase.create('세계','')
 const wrapper=({children}:{children:ReactNode})=><MemoryRouter initialEntries={['/worldstudio/'+world.id]}><Routes><Route path="/worldstudio/:worldId" element={children}/></Routes></MemoryRouter>
 const {result}=renderHook(()=>useWorldStudioViewModel(useCase),{wrapper})
 await waitFor(()=>expect(result.current.editing?.id).toBe(world.id))
 let id=''
 act(()=>{id=result.current.addCard('object')??''})
 expect(id).not.toBe('') // 카드만 초안에 더하고 편집 화면은 부르는 쪽이 editCard로 연다
 act(()=>result.current.update(id,{title:'열쇠',text:'문을 연다'},{aliases:['금빛 열쇠'],tags:['보물']}))
 await act(()=>result.current.save())
 expect((await useCase.read(world.id)).settings[0]).toMatchObject({aliases:['금빛 열쇠'],tags:['보물'],item:{title:'열쇠',entityType:'object'}})
 expect(result.current.dirty).toBe(false)
})

it('keeps the person undo and prior edits after a rejected server save',async()=>{
 const repository=new InMemoryWorldStudioRepository(),useCase=new WorldStudioUseCase(repository)
 const world=await useCase.create('세계',''),a=newSetting('people'),b=newSetting('people')
 a.item.title='가람';b.item.title='나래'
 world.settings=putRelation([a,b],{subjectId:a.item.id,targetId:b.item.id,predicate:'custom_relation',text:'친구',polarity:'asserted'})
 await useCase.save(world)
 const wrapper=({children}:{children:ReactNode})=><MemoryRouter initialEntries={['/worldstudio/'+world.id]}><Routes><Route path="/worldstudio/:worldId" element={children}/></Routes></MemoryRouter>
 const {result}=renderHook(()=>useWorldStudioViewModel(useCase),{wrapper})
 await waitFor(()=>expect(result.current.editing?.id).toBe(world.id))
 act(()=>result.current.patch({description:'이전에 쓴 설명'}))
 act(()=>{result.current.deleteCard(a.item.id)})
 expect(result.current.canUndoCardDeletion).toBe(true)
 vi.spyOn(repository,'saveStudio').mockRejectedValueOnce(new Error('저장 실패'))
 await act(()=>result.current.save())
 expect(result.current.saveState).toBe('failed')
 expect(result.current.saved?.settings).toEqual(world.settings)
 expect(result.current.canUndoCardDeletion).toBe(true)
 act(()=>{result.current.undoCardDeletion()})
 expect(result.current.editing?.settings.map(s=>s.item.id)).toEqual(world.settings.map(s=>s.item.id))
 expect(result.current.editing?.description).toBe('이전에 쓴 설명')
 expect(result.current.dirty).toBe(true)
})

// ── 관계 기준 회차(DEC-51): 고른 회차 시점의 관계로 다시 읽고, 그 회차로 저장한다 ───
/** 소설이 연결된 세계관: 1화에는 관계가 없고 2화(최신)에 가람과 나래의 친구 관계가 있다. `supported`가 false면 회차를 모르는 메모리 데모다. */
async function openEpisodeStudio({linked=true,supported=true}={}){
 const a=newSetting('people'),b=newSetting('people');a.item.title='가람';b.item.title='나래'
 const settings=putRelation([a,b],{subjectId:a.item.id,targetId:b.item.id,predicate:'friend_of',polarity:'asserted'})
 const repository=supported?new EpisodeWorldRepository():new InMemoryWorldStudioRepository(),useCase=new WorldStudioUseCase(repository)
 const world=await useCase.create('세계','')
 await useCase.save({...world,settings,linkedWorkId:linked?'work-1':null})
 if(repository instanceof EpisodeWorldRepository)repository.relations={1:[],2:settings.filter(s=>s.item.kind==='relation')}
 const wrapper=({children}:{children:ReactNode})=><MemoryRouter initialEntries={['/worldstudio/'+world.id]}><Routes><Route path="/worldstudio/:worldId" element={children}/></Routes></MemoryRouter>
 const {result}=renderHook(()=>useWorldStudioViewModel(useCase),{wrapper})
 await waitFor(()=>expect(result.current.editing?.id).toBe(world.id))
 return {result,repository,id:world.id}
}
const relationCount=(vm:ReturnType<typeof useWorldStudioViewModel>)=>vm.editing!.settings.filter(s=>s.item.kind==='relation').length
it.each([['데모에서는 지원하지 않아요.',{supported:false}],['소설을 연결하면 회차별로 기록할 수 있어요.',{linked:false}]] as const)('locks the relation episode with its reason (%s) and never reads another episode',async(reason,options)=>{
 const {result,repository}=await openEpisodeStudio(options)
 expect(result.current.episodeLock).toBe(reason)
 const read=vi.spyOn(repository,'read')
 await act(async()=>{await result.current.selectEpisode(1)})
 expect(read).not.toHaveBeenCalled();expect(result.current.episode).toBeNull()
})
it('locks the relation episode while changes are unsaved and unlocks it after saving',async()=>{
 const {result}=await openEpisodeStudio()
 expect(result.current.episodeLock).toBe('')
 act(()=>result.current.patch({description:'고친 설명'}))
 expect(result.current.episodeLock).toBe('저장하지 않은 변경이 있어 회차를 바꿀 수 없어요. 먼저 세계관을 저장하세요.')
 await act(()=>result.current.save())
 expect(result.current.episodeLock).toBe('')
})
it('reads the relations of the chosen episode, then returns to the latest ones without sending an episode',async()=>{
 const {result,repository,id}=await openEpisodeStudio()
 const read=vi.spyOn(repository,'read'),key=result.current.relationKey
 expect(relationCount(result.current)).toBe(1)
 await act(async()=>{await result.current.selectEpisode(1)})
 expect(read).toHaveBeenLastCalledWith(id,expect.any(AbortSignal),1)
 expect([result.current.episode,relationCount(result.current),result.current.dirty]).toEqual([1,0,false])
 expect(result.current.relationKey).toBe(key+1) // 관계 편집기를 새로 열어 옛 회차의 입력이 남지 않게 한다
 await act(async()=>{await result.current.selectEpisode(null)})
 expect(read).toHaveBeenLastCalledWith(id,expect.any(AbortSignal),undefined)
 expect([result.current.episode,relationCount(result.current)]).toEqual([null,1])
})
it('does not read again for the episode it already shows',async()=>{
 const {result,repository}=await openEpisodeStudio()
 const read=vi.spyOn(repository,'read')
 await act(async()=>{await result.current.selectEpisode(null)})
 expect(read).not.toHaveBeenCalled()
})
it('keeps the shown episode and its relations, and reports the error, when reading another episode fails',async()=>{
 const {result,repository}=await openEpisodeStudio()
 vi.spyOn(repository,'read').mockRejectedValueOnce(new Error('요청한 세계관과 관계 상태가 일치하지 않습니다.'))
 await act(async()=>{await result.current.selectEpisode(1)})
 expect(result.current.error).toContain('일치하지 않습니다')
 expect([result.current.episode,relationCount(result.current)]).toEqual([null,1])
})
it('saves at the chosen episode and omits the episode for the latest one',async()=>{
 const {result,repository,id}=await openEpisodeStudio()
 const save=vi.spyOn(repository,'saveStudio')
 await act(async()=>{await result.current.selectEpisode(1)})
 await act(()=>result.current.save())
 expect(save).toHaveBeenLastCalledWith(expect.objectContaining({id}),expect.any(AbortSignal),1)
 await act(async()=>{await result.current.selectEpisode(null)})
 await act(()=>result.current.save())
 expect(save).toHaveBeenLastCalledWith(expect.objectContaining({id}),expect.any(AbortSignal),undefined)
})
it('returns to the latest episode when the draft is reloaded after an AI or confirmation change',async()=>{
 const {result,repository,id}=await openEpisodeStudio()
 await act(async()=>{await result.current.selectEpisode(1)})
 const read=vi.spyOn(repository,'read')
 await act(async()=>{await result.current.reload()})
 expect(read).toHaveBeenLastCalledWith(id,undefined,undefined) // AI가 최신 회차에 더한 관계도 확인해야 하므로 회차 없이(최신) 읽는다
 expect([result.current.episode,relationCount(result.current)]).toEqual([null,1])
})
it('locks the relation episode while an AI review or confirmation request runs and says why',async()=>{
 const {result,repository}=await openEpisodeStudio()
 const read=vi.spyOn(repository,'read')
 act(()=>result.current.setReviewBusy(true))
 expect(result.current.episodeLock).toBe('AI 후보 검토·확정 버전 요청이 진행 중이라 회차를 바꿀 수 없어요.')
 await act(async()=>{await result.current.selectEpisode(1)})
 expect(read).not.toHaveBeenCalled()
 act(()=>result.current.setReviewBusy(false))
 expect(result.current.episodeLock).toBe('')
})
it('refuses to delete a setting while an episode is chosen, keeps the draft untouched and says why, then deletes again at the latest',async()=>{
 const {result}=await openEpisodeStudio()
 const person=result.current.editing!.settings[0].item.id,reason='설정 삭제는 최신 회차에서 할 수 있어요.'
 expect(result.current.deleteLock).toBe('')
 await act(async()=>{await result.current.selectEpisode(1)})
 expect(result.current.deleteLock).toBe(reason)
 let deleted=true
 act(()=>{deleted=result.current.deleteCard(person)})
 expect(deleted).toBe(false)
 expect(result.current.editing!.settings.some(s=>s.item.id===person)).toBe(true)
 expect([result.current.dirty,result.current.canUndoCardDeletion,result.current.error]).toEqual([false,false,reason])
 await act(async()=>{await result.current.selectEpisode(null)})
 expect(result.current.deleteLock).toBe('')
 act(()=>{deleted=result.current.deleteCard(person)})
 expect(deleted).toBe(true)
 expect(result.current.editing!.settings.some(s=>s.item.id===person)).toBe(false)
})

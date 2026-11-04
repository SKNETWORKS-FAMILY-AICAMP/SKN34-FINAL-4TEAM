import { useEffect, useRef, useState } from 'react'
import { appContainer } from '../../../../app/appContainer'
import type { Draft, Proposal, Work, History, Version, StoryContext } from '../../../../domain/entities/content'
import type { EpisodeUseCase } from '../../../../domain/usecases/EpisodeUseCase'
import {validateMediaFile,type MediaUseCase} from '../../../../domain/usecases/MediaUseCase'

export function useEpisodeViewModel(useCase: EpisodeUseCase = appContainer.resolve('episodeUseCase'), media:Pick<MediaUseCase,'upload'>=appContainer.resolve('mediaUseCase')) {
  const [publicWorks,setPublicWorks] = useState<Work[]>([])
  const [works,setWorks] = useState<Work[]>([])
  const [active,setActive] = useState<Work|null>(null)
  const [draft,setDraft] = useState<Draft>({title:'새 회차',body:'',revision:0})
  const [proposal,setProposal] = useState<Proposal|null>(null)
  const [history,setHistory] = useState<History|null>(null)
  const [storyContext,setStoryContext] = useState<StoryContext|null>(null)
  const [selectedVersion,setSelectedVersion] = useState<Version|null>(null)
  const [busy,setBusy] = useState(false)
  const [error,setError] = useState('')
  const [notice,setNotice] = useState('')
  const [ready,setReady] = useState(false)
  const [coverRevision,setCoverRevision] = useState(0)
  const alive = useRef(true)
  const inFlight = useRef(false)
  const request = useRef<AbortController|null>(null)
  const dirty = !!active && (draft.title !== active.draft.title || draft.body !== active.draft.body)
  const install = (w: Work) => { setActive(w); setDraft(w.draft); setProposal(null); setHistory(null);setStoryContext(null);setSelectedVersion(null); setWorks(list=>[w,...list.filter(x=>x.id!==w.id)]) }
  useEffect(()=>{
    alive.current=true
    const controller = new AbortController()
    useCase.list(controller.signal).then(list=>{if (!controller.signal.aborted) {setWorks(list);setReady(true)}}).catch((e:unknown)=>{if(!controller.signal.aborted) {setError(e instanceof Error?e.message:'Core 서버에 연결하지 못했어요. 서버를 실행한 뒤 새로고침해 주세요.');setReady(true)}})
    return ()=>{alive.current=false;controller.abort();request.current?.abort()}
  },[useCase])
  useEffect(()=>{
    const leave = (event: BeforeUnloadEvent) => { if(dirty) event.preventDefault() }
    window.addEventListener('beforeunload',leave)
    return ()=>window.removeEventListener('beforeunload',leave)
  },[dirty])
  const run = async (fn: ()=>Promise<void>) => {
    if(inFlight.current) return false
    inFlight.current=true;setBusy(true);setError('');setNotice('')
    try { await fn(); return alive.current } catch(e) { if(alive.current)setError(e instanceof Error ? e.message : '요청에 실패했어요. 다시 시도해 주세요.'); return false }
    finally { inFlight.current=false;if(alive.current)setBusy(false) }
  }
  const persist = async () => {
    if(!active) throw new Error('작품을 선택해 주세요.')
    if(!dirty) return draft
    if(active.hasWritingEpisode===false) throw new Error('집필실에서 작성할 회차를 먼저 생성해 주세요.')
    const saved = await useCase.save(active.id,draft)
    setDraft(saved);setActive({...active,draft:saved});setWorks(list=>list.map(w=>w.id===active.id?{...w,draft:saved}:w))
    return saved
  }
  return {works,publicWorks,active,draft,proposal,history,storyContext,selectedVersion,busy,error,notice,ready,dirty,coverRevision,
    browsePublic:()=>run(async()=>{setPublicWorks(await useCase.publicList())}),
    edit:(patch:Partial<Pick<Draft,'title'|'body'>>)=>{setStoryContext(null);setDraft(d=>({...d,...patch}));setProposal(null);setSelectedVersion(null);setNotice('')},
    select:(w:Work|null)=>{if(busy)return false;if(dirty&&!window.confirm('저장하지 않은 원고가 있어요. 이동할까요?'))return false;setActive(w);if(w)setDraft(w.draft);setProposal(null);setHistory(null);setSelectedVersion(null);setError('');setNotice('');return true},
    create:(title:string,summary:string,cover?:File)=>run(async()=>{
      if(cover)validateMediaFile(cover,true)
      const controller=new AbortController();request.current=controller
      const work=await useCase.create(title,summary,controller.signal)
      if(controller.signal.aborted)return
      install(work)
      if(cover){
        try{await media.upload({kind:'cover',workId:work.id},cover,undefined,controller.signal)}
        catch(e){if(controller.signal.aborted)return;throw new Error(`작품은 생성됐지만 표지 저장에 실패했어요. 작품을 다시 만들지 말고 아래 표지 선택·변경에서 재시도해 주세요. ${e instanceof Error?e.message:''}`)}
        if(controller.signal.aborted)return
        setCoverRevision(v=>v+1)
      }
      setNotice(cover?'비공개 작품과 표지를 저장했어요.':'비공개 작품을 만들었어요. 첫 회차를 작성해 보세요.')
    }),
    save:()=>run(async()=>{await persist();setNotice('서버에 원고를 저장했어요.')}),
    reload:()=>run(async()=>{if(dirty&&!window.confirm('저장하지 않은 편집을 버리고 서버 원고를 불러올까요?'))return;const list=await useCase.list();setWorks(list);const w=list.find(x=>x.id===active?.id);if(w)install(w);setNotice('최신 원고를 불러왔어요.')}),
    publish:(rights:boolean,allowFork:boolean,allowForkPublication:boolean)=>run(async()=>{if(!active)return;if(!selectedVersion)throw new Error('저장·AI 이력에서 공개할 저장 버전을 먼저 선택해 주세요.');const saved=await persist();install(await useCase.publish(active.id,selectedVersion?{...selectedVersion,revision:saved.revision}:saved,rights,allowFork,allowForkPublication,selectedVersion?.id));setNotice('회차를 공개했어요. 공개 원고에서 확인할 수 있어요.')}),
    loadHistory:()=>run(async()=>{if(active)setHistory(await useCase.history(active.id))}),
    chooseVersion:(v:Version)=>{setSelectedVersion(v);setNotice('선택한 저장 버전을 공개 대상으로 지정했어요. 현재 초안은 그대로예요.')},
    restore:async(v:Version)=>{if(!active||busy)return false;if(dirty&&!window.confirm('미저장 편집을 대신하여 이 버전을 새 저장본으로 복원할까요?'))return false;return run(async()=>{const saved=await useCase.save(active.id,{title:v.title,body:v.body,revision:draft.revision});install({...active,draft:saved});setNotice('과거 원고를 새 버전으로 저장했어요. 공개본은 변경되지 않았어요.')})},
    openProposal:(p:Proposal)=>{setProposal(p);setNotice('보관한 AI 제안을 열었어요.')},
    policy:(allowFork:boolean,allowForkPublication:boolean)=>run(async()=>{if(!active)return;const saved=await persist();install(await useCase.policy(active.id,saved.revision,allowFork,allowForkPublication));setNotice('분기 생성·공개 허용 설정을 저장했어요.')}),
    fork:(episode:number,title:string,direction:string)=>run(async()=>{if(!active)return;await persist();install(await useCase.fork(active.id,episode,title,direction));setNotice('선택한 회차에서 비공개 분기 작품을 만들었어요.')}),
    loadContext:(episode:number,prompt:string,character:string,publicView:boolean)=>run(async()=>{if(!active)return;await persist();setStoryContext(await useCase.context(active.id,episode,prompt,character,publicView));setNotice('회차 기준 문맥을 조회했어요. OpenAI는 호출하지 않았어요.')}),
    clearContext:()=>setStoryContext(null),
    propose:(prompt:string,consent:boolean,episode?:number,character='')=>run(async()=>{if(!active)return;if(active.hasWritingEpisode===false)throw new Error('집필실에서 작성할 회차를 먼저 생성해 주세요.');const saved=await persist();request.current=new AbortController();const p=await useCase.propose(active.id,saved,prompt,consent,request.current.signal,episode,character);setProposal(p);setStoryContext(p.context??null);setNotice('AI 제안이 도착했어요. 원고에는 아직 반영되지 않았어요.')}),
    accept:()=>run(async()=>{if(!active||!proposal)return;if(active.hasWritingEpisode===false)throw new Error('작성할 회차가 없어요. 집필실에서 회차를 생성해 주세요.');const saved=await useCase.accept(active.id,proposal.id,draft.revision);install({...active,draft:saved});setNotice('AI 제안을 원고에 적용하고 저장했어요. 공개는 별도예요.')}),
    discard:()=>{setProposal(null);setNotice('제안을 닫았어요. 원고는 변경하지 않았어요.')},
  }
}

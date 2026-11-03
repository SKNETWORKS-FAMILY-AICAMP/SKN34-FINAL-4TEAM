import { useEffect, useEffectEvent, useRef, useState } from 'react'
import { appContainer } from '../../../../app/appContainer'
import type { Draft, WritingEpisode } from '../../../../domain/entities/content'
import type { EpisodeUseCase } from '../../../../domain/usecases/EpisodeUseCase'

type WritingApi = Pick<EpisodeUseCase,'writingList'|'createEpisode'|'writeEpisode'|'restoreEpisode'|'publishEpisode'>
export function useWritingViewModel(id:string, api:WritingApi=appContainer.resolve('episodeUseCase')) {
  const [episodes,setEpisodes]=useState<WritingEpisode[]>([])
  const [active,setActive]=useState<WritingEpisode|null>(null)
  const [draft,setDraft]=useState<Draft>({title:'',body:'',revision:0})
  const [busy,setBusy]=useState(false)
  const [ready,setReady]=useState(false)
  const [error,setError]=useState('')
  const [notice,setNotice]=useState('')
  const current=useRef(draft)
  const pending=useRef<AbortController|null>(null)
  const dirty=!!active&&(draft.title!==active.draft.title||draft.body!==active.draft.body)
  const put=(d:Draft)=>{current.current=d;setDraft(d)}
  const install=(e:WritingEpisode)=>{setActive(e);put(e.draft);setNotice('');setError('')}
  useEffect(()=>{
    const controller=new AbortController()
    api.writingList(id,controller.signal).then(rows=>{
      if(controller.signal.aborted)return
      setEpisodes(rows);if(rows[0])install(rows[0]);setReady(true)
    }).catch((e:unknown)=>{if(!controller.signal.aborted){setError(e instanceof Error?e.message:'회차를 불러오지 못했어요.');setReady(true)}})
    return ()=>{controller.abort();pending.current?.abort()}
  },[id,api])
  useEffect(()=>{
    const leave=(e:BeforeUnloadEvent)=>{if(dirty||busy)e.preventDefault()}
    window.addEventListener('beforeunload',leave)
    return ()=>window.removeEventListener('beforeunload',leave)
  },[dirty,busy])
  const run=async(action:(signal:AbortSignal)=>Promise<void>)=>{
    if(pending.current)return false
    const controller=new AbortController();pending.current=controller;setBusy(true);setError('');setNotice('')
    try {await action(controller.signal);return !controller.signal.aborted}
    catch(e){if(!controller.signal.aborted)setError(e instanceof Error?e.message:'저장에 실패했어요. 입력은 화면에 남아 있어요.');return false}
    finally {if(pending.current===controller){pending.current=null;if(!controller.signal.aborted)setBusy(false)}}
  }
  const merge=(e:WritingEpisode)=>{setEpisodes(rows=>[...rows.filter(x=>x.number!==e.number),e].sort((a,b)=>a.number-b.number));setActive(e)}
  const save=(version=true)=>run(async signal=>{
    if(!active||active.inherited)return
    const sent=current.current
    const result=await api.writeEpisode(id,active.number,sent,version,signal)
    if(signal.aborted)return
    merge(result)
    // A response acknowledges the sent draft, never typing that happened while it was in flight.
    put(current.current.title===sent.title && current.current.body===sent.body ? result.draft : {...current.current,revision:result.draft.revision})
    setNotice(version?'새 원고 버전을 저장했어요. 발행본은 그대로예요.':'작업 초안을 저장했어요.')
  })
  const autoSave=useEffectEvent(()=>{void save(false)})
  useEffect(()=>{
    if(!dirty||busy||error||active?.inherited)return
    const timer=window.setTimeout(()=>autoSave(),2000)
    return ()=>window.clearTimeout(timer)
  },[draft,active,busy,error,dirty])
  const mayLeave=()=>!pending.current&&(!dirty||window.confirm('저장하지 않은 입력을 버리고 이동할까요?'))
  return {episodes,active,draft,busy,ready,error,notice,dirty,
    edit:(patch:Partial<Pick<Draft,'title'|'body'>>)=>{put({...current.current,...patch});setNotice('')},
    save:()=>save(true),
    select:(e:WritingEpisode)=>{if(mayLeave())install(e)},
    create:(title:string)=>{if(!mayLeave())return Promise.resolve(false);return run(async signal=>{const e=await api.createEpisode(id,title,signal);if(!signal.aborted){merge(e);put(e.draft);setNotice('비공개 회차를 만들었어요.')}})},
    reload:()=>{if(!mayLeave())return Promise.resolve(false);return run(async signal=>{const rows=await api.writingList(id,signal);if(!signal.aborted){setEpisodes(rows);const e=rows.find(x=>x.number===active?.number)??rows[0];if(e)install(e);setReady(true)}})},
    restore:(versionId:string)=>{if(!mayLeave())return Promise.resolve(false);return run(async signal=>{if(!active)return;const e=await api.restoreEpisode(id,active.number,current.current.revision,versionId,signal);if(!signal.aborted){merge(e);put(e.draft);setNotice('선택한 원고를 새 버전으로 복원했어요. 발행본은 그대로예요.')}})},
    publish:(versionId:string,rights:boolean)=>run(async signal=>{if(!active)return;const e=await api.publishEpisode(id,active.number,current.current.revision,versionId,rights,signal);if(!signal.aborted){merge(e);put({...current.current,revision:e.draft.revision});setNotice('선택한 저장 버전을 공개했어요.')}}),
  }
}

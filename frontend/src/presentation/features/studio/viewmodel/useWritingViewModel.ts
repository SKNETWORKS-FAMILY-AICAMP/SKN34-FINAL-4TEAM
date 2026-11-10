import { useEffect, useEffectEvent, useRef, useState } from 'react'
import { appContainer } from '../../../../app/appContainer'
import type { Draft, WritingEpisode, PublicationEvent } from '../../../../domain/entities/content'
import type { EpisodeUseCase } from '../../../../domain/usecases/EpisodeUseCase'
import type {MediaUseCase} from '../../../../domain/usecases/MediaUseCase'
import {imageMarker} from '../../../../domain/entities/media'

type WritingApi = Pick<EpisodeUseCase,'writingList'|'createEpisode'|'writeEpisode'|'restoreEpisode'|'publishEpisode'|'orderScope'|'deleteDraft'|'deleteEpisode'|'setPublicationVisibility'|'history'>
export function useWritingViewModel(id:string, api:WritingApi=appContainer.resolve('episodeUseCase'), media:Pick<MediaUseCase,'upload'>=appContainer.resolve('mediaUseCase')) {
  const [episodes,setEpisodes]=useState<WritingEpisode[]>([])
  const [active,setActive]=useState<WritingEpisode|null>(null)
  const [draft,setDraft]=useState<Draft>({title:'',body:'',revision:0})
  const [busy,setBusy]=useState(false)
  const [editingLocked,setEditingLocked]=useState(false)
  const [ready,setReady]=useState(false)
  const [error,setError]=useState('')
  const [notice,setNotice]=useState('')
  const [publicationHistory,setPublicationHistory]=useState<PublicationEvent[]|null>(null)
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
  const run=async(action:(signal:AbortSignal)=>Promise<void>,lockEditing=true)=>{
    if(pending.current)return false
    const controller=new AbortController();pending.current=controller;setBusy(true);setError('');setNotice('')
    setEditingLocked(lockEditing)
    try {await action(controller.signal);return !controller.signal.aborted}
    catch(e){if(!controller.signal.aborted)setError(e instanceof Error?e.message:'저장에 실패했어요. 입력은 화면에 남아 있어요.');return false}
    finally {if(pending.current===controller){pending.current=null;if(!controller.signal.aborted){setBusy(false);setEditingLocked(false)}}}
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
  },version)
  // 발행과 체크포인트 되돌리기는 같은 회차 발행 요청이다. 완료 안내만 다르고, 성공 표시는 실제 응답을 받은 뒤에만 한다.
  const publishVersion=(versionId:string,rights:boolean,done:string)=>run(async signal=>{if(!active)return;const e=await api.publishEpisode(id,active.number,current.current.revision,versionId,rights,signal);if(!signal.aborted){setPublicationHistory(null);merge(e);put({...current.current,revision:e.draft.revision});setNotice(done)}})
  const autoSave=useEffectEvent(()=>{void save(false)})
  useEffect(()=>{
    if(!dirty||busy||error||active?.inherited)return
    const timer=window.setTimeout(()=>autoSave(),2000)
    return ()=>window.clearTimeout(timer)
  },[draft,active,busy,error,dirty])
  const mayLeave=()=>!pending.current&&(!dirty||window.confirm('저장하지 않은 입력을 버리고 이동할까요?'))
  const remove=(whole:boolean)=>{
    if(!active||pending.current||active.inherited)return Promise.resolve(false)
    if(!window.confirm(whole?'회차를 DB에서 삭제할까요? 참조 없는 마지막 회차만 삭제하며 복구할 수 없어요.':'작업 초안을 삭제할까요? 저장 버전과 발행본은 보존하며, 저장하지 않은 입력은 사라져요.'))return Promise.resolve(false)
    return run(async signal=>{
      const removeAction=whole?api.deleteEpisode.bind(api):api.deleteDraft.bind(api)
      await removeAction(id,active.number,active.draft.revision,signal)
      if(signal.aborted)return
      // The deletion is committed: never retain a dirty buffer that could auto-save it back.
      setActive(null);put({title:'',body:'',revision:0});setEpisodes([])
      const rows=await api.writingList(id,signal)
      if(signal.aborted)return
      setEpisodes(rows)
      const next=rows.find(e=>e.number===active.number)??rows[0]
      if(next)install(next)
      setNotice(whole?'회차를 삭제했어요.':'작업 초안을 삭제했어요. 새로 입력하면 새 초안으로 저장돼요.')
    })
  }
  const changeVisibility=(visible:boolean,rights:boolean)=>{
    if(!active||active.inherited||dirty||pending.current)return Promise.resolve(false)
    if(!visible&&!window.confirm('이 회차의 공개를 중단할까요? 저장 버전과 기존 Fork는 보존돼요.'))return Promise.resolve(false)
    return run(async signal=>{
      const result=await api.setPublicationVisibility(id,active.number,current.current.revision,visible,rights,signal)
      if(signal.aborted)return
      setPublicationHistory(null);merge(result);put({...current.current,revision:result.draft.revision})
      setNotice(visible?'중단했던 발행본을 다시 공개했어요.':'회차 공개를 중단했어요.')
    })
  }
  return {publicationHistory,changeVisibility,
    loadPublicationHistory:()=>run(async signal=>{
      setPublicationHistory(null)
      const result=await api.history(id,signal)
      if(signal.aborted)return
      if(!result.publicationHistory)throw new Error('발행 이력 응답을 확인할 수 없어요.')
      setPublicationHistory(result.publicationHistory)
    },false),
    episodes,active,draft,busy,editingLocked,ready,error,notice,dirty,mayLeave,
    edit:(patch:Partial<Pick<Draft,'title'|'body'>>)=>{put({...current.current,...patch});setNotice('')},
    save:()=>save(true),
    deleteDraft:()=>remove(false),
    deleteEpisode:()=>remove(true),
    checkOrder:()=>run(async signal=>{
      if(!active)return
      const scope=await api.orderScope(id,active.number,signal)
      if(!signal.aborted)setNotice(`검토 후보 위치: ${scope.candidateNumbers.join(', ')||'없음'}. ${scope.reasons.join(' ')}`)
    }),
    select:(e:WritingEpisode)=>{if(!mayLeave())return false;install(e);return true},
    addImage:(file:File,start:number,end:number)=>run(async signal=>{
      if(!active||active.inherited)throw new Error('편집 가능한 내 회차를 선택해 주세요.')
      const sent=current.current
      const from=Math.max(0,Math.min(start,sent.body.length));const to=Math.max(from,Math.min(end,sent.body.length))
      if(sent.body.length-(to-from)+50>40000)throw new Error('이미지 참조를 넣을 공간이 부족해요. 원고를 40,000자 이내로 줄여 주세요.')
      const item=await media.upload({kind:'episode',workId:id,number:active.number},file,undefined,signal)
      if(signal.aborted)return
      put({...current.current,body:sent.body.slice(0,from)+`\n\n${imageMarker(item.id)}\n\n`+sent.body.slice(to)})
      setNotice('이미지를 서버에 업로드했어요. 본문 참조는 초안·버전 저장 후 유지돼요. 참조를 지워도 과거 저장본의 이미지는 보존돼요.')
    }),
    cancel:()=>{pending.current?.abort();pending.current=null;setBusy(false);setEditingLocked(false);setError('요청을 취소했어요. 서버에서 이미 처리했을 수 있어요. 원고를 복사해 보관하고 다시 불러오기로 확인해 주세요.')},
    create:(title:string)=>{if(!mayLeave())return Promise.resolve(false);return run(async signal=>{const e=await api.createEpisode(id,title,signal);if(!signal.aborted){merge(e);put(e.draft);setNotice('비공개 회차를 만들었어요.')}})},
    reload:()=>{if(!mayLeave())return Promise.resolve(false);return run(async signal=>{const rows=await api.writingList(id,signal);if(!signal.aborted){setEpisodes(rows);const e=rows.find(x=>x.number===active?.number)??rows[0];if(e)install(e);else {setActive(null);put({title:'',body:'',revision:0})}setReady(true)}})},
    restore:(versionId:string)=>{if(!mayLeave())return Promise.resolve(false);return run(async signal=>{if(!active)return;const e=await api.restoreEpisode(id,active.number,current.current.revision,versionId,signal);if(!signal.aborted){merge(e);put(e.draft);setNotice('선택한 원고를 새 버전으로 복원했어요. 발행본은 그대로예요.')}})},
    publish:(versionId:string,rights:boolean)=>publishVersion(versionId,rights,'선택한 저장 버전을 공개했어요.'),
    revertCheckpoint:(versionId:string,rights:boolean)=>publishVersion(versionId,rights,'선택한 체크포인트로 되돌렸어요. 작업 초안과 체크포인트 이력은 그대로예요.'),
  }
}

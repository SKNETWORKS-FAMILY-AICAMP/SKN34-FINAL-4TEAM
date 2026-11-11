import { useEffect, useEffectEvent, useRef, useState } from 'react'
import { appContainer } from '../../../../app/appContainer'
import type { Draft, EpisodeOrderScope, WritingEpisode, PublicationEvent } from '../../../../domain/entities/content'
import type { EpisodeUseCase } from '../../../../domain/usecases/EpisodeUseCase'
import type {MediaUseCase} from '../../../../domain/usecases/MediaUseCase'
import {imageMarker} from '../../../../domain/entities/media'
import {pickEpisode} from './pickEpisode'

type WritingApi = Pick<EpisodeUseCase,'writingList'|'createEpisode'|'writeEpisode'|'restoreEpisode'|'publishEpisode'|'orderScope'|'deleteDraft'|'deleteEpisode'|'setPublicationVisibility'|'history'>
type OrderLookup = { status: 'loading' } | { status: 'failed'; message: string } | { status: 'ready'; scope: EpisodeOrderScope }
// 서버가 거절하는 조건 중 화면이 이미 아는 값(발행본·저장 버전·마지막 회차)만 미리 알린다. 이미지·설정 범위·AI·Fork 참조는 서버가 판단하고 409로 안내한다.
function deleteBlocker(active:WritingEpisode|null,episodes:WritingEpisode[]) {
  if(!active)return ''
  if(active.inherited)return '원작 기준 회차는 삭제할 수 없어요.'
  const kept=[active.publishedVersionId&&'발행본',active.versions.length>0&&'저장한 버전'].filter(Boolean).join('·')
  const last=Math.max(...episodes.map(e=>e.number))
  return [kept&&`${kept}이 있는 회차는 삭제할 수 없어요.`,active.number<last&&`마지막 회차(${last}화)만 삭제할 수 있어요.`].filter(Boolean).join(' ')
}
/** initialEpisode(주소의 ?ep=n)는 처음 목록을 읽을 때 열 회차다. 목록에 없으면 첫 회차를 연다. */
export function useWritingViewModel(id:string, api:WritingApi=appContainer.resolve('episodeUseCase'), media:Pick<MediaUseCase,'upload'>=appContainer.resolve('mediaUseCase'), initialEpisode?:number) {
  const [episodes,setEpisodes]=useState<WritingEpisode[]>([])
  const [active,setActive]=useState<WritingEpisode|null>(null)
  const [draft,setDraft]=useState<Draft>({title:'',body:'',revision:0})
  const [busy,setBusy]=useState(false)
  const [editingLocked,setEditingLocked]=useState(false)
  const [ready,setReady]=useState(false)
  const [error,setError]=useState('')
  const [notice,setNotice]=useState('')
  const [orderLookup,setOrderLookup]=useState<OrderLookup|null>(null)
  const orderRequest=useRef<AbortController|null>(null)
  const [publicationHistory,setPublicationHistory]=useState<PublicationEvent[]|null>(null)
  const [historyLoading,setHistoryLoading]=useState(false)
  const [historyError,setHistoryError]=useState('')
  // 발행 이력은 읽기 전용이라 저장 요청(run)과 분리한다. 실패해도 원고 저장·자동저장을 막지 않는다.
  const historyRequest=useRef<AbortController|null>(null)
  // 발행 상태가 바뀌면 진행 중인 이전 조회 응답이 새 상태를 덮지 않게 함께 취소한다.
  const resetHistory=()=>{historyRequest.current?.abort();setPublicationHistory(null)}
  // ?ep=n은 처음 읽은 목록에만 쓴다. 쓰고 나면 비워 다른 작품·다시 읽기가 옛 번호를 따르지 않게 한다.
  const entry=useRef(initialEpisode)
  const current=useRef(draft)
  const pending=useRef<AbortController|null>(null)
  const dirty=!!active&&(draft.title!==active.draft.title||draft.body!==active.draft.body||(draft.authorNote??'')!==(active.draft.authorNote??''))
  const put=(d:Draft)=>{current.current=d;setDraft(d)}
  const resetOrder=()=>{orderRequest.current?.abort();orderRequest.current=null;setOrderLookup(null)}
  const install=(e:WritingEpisode)=>{resetOrder();setActive(e);put(e.draft);setNotice('');setError('')}
  useEffect(()=>{
    const controller=new AbortController()
    api.writingList(id,controller.signal).then(rows=>{
      if(controller.signal.aborted)return
      const first=pickEpisode(rows,entry.current);entry.current=undefined
      setEpisodes(rows);if(first)install(first);setReady(true)
    }).catch((e:unknown)=>{if(!controller.signal.aborted){setError(e instanceof Error?e.message:'회차를 불러오지 못했어요.');setReady(true)}})
    return ()=>{controller.abort();pending.current?.abort();historyRequest.current?.abort();orderRequest.current?.abort();orderRequest.current=null}
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
    if(version)resetOrder()
    merge(result)
    // A response acknowledges the sent draft, never typing that happened while it was in flight.
    put(current.current.title===sent.title && current.current.body===sent.body && current.current.authorNote===sent.authorNote ? result.draft : {...current.current,revision:result.draft.revision})
    setNotice(version?'새 원고 버전을 저장했어요. 발행본은 그대로예요.':'작업 초안을 저장했어요.')
  },version)
  // 발행과 체크포인트 되돌리기는 같은 회차 발행 요청이다. 완료 안내만 다르고, 성공 표시는 실제 응답을 받은 뒤에만 한다.
  const publishVersion=(versionId:string,rights:boolean,done:string)=>run(async signal=>{if(!active)return;const e=await api.publishEpisode(id,active.number,current.current.revision,versionId,rights,signal);if(!signal.aborted){resetHistory();merge(e);put({...current.current,revision:e.draft.revision});setNotice(done)}})
  const autoSave=useEffectEvent(()=>{void save(false)})
  useEffect(()=>{
    if(!dirty||busy||error||active?.inherited)return
    const timer=window.setTimeout(()=>autoSave(),2000)
    return ()=>window.clearTimeout(timer)
  },[draft,active,busy,error,dirty])
  const mayLeave=()=>!pending.current&&(!dirty||window.confirm('저장하지 않은 입력을 버리고 이동할까요?'))
  // 삭제가 서버에 확정되면 true다. 뒤이은 목록 재조회가 실패해도 true라서 화면이 사라진 버튼 대신 초점을 옮길 수 있다.
  const remove=async(whole:boolean)=>{
    if(!active||pending.current||active.inherited)return false
    if(!window.confirm(whole?'회차를 삭제할까요? 삭제하면 되돌릴 수 없어요. 같은 번호로 새 회차를 만들 수 있어요. 저장하지 않은 입력은 사라져요.':'작업 초안을 삭제할까요? 저장 버전과 발행본은 보존하며, 저장하지 않은 입력은 사라져요.'))return false
    let removed=false
    await run(async signal=>{
      const removeAction=whole?api.deleteEpisode.bind(api):api.deleteDraft.bind(api)
      await removeAction(id,active.number,active.draft.revision,signal)
      if(signal.aborted)return
      removed=true
      resetOrder()
      setNotice(whole?'회차를 삭제했어요.':'작업 초안을 삭제했어요. 새로 입력하면 새 초안으로 저장돼요.')
      // The deletion is committed: never retain a dirty buffer that could auto-save it back.
      setActive(null);put({title:'',body:'',revision:0});setEpisodes([])
      const rows=await api.writingList(id,signal)
      if(signal.aborted)return
      setEpisodes(rows)
      const next=rows.find(e=>e.number===active.number)??rows[0]
      if(next){setActive(next);put(next.draft)}
    })
    return removed
  }
  const changeVisibility=(visible:boolean,rights:boolean)=>{
    if(!active||active.inherited||dirty||pending.current)return Promise.resolve(false)
    if(!visible&&!window.confirm('이 회차의 공개를 중단할까요? 저장 버전과 기존 Fork는 보존돼요.'))return Promise.resolve(false)
    return run(async signal=>{
      const result=await api.setPublicationVisibility(id,active.number,current.current.revision,visible,rights,signal)
      if(signal.aborted)return
      resetHistory();merge(result);put({...current.current,revision:result.draft.revision})
      setNotice(visible?'중단했던 발행본을 다시 공개했어요.':'회차 공개를 중단했어요.')
    })
  }
  return {publicationHistory,changeVisibility,
    orderLookup,
    historyLoading,historyError,
    loadPublicationHistory:async()=>{
      historyRequest.current?.abort()
      const controller=new AbortController();historyRequest.current=controller
      setPublicationHistory(null);setHistoryError('');setHistoryLoading(true)
      try {
        const result=await api.history(id,controller.signal)
        if(controller.signal.aborted)return
        if(!result.publicationHistory)throw new Error('발행 이력 응답을 확인할 수 없어요.')
        setPublicationHistory(result.publicationHistory)
      } catch(e) {if(!controller.signal.aborted)setHistoryError(e instanceof Error?e.message:'발행 이력을 불러오지 못했어요.')}
      finally {if(historyRequest.current===controller){historyRequest.current=null;setHistoryLoading(false)}}
    },
    episodes,active,draft,busy,editingLocked,ready,error,notice,dirty,mayLeave,deleteBlocker:deleteBlocker(active,episodes),
    edit:(patch:Partial<Pick<Draft,'title'|'body'|'authorNote'>>)=>{put({...current.current,...patch});setNotice('')},
    save:()=>save(true),
    deleteDraft:()=>remove(false),
    deleteEpisode:()=>remove(true),
    checkOrder:async()=>{
      if(!active||orderRequest.current)return
      const controller=new AbortController()
      orderRequest.current=controller
      setOrderLookup({status:'loading'})
      try {
        const scope=await api.orderScope(id,active.number,controller.signal)
        if(!controller.signal.aborted)setOrderLookup({status:'ready',scope})
      } catch(failure) {
        if(!controller.signal.aborted)setOrderLookup({status:'failed',message:failure instanceof Error?failure.message:'순서 변경 후보를 불러오지 못했어요.'})
      } finally {
        if(orderRequest.current===controller)orderRequest.current=null
      }
    },
    select:(e:WritingEpisode)=>{if(!mayLeave())return false;install(e);return true},
    addImage:(file:File,start:number,end:number)=>run(async signal=>{
      if(!active||active.inherited)throw new Error('편집 가능한 내 회차를 선택해 주세요.')
      const sent=current.current
      const from=Math.max(0,Math.min(start,sent.body.length));const to=Math.max(from,Math.min(end,sent.body.length))
      if(sent.body.length-(to-from)+50>40000)throw new Error('이미지 참조를 넣을 공간이 부족해요. 원고를 40,000자 이내로 줄여 주세요.')
      const item=await media.upload({kind:'episode',workId:id,number:active.number},file,undefined,signal)
      if(signal.aborted)return
      resetOrder()
      put({...current.current,body:sent.body.slice(0,from)+`\n\n${imageMarker(item.id)}\n\n`+sent.body.slice(to)})
      setNotice('이미지를 서버에 업로드했어요. 본문 참조는 초안·버전 저장 후 유지돼요. 참조를 지워도 과거 저장본의 이미지는 보존돼요.')
    }),
    cancel:()=>{pending.current?.abort();pending.current=null;setBusy(false);setEditingLocked(false);setError('요청을 취소했어요. 서버에서 이미 처리했을 수 있어요. 원고를 복사해 보관하고 다시 불러오기로 확인해 주세요.')},
    create:(title:string)=>{if(!mayLeave())return Promise.resolve(false);return run(async signal=>{const e=await api.createEpisode(id,title,signal);if(!signal.aborted){resetOrder();merge(e);put(e.draft);setNotice('비공개 회차를 만들었어요.')}})},
    reload:()=>{if(!mayLeave())return Promise.resolve(false);return run(async signal=>{const rows=await api.writingList(id,signal);if(!signal.aborted){setEpisodes(rows);const e=rows.find(x=>x.number===active?.number)??rows[0];if(e)install(e);else {resetOrder();setActive(null);put({title:'',body:'',revision:0})}setReady(true)}})},
    restore:(versionId:string)=>{if(!mayLeave())return Promise.resolve(false);return run(async signal=>{if(!active)return;const e=await api.restoreEpisode(id,active.number,current.current.revision,versionId,signal);if(!signal.aborted){merge(e);put(e.draft);setNotice('선택한 원고를 새 버전으로 복원했어요. 발행본은 그대로예요.')}})},
    publish:(versionId:string,rights:boolean)=>publishVersion(versionId,rights,'선택한 저장 버전을 공개했어요.'),
    revertCheckpoint:(versionId:string,rights:boolean)=>publishVersion(versionId,rights,'선택한 체크포인트로 되돌렸어요. 작업 초안과 체크포인트 이력은 그대로예요.'),
  }
}

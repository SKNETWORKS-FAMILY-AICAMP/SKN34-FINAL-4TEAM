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
  const aiReload=useRef<AbortController|null>(null)
  // 서버에 가 있는 요청은 사용자가 누른 것이든 자동 저장이든 하나뿐이다.
  const pending=useRef<AbortController|null>(null)
  // 진행 중인 자동 저장과, 그것이 끝나기를 기다리는 사용자 요청
  const autosave=useRef<Promise<void>|null>(null)
  const waiting=useRef<AbortController|null>(null)
  const dirty=!!active&&(draft.title!==active.draft.title||draft.body!==active.draft.body||(draft.authorNote??'')!==(active.draft.authorNote??''))
  const put=(d:Draft)=>{current.current=d;setDraft(d)}
  const resetOrder=()=>{orderRequest.current?.abort();orderRequest.current=null;setOrderLookup(null)}
  const install=(e:WritingEpisode)=>{aiReload.current?.abort();resetOrder();setActive(e);put(e.draft);setNotice('');setError('')}
  useEffect(()=>{
    const controller=new AbortController()
    api.writingList(id,controller.signal).then(rows=>{
      if(controller.signal.aborted)return
      const first=pickEpisode(rows,entry.current);entry.current=undefined
      setEpisodes(rows);if(first)install(first);setReady(true)
    }).catch((e:unknown)=>{if(!controller.signal.aborted){setError(e instanceof Error?e.message:'회차를 불러오지 못했어요.');setReady(true)}})
    return ()=>{controller.abort();aiReload.current?.abort();pending.current?.abort();waiting.current?.abort();historyRequest.current?.abort();orderRequest.current?.abort();orderRequest.current=null}
  },[id,api])
  useEffect(()=>{
    const leave=(e:BeforeUnloadEvent)=>{if(dirty||busy)e.preventDefault()}
    window.addEventListener('beforeunload',leave)
    return ()=>window.removeEventListener('beforeunload',leave)
  },[dirty,busy])
  // 사용자가 누른 요청: 화면을 진행 중으로 잠근다. 자동 저장이 서버에 가 있으면 끝나기를 기다렸다가 실행한다(누른 요청을 버리지 않고, 옛 revision으로 보내 충돌하지도 않는다).
  const run=async(action:(signal:AbortSignal)=>Promise<void>,lockEditing=true)=>{
    if(waiting.current||(pending.current&&!autosave.current))return false
    const controller=new AbortController();setBusy(true);setError('');setNotice('')
    setEditingLocked(lockEditing)
    if(autosave.current){waiting.current=controller;await autosave.current;waiting.current=null;if(controller.signal.aborted)return false}
    pending.current=controller
    try {await action(controller.signal);return !controller.signal.aborted}
    catch(e){if(!controller.signal.aborted)setError(e instanceof Error?e.message:'저장에 실패했어요. 입력은 화면에 남아 있어요.');return false}
    finally {if(pending.current===controller){pending.current=null;if(!controller.signal.aborted){setBusy(false);setEditingLocked(false)}}}
  }
  const merge=(e:WritingEpisode)=>{setEpisodes(rows=>[...rows.filter(x=>x.number!==e.number),e].sort((a,b)=>a.number-b.number));setActive(e)}
  const write=async(version:boolean,signal:AbortSignal)=>{
    if(!active||active.inherited)return
    const sent=current.current
    const result=await api.writeEpisode(id,active.number,sent,version,signal)
    if(signal.aborted)return
    if(version)resetOrder()
    merge(result)
    // A response acknowledges the sent draft, never typing that happened while it was in flight.
    put(current.current.title===sent.title && current.current.body===sent.body && current.current.authorNote===sent.authorNote ? result.draft : {...current.current,revision:result.draft.revision})
    // 자동 저장의 성공은 상단의 저장 상태('저장됨')가 알린다. 알림 문단은 사용자가 누른 버전 저장만 쓴다.
    if(version)setNotice('새 원고 버전을 저장했어요. 발행본은 그대로예요.')
  }
  const save=()=>run(signal=>write(true,signal))
  // 발행과 체크포인트 되돌리기는 같은 회차 발행 요청이다. 완료 안내만 다르고, 성공 표시는 실제 응답을 받은 뒤에만 한다.
  const publishVersion=(versionId:string,rights:boolean,done:string)=>run(async signal=>{if(!active)return;const e=await api.publishEpisode(id,active.number,current.current.revision,versionId,rights,signal);if(!signal.aborted){resetHistory();merge(e);put({...current.current,revision:e.draft.revision});setNotice(done)}})
  // 자동 저장은 조용하다: 화면을 잠그지도 알림을 바꾸지도 않고, 실패만 오류로 알린다(오류가 있으면 다시 시도하지 않는다).
  // 서버에 가 있는 동안 다시 예약된 자동 저장은 건너뛰고, 응답으로 active가 바뀌면 아래 효과가 남은 입력을 다시 예약한다.
  // ponytail: 응답이 오래 걸려도 상태는 '저장되지 않은 변경'으로만 보인다. 지연 표시가 필요해지면 일정 시간 뒤 busy로 올린다.
  const autoSave=useEffectEvent(()=>{
    if(pending.current||waiting.current)return
    const controller=new AbortController();pending.current=controller
    const saving=write(false,controller.signal)
      .catch((e:unknown)=>{if(!controller.signal.aborted)setError(e instanceof Error?e.message:'저장에 실패했어요. 입력은 화면에 남아 있어요.')})
      .finally(()=>{if(pending.current===controller)pending.current=null;if(autosave.current===saving)autosave.current=null})
    autosave.current=saving
  })
  useEffect(()=>{
    if(!dirty||busy||error||active?.inherited)return
    const timer=window.setTimeout(()=>autoSave(),2000)
    return ()=>window.clearTimeout(timer)
  },[draft,active,busy,error,dirty])
  // 요청이 서버에 가 있으면 true다. 그것이 자동 저장이면 끝날 때까지 화면을 진행 중으로 올려, 회차 전환·이동·삭제가 왜 안 되는지 보이고 취소할 수 있게 한다.
  const inFlight=()=>{
    if(!pending.current)return false
    if(autosave.current)void run(async()=>{},false)
    return true
  }
  const mayLeave=()=>!inFlight()&&(!dirty||window.confirm('저장하지 않은 입력을 버리고 이동할까요?'))
  // 삭제가 서버에 확정되면 true다. 뒤이은 목록 재조회가 실패해도 true라서 화면이 사라진 버튼 대신 초점을 옮길 수 있다.
  const remove=async(whole:boolean)=>{
    if(!active||active.inherited||inFlight())return false
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
    if(!active||active.inherited||dirty||inFlight())return Promise.resolve(false)
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
    /** 집필 AI가 작가 승인으로 회차 초안을 바꿨다(Content MCP). 목록을 다시 읽고, 고치던 글이 없으면 새 초안을 연다. */
    aiApplied:async(number:number)=>{
      aiReload.current?.abort()
      const controller=new AbortController();aiReload.current=controller
      const before=current.current
      try{
        const rows=await api.writingList(id,controller.signal)
        if(controller.signal.aborted)return
        const next=rows.find(e=>e.number===number)
        if(active?.number!==number){setEpisodes(rows);return}
        // 재조회 중 편집·저장·회차 이동이 있으면 그 화면 상태가 우선이다.
        if(dirty||current.current!==before||pending.current||waiting.current){
          if(dirty||current.current!==before)setNotice('AI가 이 회차 초안을 바꿨어요. 작성 중인 변경을 복사해 둔 뒤 회차를 다시 열어 주세요.')
          return
        }
        setEpisodes(rows)
        if(next)install(next)
      }catch(e){if(!controller.signal.aborted)setError(e instanceof Error?e.message:'AI가 반영한 초안을 다시 불러오지 못했어요.')}
      finally{if(aiReload.current===controller)aiReload.current=null}
    },
    episodes,active,draft,busy,editingLocked,ready,error,notice,dirty,mayLeave,deleteBlocker:deleteBlocker(active,episodes),
    // 회차 목록의 항목별 메뉴가 선택하지 않은 회차의 삭제 가능 여부도 같은 규칙으로 알린다.
    deleteBlockerOf:(e:WritingEpisode)=>deleteBlocker(e,episodes),
    edit:(patch:Partial<Pick<Draft,'title'|'body'|'authorNote'>>)=>{put({...current.current,...patch});setNotice('')},
    save,
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
    cancel:()=>{pending.current?.abort();waiting.current?.abort();pending.current=null;setBusy(false);setEditingLocked(false);setError('요청을 취소했어요. 서버에서 이미 처리했을 수 있어요. 원고를 복사해 보관하고 다시 불러오기로 확인해 주세요.')},
    create:(title:string)=>{if(!mayLeave())return Promise.resolve(false);return run(async signal=>{const e=await api.createEpisode(id,title,signal);if(!signal.aborted){resetOrder();merge(e);put(e.draft);setNotice('비공개 회차를 만들었어요.')}})},
    reload:()=>{if(!mayLeave())return Promise.resolve(false);return run(async signal=>{const rows=await api.writingList(id,signal);if(!signal.aborted){setEpisodes(rows);const e=rows.find(x=>x.number===active?.number)??rows[0];if(e)install(e);else {resetOrder();setActive(null);put({title:'',body:'',revision:0})}setReady(true)}})},
    restore:(versionId:string)=>{if(!mayLeave())return Promise.resolve(false);return run(async signal=>{if(!active)return;const e=await api.restoreEpisode(id,active.number,current.current.revision,versionId,signal);if(!signal.aborted){merge(e);put(e.draft);setNotice('선택한 원고를 새 버전으로 복원했어요. 발행본은 그대로예요.')}})},
    publish:(versionId:string,rights:boolean)=>publishVersion(versionId,rights,'선택한 저장 버전을 공개했어요.'),
    revertCheckpoint:(versionId:string,rights:boolean)=>publishVersion(versionId,rights,'선택한 체크포인트로 되돌렸어요. 작업 초안과 체크포인트 이력은 그대로예요.'),
  }
}

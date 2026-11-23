import { useEffect, useRef, useState } from 'react'
import { appContainer } from '../../app/appContainer'
import { authenticatedUserId } from '../../data/api/auth'
import { DEFAULT_COVER_REFERENCE, type CoverReference, type CoverReferenceRole, type ImageJob, type ImageRequest } from '../../domain/repositories/ImageGenerationRepository'
import { referenceFileError } from '../../domain/usecases/ImageGenerationUseCase'

/** 상태 조회만 재개한다. 화면을 닫아도 서버 생성 작업은 계속된다. */
export function useImageGeneration(input: Omit<ImageRequest,'prompt'|'visualSettings'|'reference'|'referenceFile'>) {
 const useCase=appContainer.resolve('imageGenerationUseCase')
 const [prompt,setPrompt]=useState(''), [job,setJob]=useState<ImageJob>(), [error,setError]=useState(''), [busy,setBusy]=useState(false), [preview,setPreview]=useState('')
 const [visualSettings,setVisualSettings]=useState('')
 const [referenceMode,setReferenceMode]=useState<CoverReference['mode']>('preset')
 const [referenceRole,setReferenceRole]=useState<CoverReferenceRole>('style')
 const [referenceFile,setReferenceFile]=useState<File>()
 const [referencePreview,setReferencePreview]=useState('')
 const referenceIssue=referenceFile ? referenceFileError(referenceFile) : undefined
 const file=useRef<File | undefined>(undefined)
 const controller=useRef<AbortController | undefined>(undefined)
 const pollController=useRef<AbortController | undefined>(undefined)
 const pending=useRef<{key:string;signature:string;file?:File} | undefined>(undefined)
 const [refresh,setRefresh]=useState(0)
 const [pollRefresh,setPollRefresh]=useState(0)
 const [restoring,setRestoring]=useState(false)
 const [unresolved,setUnresolved]=useState(false)
 const storageKey=`image-generation:${authenticatedUserId()}:${input.purpose}:${input.workId ?? input.worldId ?? 'new'}`
 useEffect(()=>{
  setPrompt('');setVisualSettings('');setError('')
  setReferenceMode('preset');setReferenceRole('style');setReferenceFile(undefined)
 },[storageKey])
 useEffect(()=>{
  if (referenceMode!=='upload' || !referenceFile || referenceIssue) {
   setReferencePreview('')
   return
  }
  const url=URL.createObjectURL(referenceFile)
  setReferencePreview(url)
  return ()=>URL.revokeObjectURL(url)
 },[referenceMode,referenceFile,referenceIssue])
 useEffect(()=> {
  setJob(undefined);setPreview('');setBusy(false);setRestoring(false);setUnresolved(false);file.current=undefined;pending.current=undefined
  const saved=sessionStorage.getItem(storageKey)
  const abort=new AbortController()
  const key=sessionStorage.getItem(storageKey+':request')
  if(key) {
   setRestoring(true);setUnresolved(true)
   void useCase.readByKey(key,abort.signal).then(next=>{
    if(abort.signal.aborted)return
    setUnresolved(false)
    sessionStorage.removeItem(storageKey+':request')
    if(next) { sessionStorage.setItem(storageKey,next.jobId);setJob(next) }
    else setError('접수 기록이 없어요. 다시 생성해 주세요.')
   }).catch(()=>{if(!abort.signal.aborted)setError('접수 결과를 확인하지 못했어요. 다시 조회해 주세요.')})
    .finally(()=>{if(!abort.signal.aborted)setRestoring(false)})
  } else if(saved) setJob({jobId:saved,status:'queued',stage:'waiting',previewUrl:null})
  return ()=>{abort.abort();controller.current?.abort()}
 },[storageKey,useCase,refresh])
 useEffect(()=> {
  if(!job) return
  const abort=new AbortController();pollController.current=abort
  let timer:ReturnType<typeof setTimeout> | undefined
  let url=''
  async function poll() {
   try {
    const next=await useCase.read(job!.jobId,abort.signal)
    if(abort.signal.aborted) return
    if(!next) {
     sessionStorage.removeItem(storageKey);setJob(undefined);setPreview('');file.current=undefined
     setError('이미지 작업을 찾을 수 없어요. 새로 생성해 주세요.')
     return
    }
    setJob(current=>current?.jobId===next.jobId ? next : current)
    if(next.status==='succeeded') {
     const blob=await useCase.image(next.jobId,abort.signal)
     if(abort.signal.aborted) return
     file.current=new File([blob],'generated.png',{type:'image/png'})
     url=URL.createObjectURL(blob);setPreview(url)
    } else if(next.status==='failed' && next.stage==='output_blocked') setError('생성 이미지가 콘텐츠 기준에 맞지 않아 표시할 수 없어요. 장면 설명을 수정해 주세요.')
    else if(next.status==='failed' && next.stage==='moderation_unavailable') setError('생성 이미지의 안전성을 확인하지 못했어요. 잠시 후 새로 생성해 주세요.')
    else if(['failed','interrupted'].includes(next.status)) setError('이미지 생성을 완료하지 못했어요. 결과 확인 후 다시 생성해 주세요.')
    else timer=setTimeout(poll,3000)
   } catch { if(!abort.signal.aborted) setError('상태를 확인하지 못했어요. 화면을 다시 열면 조회를 재개해요.') }
  }
  void poll()
  return ()=>{abort.abort();if(timer)clearTimeout(timer);if(url)URL.revokeObjectURL(url)}
 },[job?.jobId,useCase,refresh,pollRefresh])
 async function generate() {
  if(busy || restoring || unresolved) return
  const cover=input.purpose==='work_cover' || input.purpose==='world_cover'
  const reference:CoverReference|undefined=!cover ? undefined : referenceMode==='preset'
   ? {mode:'preset',role:'style',presetVersion:DEFAULT_COVER_REFERENCE}
   : {mode:referenceMode,role:referenceRole}
  const upload=reference?.mode==='upload' ? referenceFile : undefined
  if(reference?.mode==='upload' && (!upload || referenceIssue)) return
  const request:ImageRequest={...input,prompt,...(cover?{visualSettings,reference,referenceFile:upload}:{})}
  const signature=JSON.stringify([prompt,visualSettings,reference])
  controller.current?.abort();const abort=new AbortController();controller.current=abort
  pollController.current?.abort()
  setBusy(true);setError('');setPreview('');file.current=undefined
  if(!pending.current || pending.current.signature!==signature || pending.current.file!==upload) {
   pending.current={key:crypto.randomUUID(),signature,file:upload}
  }
  try {
   sessionStorage.setItem(storageKey+':request',pending.current.key)
   const next=await useCase.submit(request,pending.current.key,abort.signal)
   if(abort.signal.aborted)return
   sessionStorage.setItem(storageKey,next.jobId);sessionStorage.removeItem(storageKey+':request');setJob(next);pending.current=undefined
  } catch { if(!abort.signal.aborted) { setError('접수하지 못했어요. 다시 누르면 같은 요청 키로 결과를 확인해요.');setPollRefresh(x=>x+1) } }
  finally { if(!abort.signal.aborted)setBusy(false) }
 }
 return {prompt,setPrompt,visualSettings,setVisualSettings,referenceMode,setReferenceMode,referenceRole,setReferenceRole,
  referenceFile,setReferenceFile,referencePreview,referenceIssue,job,error,busy:busy||restoring||unresolved,preview,
  generate,retry:()=>{setError('');setRefresh(x=>x+1)},file:()=>file.current}
}

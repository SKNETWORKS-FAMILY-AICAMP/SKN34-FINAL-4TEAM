import {useCallback,useEffect,useRef,useState} from 'react'
import {appContainer} from '../../../../app/appContainer'
import type {ManuscriptBuild} from '../../../../domain/repositories/ManuscriptBuildRepository'
import type {ManuscriptBuildUseCase} from '../../../../domain/usecases/ManuscriptBuildUseCase'
export function useManuscriptBuild(workId:string,worldId:string|null|undefined,useCase:ManuscriptBuildUseCase=appContainer.resolve('manuscriptBuildUseCase')){
 const [job,setJob]=useState<ManuscriptBuild|null>(null),[consent,setConsent]=useState(false),[error,setError]=useState(''),[ready,setReady]=useState(false),[busy,setBusy]=useState(false)
 const active=useRef<AbortController|null>(null)
 const run=useCallback(async(action:'read'|'start'|'resume')=>{
  if(active.current)return
  const controller=new AbortController();active.current=controller;setBusy(true);setError('')
  try{
   const value=await(action==='read'?useCase.read(workId,controller.signal):action==='start'?useCase.start(workId,worldId,consent,controller.signal):useCase.resume(workId,controller.signal))
   if(!controller.signal.aborted){setJob(value);setReady(true)}
  }catch(cause){if(!controller.signal.aborted)setError(cause instanceof Error?cause.message:'작업을 확인하지 못했어요.')}
  finally{if(active.current===controller){active.current=null;setBusy(false)}}
 },[useCase,workId,worldId,consent])
 // 최초 조회만 자동 실행한다. 화면 진입/업로드/새로고침으로 POST하지 않는다.
 useEffect(()=>{setJob(null);setConsent(false);setReady(false);void run('read');return()=>{active.current?.abort();active.current=null}},[workId,useCase]) // eslint-disable-line react-hooks/exhaustive-deps
 useEffect(()=>{
  if(busy||error||!job||!['queued','running','loading'].includes(job.status))return
  const timer=setTimeout(()=>void run('read'),2000);return()=>clearTimeout(timer)
 },[busy,error,job,run])
 return {job,consent,setConsent,error,ready,busy,refresh:()=>run('read'),start:()=>run('start'),resume:()=>run('resume')}
}

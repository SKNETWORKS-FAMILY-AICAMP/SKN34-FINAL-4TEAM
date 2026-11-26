import {useCallback,useEffect,useRef,useState} from 'react'
import {appContainer} from '../../../../app/appContainer'
import {worldBuildBadge} from '../../../../domain/entities/manuscriptBuild'
import type {ManuscriptBuild} from '../../../../domain/repositories/ManuscriptBuildRepository'
import type {ManuscriptBuildUseCase} from '../../../../domain/usecases/ManuscriptBuildUseCase'
export function useManuscriptBuild(workId:string,worldId:string|null|undefined,useCase:ManuscriptBuildUseCase=appContainer.resolve('manuscriptBuildUseCase'),{enabled=true,refreshKey=0}:{enabled?:boolean;refreshKey?:number}={}){
 const [job,setJob]=useState<ManuscriptBuild|null>(null),[consent,setConsent]=useState(false),[error,setError]=useState(''),[ready,setReady]=useState(false),[busy,setBusy]=useState(false)
 const active=useRef<AbortController|null>(null),polling=useRef(false),failedWorld=job?.worldId
 // quiet는 자동 조회다: busy·상태 문구·오류 지우기 없이 조용히 읽고, 그 사이 사용자가 누른 동작이 있으면 그 동작이 조회를 중단시키고 먼저 실행된다.
 const run=useCallback(async(action:'read'|'start'|'startNew'|'resume',quiet=false)=>{
  if(active.current){if(quiet||!polling.current)return;active.current.abort()}
  const controller=new AbortController();active.current=controller;polling.current=quiet
  if(!quiet){setBusy(true);setError('')}
  try{
   // 새로 시작은 지금 작품에 연결된 세계관을 먼저 쓴다(서버가 그 세계관만 받는다). 연결이 없으면 실패한 작업의 세계관이다.
   const value=await(action==='read'?useCase.read(workId,controller.signal):action==='resume'?useCase.resume(workId,controller.signal):action==='startNew'?useCase.start(workId,worldId??failedWorld,consent,controller.signal,true):useCase.start(workId,worldId,consent,controller.signal))
   if(!controller.signal.aborted){setJob(value);setReady(true);if(action==='start'||action==='startNew')setConsent(false)}
  }catch(cause){if(!controller.signal.aborted)setError(cause instanceof Error?cause.message:'작업을 확인하지 못했어요.')}
  finally{if(active.current===controller){active.current=null;if(!quiet)setBusy(false)}}
 },[useCase,workId,worldId,failedWorld,consent])
 // 최초 조회만 자동 실행한다. 화면 진입/업로드/새로고침으로 POST하지 않는다.
 useEffect(()=>{setJob(null);setConsent(false);setReady(false);setError('');setBusy(false);if(!enabled)return;void run('read');return()=>{active.current?.abort();active.current=null}},[workId,useCase,enabled,refreshKey]) // eslint-disable-line react-hooks/exhaustive-deps
 // 최초 구축이나 발행 회차 업데이트가 진행 중인 동안(배지가 보이는 동안)만 2초마다 다시 읽는다.
 useEffect(()=>{
  if(!enabled||busy||error||!worldBuildBadge(job))return
  const timer=setTimeout(()=>void run('read',true),2000);return()=>clearTimeout(timer)
 },[enabled,busy,error,job,run])
 return {job,consent,setConsent,error,ready,busy,refresh:()=>run('read'),start:()=>run('start'),startNew:()=>run('startNew'),resume:()=>run('resume')}
}

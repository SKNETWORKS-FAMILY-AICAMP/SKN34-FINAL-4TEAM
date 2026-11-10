import {useEffect,useRef,useState} from 'react'
import {appContainer} from '../../../../app/appContainer'
import {useAppSelector} from '../../../../app/store'
import type {AiRun,ChangeProposal,RunDetails,RunInput} from '../../../../domain/entities/aiRun'

export function useAiRunViewModel(work:string,episode:number,revision:number,body:string,selection:{start:number;end:number},available:boolean,onApplied:()=>void,onAccessDenied:()=>void=()=>{}){
  const api=appContainer.resolve('aiRunUseCase')
  const member=useAppSelector(s=>s.session.memberId)
  const session=api.session()
  const binding=JSON.stringify([work,episode,revision,body,selection,member,session])
  const current=useRef(binding);current.current=binding
  const controller=useRef<AbortController|null>(null)
  const lock=useRef(false)
  const keys=useRef(new Map<string,string>())
  const creation=useRef<{intent:string;input:RunInput;key:string}|null>(null)
  const [state,setState]=useState<{binding:string;run?:AiRun;proposal?:ChangeProposal;details?:RunDetails;error?:string;message?:string;receipt?:string}>({binding})
  const [busy,setBusy]=useState(false)
  const [connected,setConnected]=useState(true)
  const [prompt,setPrompt]=useState('')
  const [operation,setOperation]=useState<RunInput['operation']>('ask')
  const [consent,setConsent]=useState(false)
  const alive=(token:string,signal:AbortSignal)=>current.current===token&&!signal.aborted&&api.session()===session
  useEffect(()=>{controller.current?.abort();lock.current=false;setBusy(false);setState({binding});keys.current.clear();creation.current=null;setConsent(false)
    const timer=setInterval(()=>{if(api.session()!==session){controller.current?.abort();setState({binding:''});setBusy(false)}},250)
    return ()=>{clearInterval(timer);controller.current?.abort()}
  },[binding,api,session])
  const visible=state.binding===binding&&api.session()===session?state:undefined
  const key=(name:string)=>{if(!keys.current.has(name))keys.current.set(name,crypto.randomUUID());return keys.current.get(name)!}
  const fail=(error:unknown,token:string,signal:AbortSignal)=>{
    if(current.current===token&&!signal.aborted&&api.session()!==session){setState({binding:''});controller.current?.abort();onAccessDenied();return}
    if(alive(token,signal)){
    const denied=typeof error==='object'&&error!==null&&'status' in error&&[401,403,404,409].includes(Number(error.status))
    if(denied){setState({binding:token,error:error instanceof Error?error.message:'현재 권한과 원고를 다시 확인해 주세요.'});controller.current?.abort();if(Number((error as {status:number}).status)!==409)onAccessDenied()}
    else setState(s=>({...s,error:error instanceof Error?error.message:'AI 요청을 처리하지 못했어요.'}))
  }}
  const load=async(run:AiRun,token:string,signal:AbortSignal)=>{
    if(!alive(token,signal))return
    const labels:Record<string,string>={pending:'요청을 접수했어요.',running:'AI가 작업하고 있어요.',awaiting_approval:'변경안을 검토해 주세요.',proposal:'변경안을 검토해 주세요.',succeeded:'결과를 확인해 주세요.',partial:'일부 결과를 확인해 주세요.',failed:'작업을 완료하지 못했어요.',denied:'작업 권한을 확인해 주세요.',cancelled:'작업을 취소했어요.'}
    setState(s=>({...s,run,message:labels[run.status]??'작업 상태를 확인했어요.'}))
    if(run.error){setState(s=>({...s,error:run.error?.code==='AI_RUN_EXECUTOR_UNAVAILABLE'?'AI 실행 연결이 아직 준비되지 않았어요. 원고는 변경하지 않았어요.':'AI 작업에 실패했어요. 원고는 변경하지 않았어요.'}));return}
    if(run.result?.proposalId){const proposal=await api.proposal(work,run.result.proposalId,signal);if(proposal.changeSet.runId!==run.runId)throw new Error('다른 작업의 제안이에요.');if(alive(token,signal))setState(s=>({...s,proposal}))}
    if(['succeeded','partial','clarification'].includes(run.status)){const details=await api.details(work,run.runId,signal);if(alive(token,signal))setState(s=>({...s,details}))}
  }
  const start=async()=>{
    if(lock.current||!available||!consent||!prompt.trim()||!member||visible?.run&&['pending','running','awaiting_approval'].includes(visible.run.status)&&!visible.receipt)return
    lock.current=true;setBusy(true);controller.current?.abort();const task=new AbortController();controller.current=task;const token=binding
    setState({binding:token,message:'요청을 보내고 있어요.'})
    try{
      const meta=await api.metadata(work,task.signal)
      let selected:RunInput['target']['selection']
      if(selection.end>selection.start){const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(body.slice(selection.start,selection.end)));selected={...selection,revision,sourceHash:Array.from(new Uint8Array(digest),x=>x.toString(16).padStart(2,'0')).join('')}}
      if(!alive(token,task.signal))return
      if(operation==='edit'&&!selected)throw new Error('수정할 원고 구간을 먼저 선택해 주세요.')
      const input:RunInput={operation,prompt,target:{basisEpisode:episode,baseRevision:meta.revision,forkId:meta.source?work:null,character:'',...(selected?{selection:selected}:{})},options:{modelConsent:{providers:['openai'],purpose:operation,maxCalls:1,noticeVersion:'writing-ai-v1'}}}
      const intent=JSON.stringify([operation,prompt])
      if(creation.current?.intent!==intent)creation.current={intent,input,key:crypto.randomUUID()}
      const request=creation.current
      const run=await api.create(work,request.input,request.key,task.signal)
      creation.current=null
      await load(run,token,task.signal)
      if(!['pending','running','awaiting_approval'].includes(run.status))return
      lock.current=false;setBusy(false)
      const stream=new AbortController();task.signal.addEventListener('abort',()=>stream.abort(),{once:true})
      void api.watch(work,run.runId,run.lastEventId,stream.signal,event=>{if(alive(token,task.signal))setState(s=>({...s,message:event.message}))},live=>{if(alive(token,task.signal))setConnected(live)}).catch(error=>fail(error,token,task.signal))
      while(alive(token,task.signal)){
        await new Promise<void>(resolve=>{const done=()=>{clearTimeout(timer);task.signal.removeEventListener('abort',done);resolve()};const timer=setTimeout(done,2000);task.signal.addEventListener('abort',done,{once:true})})
        if(!alive(token,task.signal))break
        const latest=await api.status(work,run.runId,task.signal);await load(latest,token,task.signal)
        if(!['pending','running','awaiting_approval'].includes(latest.status)){stream.abort();break}
      }
    }catch(error){fail(error,token,task.signal)}finally{if(current.current===token){lock.current=false;setBusy(false)}}
  }
  const decide=async(action:'approve'|'reject'|'revise')=>{
    const proposal=visible?.proposal;if(lock.current||!proposal||!available||proposal.status!=='pending')return
    if(action==='approve'&&(proposal.changeSet.isMock||proposal.changeSet.evidence.some(e=>e.isMock)))return
    lock.current=true;setBusy(true);const token=binding;const task=controller.current??new AbortController();controller.current=task
    try{const receipt=await api.decide(work,proposal,action,key(`${proposal.proposalHash}:${action}`),task.signal);if(alive(token,task.signal)){setState(s=>({...s,receipt:receipt.outcome,proposal:undefined}));task.abort();if(receipt.outcome==='applied')onApplied()}}
    catch(error){fail(error,token,task.signal)}finally{lock.current=false;setBusy(false)}
  }
  const cancel=async()=>{const run=visible?.run;if(!run)return;const task=controller.current??new AbortController();try{const result=await api.cancel(work,run.runId,task.signal);if(alive(binding,task.signal)){setState(s=>({...s,run:result,message:result.status==='cancelled'?'작업을 취소했어요.':'현재 작업 상태를 확인했어요.'}));if(result.status==='cancelled'){task.abort();lock.current=false;setBusy(false)}}}catch(error){fail(error,binding,task.signal)}}
  return {state:visible,busy,connected,prompt,setPrompt,operation,setOperation,consent,setConsent,start,decide,cancel}
}

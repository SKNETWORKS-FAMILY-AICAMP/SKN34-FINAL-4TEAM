import {useAiRunViewModel} from '../viewmodel/useAiRunViewModel'

type Props={work:string;episode:number;revision:number;body:string;selection:{start:number;end:number};available:boolean;drafts:{number:number;draft:{title:string;body:string;revision:number}}[];onApplied:()=>void;onAccessDenied:()=>void}
export function AiRunPanel(props:Props){
  const vm=useAiRunViewModel(props.work,props.episode,props.revision,props.body,props.selection,props.available,props.onApplied,props.onAccessDenied)
  const state=vm.state;const proposal=state?.proposal
  const active=!!state?.run&&['pending','running','awaiting_approval'].includes(state.run.status)&&!state.receipt
  const mock=proposal?.changeSet.isMock||proposal?.changeSet.evidence.some(e=>e.isMock)
  const canReview=proposal?.changeSet.operations.every(op=>op.op==='create'||props.drafts.some(d=>d.number===op.target.episode&&d.draft.revision===op.target.baseVersion))??false
  const gapLabels:Record<string,string>={missing:'자료 없음',stale:'이전 판본',unsupported:'미지원',timeout:'조회 시간 초과',unverified:'검증 전'}
  return <section className="writing-ai" aria-labelledby="writing-ai-title">
    <h2 id="writing-ai-title">AI 집필 도우미</h2>
    <p className="small muted">{props.episode}화 · 원고 판 {props.revision} · {props.selection.end>props.selection.start?`선택 ${props.selection.start}–${props.selection.end}`:'원고 전체 문맥'}. 제안은 승인 전까지 원고에 반영되지 않아요.</p>
    {!props.available&&<p role="status">원고 저장을 마친 뒤 요청해 주세요. 원작 기준 원고는 수정할 수 없어요.</p>}
    <form onSubmit={e=>{e.preventDefault();void vm.start()}}>
      <label className="field">도움받을 작업<select className="inp" value={vm.operation} disabled={active||vm.busy} onChange={e=>{const value=e.target.value;if(value==='ask'||value==='review'||value==='edit'||value==='next_draft')vm.setOperation(value)}}><option value="ask">자료에 질문</option><option value="review">설정·원고 검수</option><option value="edit">선택 구간 수정</option><option value="next_draft">다음 회차 초안 제안</option></select></label>
      <label className="field">AI에게 요청<textarea className="inp" rows={3} maxLength={2000} required value={vm.prompt} disabled={active||vm.busy} onChange={e=>vm.setPrompt(e.target.value)}/></label>
      <label className="writing-rights"><input type="checkbox" checked={vm.consent} disabled={active||vm.busy} onChange={e=>vm.setConsent(e.target.checked)}/> OpenAI에 허용 문맥을 전달하고 최대 1회 모델 호출 비용이 발생할 수 있음에 동의합니다.</label>
      <div className="writing-ai-actions"><button className="btn pri" disabled={!props.available||vm.busy||active||!vm.consent||!vm.prompt.trim()}>요청 보내기</button>{active&&<button type="button" className="btn" onClick={()=>void vm.cancel()}>AI 작업 취소</button>}</div>
    </form>
    <p role="status" aria-live="polite">{state?.receipt?({applied:'변경사항을 저장했어요.',rejected:'제안을 거절했어요.',revision_requested:'재수정 요청을 기록했어요. 새 초안 자동 생성은 아직 지원하지 않아요.'}[state.receipt]??state.receipt):state?.message??'작업을 선택하고 요청을 입력해 주세요.'}</p>
    {!vm.connected&&active&&<p role="status">진행 연결이 끊겨 다시 연결하고 있어요. 작업은 취소되지 않았으며 상태 조회를 계속합니다.</p>}
    {state?.error&&<p role="alert">{state.error}</p>}
    {state?.details&&<div className="writing-ai-result"><h3>검토 결과 {state.details.status==='partial'&&'· 일부 결과'}</h3>{state.details.isMock&&<p>테스트 전용 Mock 결과 · 실제 적용 불가</p>}<p>{state.details.text}</p>{state.details.coverage?<p>확인한 근거 {state.details.coverage.verifiedCount} / {state.details.coverage.expectedCount} · 누락: {state.details.coverage.gaps.map(g=>gapLabels[g]??'확인 필요').join(', ')||'없음'}</p>:<p>Coverage가 제공되지 않았어요. 전체 검수 완료를 뜻하지 않아요.</p>}<h4>인용 근거</h4>{state.details.citations.map((c,i)=><blockquote key={i}><p>{c.quote}</p><cite>{c.episode}화</cite></blockquote>)}</div>}
    {proposal&&<div className="writing-ai-result"><h3>변경 제안 · 판 {proposal.changeSet.proposalVersion}</h3>{mock&&<p role="status">테스트 전용 Mock 근거 · 실제 원고에 적용할 수 없어요.</p>}<p>근거 {proposal.changeSet.evidence.length}개 · 아래 내용을 검토한 뒤 승인해 주세요.</p>{proposal.changeSet.operations.map((op,i)=><div key={i}><h4>{op.target.episode}화 · {op.op==='create'?'새 회차':'수정 제안'}</h4>{op.op!=='create'&&<><p>기존 내용</p><pre><del>{(()=>{const d=props.drafts.find(d=>d.number===op.target.episode)?.draft;return !d?'현재 원고를 다시 불러와 주세요.':op.span?d.body.slice(op.span.start,op.span.end):op.fields.map(f=>`${f.name==='title'?'제목':'본문'}: ${f.name==='title'?d.title:d.body}`).join('\n')})()}</del></pre></>}<p>제안 내용</p><pre><ins>{op.content??op.fields.map(f=>`${f.name==='title'?'제목':'본문'}: ${f.value}`).join('\n')}</ins></pre></div>)}<div className="writing-ai-actions"><button type="button" className="btn pri" disabled={vm.busy||!props.available||!canReview||mock||proposal.status!=='pending'} onClick={()=>void vm.decide('approve')}>검토한 변경 승인</button><button type="button" className="btn" disabled={vm.busy} onClick={()=>void vm.decide('reject')}>거절</button><button type="button" className="btn" disabled={vm.busy} onClick={()=>void vm.decide('revise')}>재수정 요청 기록</button></div></div>}
  </section>
}

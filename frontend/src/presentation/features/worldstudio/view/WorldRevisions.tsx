import {useEffect,useId,useRef} from 'react'
import type {WorldRevision} from '../../../../domain/entities/studioWorld'
import type {useWorldRevisions} from '../viewmodel/useWorldRevisions'
import type {useWorldStudioViewModel} from '../viewmodel/useWorldStudioViewModel'
type Studio=ReturnType<typeof useWorldStudioViewModel>
type Revisions=ReturnType<typeof useWorldRevisions>
/**
 * 열어 본 확정 버전의 카드로 초안을 되돌리는 버튼(카드만: 관계·이름·소개·공개 설정은 그대로이고 새 확정 버전은 만들지 않는다). 확인 창이 사라지는 설정 카드 수와 그대로인 것을 알린다.
 * 저장하지 않은 변경·미확인 확정/AI 요청이 있으면 이유와 함께 잠근다(되돌리면 서버 초안이 바뀌므로 저장된 초안에서만 한다).
 */
function RestoreRevision({studio,vm,detail}:{studio:Studio;vm:Revisions;detail:WorldRevision}){
 const reason=useId()
 // 되돌리는 동안 버튼이 잠겨 초점이 body로 빠지므로, 끝나면 누른 버튼으로 돌려놓는다.
 const button=useRef<HTMLButtonElement>(null),refocus=useRef(false)
 useEffect(()=>{if(!vm.busy&&refocus.current){refocus.current=false;button.current?.focus()}},[vm.busy])
 const why=studio.dirty||studio.relationDirty?'저장하지 않은 변경이 있어 되돌릴 수 없어요. 먼저 세계관을 저장하세요.':vm.pending?'확정 결과를 확인하기 전에는 되돌릴 수 없어요.':vm.aiPending?'AI 요청 결과를 확인하기 전에는 되돌릴 수 없어요.':''
 const restore=()=>{
  const kept=new Set(detail.cards.filter(c=>c.card.lifecycle==='active').map(c=>c.card.id))
  const gone=(studio.saved?.settings??[]).filter(s=>s.item.kind!=='relation'&&!kept.has(s.item.id)).length
  const vanish=gone?`지금 초안에서 사라지는 설정 카드 ${gone}개는 삭제 상태가 돼요.`:'사라지는 설정 카드는 없어요.'
  if(window.confirm(`확정 버전 ${detail.revisionNo}의 카드로 초안을 되돌릴까요?\n- ${vanish}\n- 관계는 그대로예요. 이 버전의 관계로 바꾸지 않아요.\n- 텍스트 복원은 과거 이미지까지 보장하지 않아요.\n- 새 확정 버전은 만들지 않아요. 마음에 들면 '확정 버전 남기기'로 직접 남기세요.`)){refocus.current=true;void vm.restore(detail.revisionId,detail.revisionNo)}
 }
 return <div className="initial-actions"><button ref={button} type="button" className="btn" disabled={vm.busy||!!why} aria-describedby={why?reason:undefined} onClick={restore}>이 버전으로 초안 되돌리기</button>{why&&<p id={reason} role="status" className="small muted">{why}</p>}</div>
}
/** 확정 버전 시트의 내용. 목록·상세 상태(`revisions`)는 편집 화면의 버전 그래프와 같은 훅 하나를 나눠 쓴다. */
export function WorldRevisions({studio,revisions:vm}:{studio:Studio;revisions:Revisions}){
 if(!vm.supported)return <section><h3>확정 버전</h3><p>목업에서는 확정 버전 생성과 서버 조회를 지원하지 않아요.</p></section>
 const current=vm.rows.find(r=>r.revisionId===studio.saved?.currentRevisionId)
 return <section className="world-revisions" aria-label="세계관 확정 버전" aria-busy={vm.busy}>
  <h3>확정 버전</h3><p>초안 저장과 별개로, 현재 저장된 카드·설정의 내용을 변경되지 않는 버전으로 남겨요. AI 후보 승인·반영이나 작품 공개·회차 발행과는 다른 작업이에요.</p>
  <p>현재 초안의 기준: {current?`확정 버전 ${current.revisionNo}`:studio.saved?.currentRevisionId?'기존 확정 버전':'아직 확정한 버전 없음'}</p>
  {(studio.dirty||studio.relationDirty)&&<p role="status">미저장 입력이 있어요. 작성 화면에서 초안을 먼저 저장해 주세요.</p>}
  {!studio.dirty&&!studio.relationDirty&&studio.sealIssues.length>0&&<div role="status"><p>확정 버전으로 남기려면 저장된 카드마다 설명이 있어야 해요.</p><ul>{studio.sealIssues.map((issue,i)=><li key={i}>{issue.message}</li>)}</ul></div>}
  {vm.aiPending&&<p role="status">미확인 AI 요청이 있어요. AI 후보 검토에서 결과를 먼저 확인해 주세요.</p>}
  {vm.error&&<p role="alert" className="world-error">{vm.error}</p>}{vm.message&&<p role="status">{vm.message}</p>}
  <div className="initial-actions"><button className="btn pri" disabled={vm.busy||vm.pending||vm.aiPending||studio.dirty||studio.relationDirty||!studio.saved||studio.sealIssues.length>0} onClick={()=>vm.confirm()}>저장된 초안을 확정 버전으로 남기기</button><button className="btn" disabled={vm.busy||studio.dirty||studio.relationDirty} onClick={vm.refresh}>최신 저장 상태 확인</button></div>
  {vm.superseded&&<div role="status"><p>확정 버전 {vm.superseded.revisionNo} 저장 완료, 이후 새 버전이 생성됨</p><p>확인 당시의 최신 기준: 확정 버전 {vm.superseded.currentRevisionNo}. 아래 버튼은 저장 결과만 확인하며 새 확정 버전을 만들지 않아요.</p><button className="btn" disabled={vm.busy||studio.dirty||studio.relationDirty||vm.aiPending} onClick={vm.acknowledgeSuperseded}>결과 확인 후 계속 작성</button></div>}
  {vm.pending&&!vm.superseded&&<div role="status"><p>확정 결과가 미확인이에요. 새 버전을 만들지 않고 동일 요청으로 확인해요.</p><button className="btn" disabled={vm.busy||studio.dirty||studio.relationDirty||vm.aiPending} onClick={()=>vm.confirm(true)}>같은 확정 요청으로 확인</button></div>}
  <h4>확정 버전 목록</h4>{!vm.rows.length&&!vm.busy&&<p>아직 확정 버전이 없어요.</p>}
  <ul>{vm.rows.map(r=><li key={r.revisionId}><button className="btn" disabled={vm.busy} aria-pressed={vm.detail?.revisionId===r.revisionId} onClick={()=>vm.open(r.revisionId)}>확정 버전 {r.revisionNo} · {r.name}{studio.saved?.currentRevisionId===r.revisionId?' · 현재 기준':''}</button><time dateTime={r.createdAt}>{new Date(r.createdAt).toLocaleString('ko-KR')}</time></li>)}</ul>
  {vm.detail&&<section className="world-confirmed" aria-label="확정 버전 읽기 전용"><h4>확정 버전 {vm.detail.revisionNo} · 읽기 전용</h4><p>현재 작성 중인 초안이 아닌, 확정 당시의 카드·설정이에요.</p><h5>{vm.detail.name}</h5><p className="world-prose">{vm.detail.description}</p><p role="note">관계의 과거 상태는 저장하지 않아요. 현재 관계를 이 버전의 관계로 표시하지 않아요. 초안으로 되돌려도 카드만 바뀌고 관계는 그대로예요.</p>
   <RestoreRevision studio={studio} vm={vm} detail={vm.detail}/>
   {vm.detail.cards.map(({versionId,card})=><article key={versionId}><h5>{card.title}{card.lifecycle==='removed'?' · 삭제 상태':''}</h5><p className="world-prose">{card.body}</p>{!!card.aliases.length&&<p>별칭: {card.aliases.join(', ')}</p>}{!!card.tags.length&&<p>태그: {card.tags.join(', ')}</p>}</article>)}
  </section>}
 </section>
}

import type {useWorldRevisions} from '../viewmodel/useWorldRevisions'
import type {useWorldStudioViewModel} from '../viewmodel/useWorldStudioViewModel'
/** 확정 버전 시트의 내용. 목록·상세 상태(`revisions`)는 편집 화면의 버전 그래프와 같은 훅 하나를 나눠 쓴다. */
export function WorldRevisions({studio,revisions:vm}:{studio:ReturnType<typeof useWorldStudioViewModel>;revisions:ReturnType<typeof useWorldRevisions>}){
 if(!vm.supported)return <section><h3>확정 버전</h3><p>목업에서는 확정 버전 생성과 서버 조회를 지원하지 않습니다.</p></section>
 const current=vm.rows.find(r=>r.revisionId===studio.saved?.currentRevisionId)
 return <section className="world-revisions" aria-label="세계관 확정 버전" aria-busy={vm.busy}>
  <h3>확정 버전</h3><p>초안 저장과 별개로, 현재 저장된 카드·설정의 내용을 변경되지 않는 버전으로 남깁니다. AI 후보 승인·반영이나 작품 공개·회차 발행과는 다른 작업입니다.</p>
  <p>현재 초안의 기준: {current?`확정 버전 ${current.revisionNo}`:studio.saved?.currentRevisionId?'기존 확정 버전':'아직 확정한 버전 없음'}</p>
  {(studio.dirty||studio.relationDirty)&&<p role="status">미저장 입력이 있습니다. 작성 화면에서 초안을 먼저 저장해 주세요.</p>}
  {vm.aiPending&&<p role="status">미확인 AI 요청이 있습니다. AI 후보 검토에서 결과를 먼저 확인해 주세요.</p>}
  {vm.error&&<p role="alert" className="world-error">{vm.error}</p>}{vm.message&&<p role="status">{vm.message}</p>}
  <div className="initial-actions"><button className="btn pri" disabled={vm.busy||vm.pending||vm.aiPending||studio.dirty||studio.relationDirty||!studio.saved} onClick={()=>vm.confirm()}>저장된 초안을 확정 버전으로 남기기</button><button className="btn" disabled={vm.busy||studio.dirty||studio.relationDirty} onClick={vm.refresh}>최신 저장 상태 확인</button></div>
  {vm.superseded&&<div role="status"><p>확정 버전 {vm.superseded.revisionNo} 저장 완료, 이후 새 버전이 생성됨</p><p>확인 당시 최신 기준은 확정 버전 {vm.superseded.currentRevisionNo}입니다. 아래 버튼은 저장 결과만 확인하며 새 확정 버전을 만들지 않습니다.</p><button className="btn" disabled={vm.busy||studio.dirty||studio.relationDirty||vm.aiPending} onClick={vm.acknowledgeSuperseded}>결과 확인 후 계속 작성</button></div>}
  {vm.pending&&!vm.superseded&&<div role="status"><p>확정 결과가 미확인입니다. 새 버전을 만들지 않고 동일 요청으로 확인합니다.</p><button className="btn" disabled={vm.busy||studio.dirty||studio.relationDirty||vm.aiPending} onClick={()=>vm.confirm(true)}>같은 확정 요청으로 확인</button></div>}
  <h4>확정 버전 목록</h4>{!vm.rows.length&&!vm.busy&&<p>아직 확정 버전이 없습니다.</p>}
  <ul>{vm.rows.map(r=><li key={r.revisionId}><button className="btn" disabled={vm.busy} aria-pressed={vm.detail?.revisionId===r.revisionId} onClick={()=>vm.open(r.revisionId)}>확정 버전 {r.revisionNo} · {r.name}{studio.saved?.currentRevisionId===r.revisionId?' · 현재 기준':''}</button><time dateTime={r.createdAt}>{new Date(r.createdAt).toLocaleString('ko-KR')}</time></li>)}</ul>
  {vm.detail&&<section className="world-confirmed" aria-label="확정 버전 읽기 전용"><h4>확정 버전 {vm.detail.revisionNo} · 읽기 전용</h4><p>현재 작성 중인 초안이 아닌, 확정 당시의 카드·설정입니다.</p><h5>{vm.detail.name}</h5><p className="world-prose">{vm.detail.description}</p><p role="note">관계의 과거 상태는 저장하지 않습니다. 현재 관계를 이 버전의 관계로 표시하지 않으며, 버전 복원 기능도 지원하지 않습니다.</p>
   {vm.detail.cards.map(({versionId,card})=><article key={versionId}><h5>{card.title}{card.lifecycle==='removed'?' · 삭제 상태':''}</h5><p className="world-prose">{card.body}</p>{!!card.aliases.length&&<p>별칭: {card.aliases.join(', ')}</p>}{!!card.tags.length&&<p>태그: {card.tags.join(', ')}</p>}</article>)}
  </section>}
 </section>
}

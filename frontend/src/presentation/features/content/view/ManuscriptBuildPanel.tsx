import type {Work} from '../../../../domain/entities/content'
import type {ManuscriptBuildUseCase} from '../../../../domain/usecases/ManuscriptBuildUseCase'
import {Go} from '../../../shared/Go'
import {useManuscriptBuild} from '../viewmodel/useManuscriptBuild'
const states={queued:'분석을 준비하고 있어요',running:'원고를 분석하고 있어요',loading:'세계관 초안에 저장하고 있어요',failed:'분석이 멈췄어요',unknown:'저장 또는 실행 결과를 확인해야 해요',completed:'세계관 초안이 준비됐어요'}
const reasons:Record<string,string>={AI_TIMEOUT:'시간 안에 분석 응답을 받지 못했어요. 저장된 성공 결과를 유지하고 같은 작업을 재개할 수 있어요.',AI_OUTPUT_INVALID:'분석 결과를 검증하지 못했어요. 잘못된 결과는 초안에 넣지 않았어요.',AI_RESPONSE_UNCONFIRMED:'분석 응답을 확인하지 못했어요. 새 작업을 만들지 말고 같은 작업을 확인해 주세요.',EXECUTION_EXPIRED:'서버 중단 등으로 실행 결과를 확인하지 못했어요. 저장된 결과에서 같은 작업을 재개해 주세요.',SOURCE_CHANGED:'시작 이후 저장된 원고가 달라졌어요. 원래 입력 기준을 확인해야 하며 새 원고를 자동 반영하지 않아요.',WORLD_LINK_CHANGED:'작품의 세계관 연결이 바뀌었어요. 원래 연결을 확인해 주세요.',LOAD_RESULT_UNCONFIRMED:'초안 저장 완료를 확인하지 못했어요. 같은 요청으로 저장 결과를 복구해 주세요.'}
export function ManuscriptBuildPanel({work,useCase}:{work:Pick<Work,'id'|'worldStudioId'|'episodes'>;useCase?:ManuscriptBuildUseCase}){
 const vm=useManuscriptBuild(work.id,work.worldStudioId,useCase),job=vm.job
 return <section className="tcard ep-card" aria-label="원고로 세계관 만들기">
  <h2>원고로 세계관 만들기</h2>
  <p>저장된 원고로 비공개 세계관 초안을 만들어요.</p>
  <p className="ep-muted">현재 저장된 회차 전체를 한 번 분석해 인물·설정·관계를 정리해요. 원고를 올리는 것만으로 분석하거나 발행하지 않아요. 이후 새 회차도 자동 반영하지 않아요.</p>
  {!job&&<><p>기존 카드가 있는 세계관은 자동으로 합치지 않아요. 연결된 세계관이 없다면 새 세계관을 만들어요.</p>
   <label><input type="checkbox" checked={vm.consent} disabled={vm.busy} onChange={e=>vm.setConsent(e.target.checked)}/>저장된 원고의 AI 분석과 비공개 초안 생성을 시작하는 데 동의해요.</label>
   <div className="ep-card-actions"><button className="btn pri" disabled={!vm.ready||vm.busy||!vm.consent||!!vm.error} onClick={()=>void vm.start()}>세계관 만들기</button></div>
   <p>저장된 비공개 원고도 대상이에요. 서버에서 저장된 원고가 있는지 확인해요.</p></>}
  {job&&<><p role="status">{states[job.status]}</p><p>추출 결과 저장 {job.completedEpisodes} / {job.totalEpisodes}화</p>
   {job.failureCode&&<p>{reasons[job.failureCode]??'결과를 검증하지 못했어요. 원고와 작업 상태를 확인해 주세요.'}</p>}
   {job.status==='unknown'&&!job.failureCode&&<p>완료로 확인되지 않았어요. 원래 요청을 유지해 복구해 주세요.</p>}
   {['failed','unknown','loading'].includes(job.status)&&<button className="btn" disabled={vm.busy} onClick={()=>void vm.resume()}>같은 작업 재개</button>}
   {job.status==='completed'&&<><p>초안 생성만으로 확정하거나 공개하지 않아요. 작업실에서 내용을 검토·수정한 뒤 직접 확정해 주세요. 첫 등장 회차는 출처 정보이며 독자 공개 회차는 별도로 지정해야 해요.</p><Go className="btn pri" to={'/worldstudio/'+job.worldId}>세계관 초안 열기</Go></>}
  </>}
  {vm.error&&<p role="alert" className="ep-alert">{vm.error}</p>}
  <div className="ep-card-actions"><button className="btn sm" disabled={vm.busy} onClick={()=>void vm.refresh()}>작업 상태 다시 확인</button></div>
  {vm.busy&&<p role="status">작업 상태를 확인하고 있어요…</p>}
 </section>
}

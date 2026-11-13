import type { StudioWorld } from '../../../../domain/entities/studioWorld'

/** 저장된 AI 후보를 원문 근거와 함께 읽기 전용 카드로 보여 줍니다(후보 검토 화면과 같은 카드, 근거는 `근거 보기`). 후보 생성·확정 반영은 이 화면에서 지원하지 않습니다. */
export function WorldCandidates({analysis}:{analysis:StudioWorld['analysis']}) {
 const pending=analysis?.candidates.filter(c=>c.decision==='pending')??[]
 if(!pending.length)return <p className="muted">저장된 AI 후보가 없어요.</p>
 return <div className="initial-review"><h4>AI 후보 · 미확정 {pending.length}개</h4><p className="small muted">원문 근거와 대조해 채택 여부를 판단할 후보예요. 확정 설정·설정집에는 포함되지 않아요.</p>
  <div className="initial-cards">{pending.map(c=><article className="initial-card" key={c.id}>
   <h5>{c.title}</h5><p className="initial-copy initial-clamp">{c.text}</p>
   <details><summary>근거 보기</summary><blockquote className="small muted">원문 근거: {c.evidence.map(e=>e.quote).join(' / ')}</blockquote></details>
  </article>)}</div>
 </div>
}

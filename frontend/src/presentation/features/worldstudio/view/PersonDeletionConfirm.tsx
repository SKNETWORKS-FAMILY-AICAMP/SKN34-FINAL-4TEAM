import { relationLabel, type personDeletionInfo } from '../../../../domain/entities/studioRelations'

export function PersonDeletionConfirm({deletion,onDelete,onCancel}:{deletion:ReturnType<typeof personDeletionInfo>;onDelete:()=>void;onCancel:()=>void}) {
 return <section aria-label="인물 삭제 확인">
  <h4>{deletion.person.item.title} 삭제 확인</h4>
  <p>인물과 연결된 관계·감정 {deletion.relations.length}개를 편집본에서 삭제합니다. 저장해야 반영됩니다.</p>
  <ul>{deletion.relations.map(r=><li key={r.item.id}>{relationLabel(r.item)}</li>)}</ul>
  {!!deletion.blockers.length&&<div role="alert"><p>다른 설정에서 참조하고 있어 삭제할 수 없습니다. 연결을 먼저 정리해 주세요.</p><ul>{deletion.blockers.map(row=><li key={row.item.id}>{row.item.title}</li>)}</ul></div>}
  <button type="button" className="btn relationship-remove" disabled={!!deletion.blockers.length} onClick={onDelete}>인물과 연결 삭제</button>
  <button type="button" className="btn" onClick={onCancel}>삭제 취소</button>
 </section>
}

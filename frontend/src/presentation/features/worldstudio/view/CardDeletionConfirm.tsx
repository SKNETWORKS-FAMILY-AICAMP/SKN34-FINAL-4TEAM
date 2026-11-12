import { cardTypeOf } from '../../../../domain/entities/studioCards'
import { relationLabel, type cardDeletionInfo } from '../../../../domain/entities/studioRelations'

/**
 * 설정 카드(유형 무관) 삭제 확인: 이어진 관계·감정은 함께 지워지고, 남는 설정이 아직 참조하는 카드는 지우지 못하게 막는다. 인물은 '인물', 그 밖은 '설정'이라 부른다.
 * 설정집 편집 화면과 인물 관계도의 '선택한 인물 삭제'가 같은 확인을 쓴다.
 */
export function CardDeletionConfirm({ deletion, onDelete, onCancel }: { deletion: ReturnType<typeof cardDeletionInfo>; onDelete: () => void; onCancel: () => void }) {
  const noun = cardTypeOf(deletion.card.item) === 'character' ? '인물' : '설정'
  return (
    <section aria-label={`${noun} 삭제 확인`} className="world-delete-confirm">
      <h4>{deletion.card.item.title || '이름 없는 설정'} 삭제 확인</h4>
      <p>{noun}과 연결된 관계·감정 {deletion.relations.length}개를 편집본에서 삭제합니다. 저장해야 반영됩니다.</p>
      <ul>{deletion.relations.map((r) => <li key={r.item.id}>{relationLabel(r.item)}</li>)}</ul>
      {!!deletion.blockers.length && <div role="alert"><p>다른 설정에서 참조하고 있어 삭제할 수 없습니다. 연결을 먼저 정리해 주세요.</p><ul>{deletion.blockers.map((row) => <li key={row.item.id}>{row.item.title}</li>)}</ul></div>}
      <div className="world-delete-actions">
        <button type="button" className="btn relationship-remove" disabled={!!deletion.blockers.length} onClick={onDelete}>{noun}과 연결 삭제</button>
        <button type="button" className="btn" onClick={onCancel}>삭제 취소</button>
      </div>
    </section>
  )
}

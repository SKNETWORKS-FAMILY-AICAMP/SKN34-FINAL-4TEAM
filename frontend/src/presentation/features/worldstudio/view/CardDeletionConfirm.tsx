import { useEffect, useRef } from 'react'

import { cardTypeOf } from '../../../../domain/entities/studioCards'
import { relationLabel, type cardDeletionInfo } from '../../../../domain/entities/studioRelations'

/**
 * 설정 카드(유형 무관) 삭제 확인: 이어진 관계·감정은 함께 지워지고, 남는 설정이 아직 참조하는 카드는 지우지 못하게 막는다. 인물은 '인물', 그 밖은 '설정'이라 부른다.
 * 설정집 편집 화면과 인물 관계도의 '선택한 인물 삭제'가 같은 확인을 쓴다.
 * 확인은 누른 버튼과 떨어진 자리(편집 화면에서는 긴 편집 열의 맨 아래)에 열리므로, 열리면 이 영역으로 초점을 옮겨 보이는 곳으로 스크롤되고 읽히게 한다.
 * 닫히면 열었던 버튼으로 초점을 돌려준다. 카드를 지워 그 버튼이 사라졌거나 잠겼으면 초점은 부르는 화면이 정한다.
 */
export function CardDeletionConfirm({ deletion, onDelete, onCancel }: { deletion: ReturnType<typeof cardDeletionInfo>; onDelete: () => void; onCancel: () => void }) {
  const noun = cardTypeOf(deletion.card.item) === 'character' ? '인물' : '설정'
  const box = useRef<HTMLElement>(null)
  useEffect(() => {
    const opener = document.activeElement
    box.current?.focus()
    return () => { if (opener instanceof HTMLElement && opener !== document.body && opener.isConnected) opener.focus() }
  }, [])
  return (
    <section ref={box} tabIndex={-1} aria-label={`${noun} 삭제 확인`} className="world-delete-confirm">
      <h4>{deletion.card.item.title || '이름 없는 설정'} 삭제 확인</h4>
      <p>{noun}과 연결된 관계·감정 {deletion.relations.length}개를 편집본에서 삭제해요. 저장해야 반영돼요.</p>
      <ul>{deletion.relations.map((r) => <li key={r.item.id}>{relationLabel(r.item)}</li>)}</ul>
      {!!deletion.blockers.length && <div role="alert"><p>다른 설정에서 참조하고 있어 삭제할 수 없어요. 연결을 먼저 정리해 주세요.</p><ul>{deletion.blockers.map((row) => <li key={row.item.id}>{row.item.title}</li>)}</ul></div>}
      <div className="world-delete-actions">
        <button type="button" className="btn relationship-remove" disabled={!!deletion.blockers.length} onClick={onDelete}>{noun}과 연결 삭제</button>
        <button type="button" className="btn" onClick={onCancel}>삭제 취소</button>
      </div>
    </section>
  )
}

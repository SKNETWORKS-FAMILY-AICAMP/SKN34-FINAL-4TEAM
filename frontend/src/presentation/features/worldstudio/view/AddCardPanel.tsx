import { useEffect, useRef, useState } from 'react'
import { cardTypes, type CardType } from '../../../../domain/entities/studioCards'
import { CARD_COLORS, CARD_KIND } from '../../../shared/worldBoard'

/**
 * 관계도의 `+ 설정 추가` 패널(n8n의 노드 추가 패널처럼 캔버스 오른쪽에서 열린다): 유형을 이름으로 찾아(검색) 8유형(인물·장소·조직·능력·사물·규칙·사건·기타) 중 하나를 고르면 그 유형의 새 카드를 더한다.
 * 카드를 어디에 놓고 어떻게 보이게 할지는 부르는 캔버스가 정한다. 열리면 검색 칸으로 초점이 가고 Esc·닫기로 닫는다(닫은 뒤 초점은 연 버튼으로 돌려주는 일도 캔버스가 맡는다).
 */
export function AddCardPanel({ onAdd, onClose, busy = false }: { onAdd: (type: CardType) => void; onClose: () => void; busy?: boolean }) {
  const [query, setQuery] = useState('')
  const search = useRef<HTMLInputElement>(null)
  useEffect(() => { search.current?.focus() }, [])
  const found = cardTypes.filter((type) => type.label.includes(query.trim()))
  return (
    <aside className="relationship-add-panel" role="dialog" aria-label="설정 추가" onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); onClose() } }}>
      <div className="relationship-add-head">
        <h4>설정 추가</h4>
        <button type="button" className="btn sm" onClick={onClose}>닫기</button>
      </div>
      <input ref={search} type="search" className="inp" aria-label="설정 유형 검색" placeholder="이름으로 찾기" autoComplete="off" value={query} onChange={(e) => setQuery(e.target.value)} />
      <ul>
        {found.map((type) => (
          <li key={type.id}>
            <button type="button" className="btn" disabled={busy} onClick={() => onAdd(type.id)}>
              <i className="relationship-kind" style={{ background: CARD_COLORS[CARD_KIND[type.id]] }} aria-hidden="true" />{type.label}
            </button>
          </li>
        ))}
      </ul>
      {!found.length && <p className="small muted">맞는 유형이 없어요.</p>}
    </aside>
  )
}

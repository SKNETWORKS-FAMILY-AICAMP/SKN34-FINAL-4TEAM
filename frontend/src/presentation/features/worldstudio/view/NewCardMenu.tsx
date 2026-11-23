import { useId, type ReactNode } from 'react'

import { categoryChoices, categoryIcon } from '../../../../domain/entities/cardCategory'
import type { CardType } from '../../../../domain/entities/studioCards'
import { PopMenu } from '../../../shared/PopMenu'
import { useCardCategories } from '../../../shared/useCardCategories'
import type { useWorldStudioViewModel } from '../viewmodel/useWorldStudioViewModel'

type VM = ReturnType<typeof useWorldStudioViewModel>

/**
 * '+ 새 설정': 눌러서 유형(운영자가 관리하는 활성 카드 카테고리: 기본 8종 인물·장소·조직·능력·사물·규칙·사건·기타 + 추가한 것)을 고르면 그 유형의 카드를 초안에 더하고 바로 편집 화면을 연다(주소 `?card=<새 id>`).
 * 설정집 게시판 도구줄(글자 버튼)과 편집 화면 레일 머리(아이콘 버튼)가 함께 쓴다. `before`는 새 카드가 목록에 보이도록 필터를 되돌리는 등 더하기 직전에 할 일이다.
 * 카테고리 목록을 읽는 동안·읽지 못했을 때는 기본 8종으로 대신하지 않고 그 사실(불러오는 중 / 불러오지 못함 + 다시 시도)만 보인다.
 * 안내 문단은 항목이 아니라 화면 읽기 프로그램이 지나치므로 id를 주어 메뉴의 설명(`PopMenu`)과 다시 시도 항목의 설명으로 읽히게 한다.
 */
export function NewCardMenu({ vm, trigger, className, before }: { vm: VM; trigger: ReactNode; className?: string; before?: () => void }) {
  const { categories, isError, retry } = useCardCategories()
  const noteId = useId()
  const add = (type: CardType) => {
    before?.()
    const id = vm.addCard(type)
    if (id) vm.editCard(id)
  }
  const unavailable = isError
    ? (
      <>
        <p id={noteId} className="pop-menu-note" role="alert">카드 분류를 불러오지 못했어요.</p>
        {/* 메뉴는 항목을 누르면 닫히므로, 닫히지 않고 이 자리에서 다시 읽도록 누름이 메뉴까지 올라가지 않게 한다. */}
        <button type="button" role="menuitem" aria-describedby={noteId} onClick={(e) => { e.stopPropagation(); retry() }}>다시 시도</button>
      </>
    )
    : <p id={noteId} className="pop-menu-note" role="status">카드 분류를 불러오고 있어요.</p>
  return (
    <PopMenu className={className} label="새 설정" icon={trigger}>
      {categories
        ? categoryChoices(categories).map((category) => <button key={category.code} type="button" role="menuitem" disabled={vm.busy} onClick={() => add(category.code)}>{categoryIcon(category)}</button>)
        : unavailable}
    </PopMenu>
  )
}

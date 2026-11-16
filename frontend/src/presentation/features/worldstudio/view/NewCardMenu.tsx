import type { ReactNode } from 'react'

import { cardTypes, type CardType } from '../../../../domain/entities/studioCards'
import { PopMenu } from '../../../shared/PopMenu'
import type { useWorldStudioViewModel } from '../viewmodel/useWorldStudioViewModel'

type VM = ReturnType<typeof useWorldStudioViewModel>

/**
 * '+ 새 설정': 눌러서 유형(인물·장소·조직·능력·사물·규칙·사건·기타)을 고르면 그 유형의 카드를 초안에 더하고 바로 편집 화면을 연다(주소 `?card=<새 id>`).
 * 설정집 게시판 도구줄(글자 버튼)과 편집 화면 레일 머리(아이콘 버튼)가 함께 쓴다. `before`는 새 카드가 목록에 보이도록 필터를 되돌리는 등 더하기 직전에 할 일이다.
 */
export function NewCardMenu({ vm, trigger, className, before }: { vm: VM; trigger: ReactNode; className?: string; before?: () => void }) {
  const add = (type: CardType) => {
    before?.()
    const id = vm.addCard(type)
    if (id) vm.editCard(id)
  }
  return (
    <PopMenu className={className} label="새 설정" icon={trigger}>
      {cardTypes.map((type) => <button key={type.id} type="button" role="menuitem" disabled={vm.busy} onClick={() => add(type.id)}>{type.label}</button>)}
    </PopMenu>
  )
}

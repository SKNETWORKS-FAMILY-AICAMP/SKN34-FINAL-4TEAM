import { useEffect, useRef } from 'react'

/** 목록 선택 시 상세 제목으로, 돌아오면 선택했던 버튼으로 포커스를 옮깁니다. heading은 상세 제목을 찾는 선택자이고, 다른 상세 안에 든 상세(프롬프트 상세 안의 평가 Run)는 h3를 줍니다. */
export function useAdminDetailFocus(selection: string | null, ready = true, listSize = 0, heading = 'h2[tabindex]') {
  const root = useRef<HTMLElement>(null)
  const previous = useRef<string | null>(selection)
  useEffect(() => {
    if (selection) {
      previous.current = selection
      root.current?.querySelector<HTMLElement>(heading)?.focus()
    } else {
      const records = Array.from(root.current?.querySelectorAll<HTMLElement>('[data-record-id]') ?? [])
      const record = records.find((node) => node.dataset.recordId === previous.current)
      // 행 조치 칸(⋮ 메뉴)이 id를 달고 있으면 그 안의 ⋮ 버튼으로 돌린다.
      const target = (record?.matches('button') ? record : record?.querySelector<HTMLElement>('button'))
        ?? root.current?.querySelector<HTMLElement>(heading)
      target?.focus()
    }
  }, [selection, ready, listSize, heading])
  return root
}

import { useEffect, useRef } from 'react'

/** 목록 선택 시 상세 제목으로, 돌아오면 선택했던 버튼으로 포커스를 옮깁니다. */
export function useAdminDetailFocus(selection: string | null, ready = true, listSize = 0) {
  const root = useRef<HTMLElement>(null)
  const previous = useRef<string | null>(selection)
  useEffect(() => {
    if (selection) {
      previous.current = selection
      root.current?.querySelector<HTMLElement>('h2[tabindex]')?.focus()
    } else {
      const buttons = Array.from(root.current?.querySelectorAll<HTMLButtonElement>('[data-record-id]') ?? [])
      const target = buttons.find((node) => node.dataset.recordId === previous.current)
        ?? root.current?.querySelector<HTMLElement>('h2[tabindex]')
      target?.focus()
    }
  }, [selection, ready, listSize])
  return root
}

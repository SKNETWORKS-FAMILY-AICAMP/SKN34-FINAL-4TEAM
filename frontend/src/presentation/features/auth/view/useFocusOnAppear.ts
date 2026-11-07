import { useEffect, useRef } from 'react'

/**
 * `active`가 참이 되거나 바뀌면 `tabIndex={-1}`을 준 요소로 초점을 옮깁니다.
 * 폼이 사라지거나 입력이 잠겨 초점을 잃은 뒤에도 결과·오류 메시지가 있는 곳에서 이어 가게 합니다.
 */
export function useFocusOnAppear<T extends HTMLElement>(active: unknown) {
  const ref = useRef<T>(null)
  useEffect(() => { if (active) ref.current?.focus() }, [active])
  return ref
}

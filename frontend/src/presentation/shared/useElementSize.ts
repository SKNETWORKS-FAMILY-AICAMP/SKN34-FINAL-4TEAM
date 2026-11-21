import { useLayoutEffect, useState, type RefObject } from 'react'

/**
 * 요소의 지금 크기(clientWidth·clientHeight): 사이드바 접기·AI 채팅 열기·창 크기·숨김→보임으로 크기가 바뀌면 ResizeObserver가 다시 재서 알린다.
 * 숨겨져(display:none) 있으면 0×0이라 그리는 쪽이 그리지 않는다. 캔버스·SVG가 컨테이너 크기를 재는 곳은 이 훅 하나다.
 */
export function useElementSize(ref: RefObject<HTMLElement | null>) {
  const [box, setBox] = useState({ w: 0, h: 0 })
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const update = () => setBox((old) => (old.w === el.clientWidth && old.h === el.clientHeight ? old : { w: el.clientWidth, h: el.clientHeight }))
    update()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(update)
    observer.observe(el)
    return () => observer.disconnect()
  }, [ref])
  return box
}

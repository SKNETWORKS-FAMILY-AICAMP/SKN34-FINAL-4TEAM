import { useRef, type KeyboardEvent, type PointerEvent } from 'react'

const STEP = 5

/**
 * 위·아래 두 영역 사이의 가로 분할선(ARIA window splitter)이다. value는 위 영역이 부모 높이에서 차지하는 비율(%)이고,
 * ↑↓로 5%씩, Home·End로 최소·최대로, 포인터로 끌어 조절한다. 값은 쓰는 화면이 로컬 상태로 가진다.
 */
export function ResizeSeparator({ label, controls, value, min, max, onChange }: {
  label: string; controls: string; value: number; min: number; max: number; onChange: (value: number) => void
}) {
  const dragging = useRef(false)
  const clamp = (n: number) => Math.min(max, Math.max(min, n))
  const key = (e: KeyboardEvent) => {
    const next = e.key === 'ArrowUp' ? value - STEP : e.key === 'ArrowDown' ? value + STEP : e.key === 'Home' ? min : e.key === 'End' ? max : null
    if (next === null) return
    e.preventDefault()
    onChange(clamp(next))
  }
  const move = (e: PointerEvent<HTMLDivElement>) => {
    const box = e.currentTarget.parentElement?.getBoundingClientRect()
    if (dragging.current && box?.height) onChange(clamp(Math.round((e.clientY - box.top) / box.height * 100)))
  }
  const stop = () => { dragging.current = false }
  return <div role="separator" aria-orientation="horizontal" aria-label={label} aria-controls={controls} aria-valuenow={value} aria-valuemin={min} aria-valuemax={max} tabIndex={0} className="writing-split"
    onKeyDown={key} onPointerMove={move} onPointerUp={stop} onPointerCancel={stop}
    onPointerDown={e => { dragging.current = true; e.currentTarget.setPointerCapture?.(e.pointerId) }} />
}

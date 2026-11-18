import type { MouseEvent, ReactNode } from 'react'

import { jumpTo } from './jumpTo'

/**
 * 문서 안 이동 링크(설정 위키·공개 세계관 설정집 공용). 목업 모드는 해시 라우터라 `#앵커`가 경로를 바꾸므로 기본 이동을 막고 직접 스크롤한다.
 * [flash]이면 도착한 문단을 잠깐 강조한다(관계 문단으로 가는 링크, DEC-54).
 */
export function Jump({ to, children, className, describedBy, flash }: { to: string; children: ReactNode; className?: string; describedBy?: string; flash?: boolean }) {
  const go = (e: MouseEvent) => {
    e.preventDefault()
    jumpTo(to, flash)
  }
  return <a href={`#${to}`} className={className} aria-describedby={describedBy} onClick={go}>{children}</a>
}

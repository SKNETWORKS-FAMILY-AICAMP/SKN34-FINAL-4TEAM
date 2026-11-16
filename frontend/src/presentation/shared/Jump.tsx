import type { MouseEvent, ReactNode } from 'react'

import { jumpTo } from './jumpTo'

/** 문서 안 이동 링크(설정 위키·공개 세계관 설정집 공용). 목업 모드는 해시 라우터라 `#앵커`가 경로를 바꾸므로 기본 이동을 막고 직접 스크롤한다. */
export function Jump({ to, children, className, describedBy }: { to: string; children: ReactNode; className?: string; describedBy?: string }) {
  const go = (e: MouseEvent) => {
    e.preventDefault()
    jumpTo(to)
  }
  return <a href={`#${to}`} className={className} aria-describedby={describedBy} onClick={go}>{children}</a>
}

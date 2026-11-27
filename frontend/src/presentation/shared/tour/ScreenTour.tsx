import { useEffect } from 'react'
import { Joyride, type TooltipRenderProps } from 'react-joyride'

import type { TourScreen } from './tourPrefs'
import { useScreenTour, type TourStep } from './useScreenTour'
import './screenTour.css'

export type { TourStep }

const LOCALE = { back: '이전', close: '투어 닫기', last: '완료', next: '다음', skip: '건너뛰기' }
/** 움직임을 줄이는 설정이면 스크롤 이동을 거의 즉시로 한다(joyride가 직접 스크롤을 애니메이션한다. 0은 쓰지 않는다: 첫 프레임에 0으로 나눈다). */
const scrollDuration = () => (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 1 : 300)

/** joyride의 기본 말풍선 대신 앱의 시트와 같은 토큰·버튼(.btn)으로 그린다. 버튼 동작·aria는 joyride가 준 props를 그대로 쓴다. */
function TourTooltip({ backProps, closeProps, primaryProps, skipProps, tooltipProps, index, size, isLastStep, step }: TooltipRenderProps) {
  return (
    <div {...tooltipProps} role="dialog" className="tour-tip" aria-labelledby="tour-title" aria-describedby="tour-text">
      <button type="button" className="tour-x" {...closeProps}>✕</button>
      <h3 id="tour-title">{step.title}</h3>
      <p id="tour-text">{step.content}</p>
      <div className="tour-foot">
        <span className="tour-count small muted">{index + 1} / {size}</span>
        {!isLastStep && <button type="button" className="btn sm weak" {...skipProps}>{LOCALE.skip}</button>}
        {index > 0 && <button type="button" className="btn sm" {...backProps}>{LOCALE.back}</button>}
        <button type="button" className="btn sm pri" {...primaryProps}>{isLastStep ? LOCALE.last : LOCALE.next}</button>
      </div>
    </div>
  )
}

/**
 * 화면 하나의 사용법 투어(#971): 작은 `사용법` 버튼(호출 측이 둔 자리, 모양은 className으로 그 줄의 버튼에 맞춘다)과 코치마크 투어를 함께 그린다.
 * 화면은 단계(`data-tour` 이름·제목·설명)와 화면 키만 넘긴다. 시작 조건·기억은 useScreenTour, 말풍선 위치·스포트라이트는 react-joyride가 맡는다.
 * 탭이 있는 화면(작품 관리·세계관 관리·설정 카드 작성)은 `tabs`(탭 키 → 단계)와 지금 탭 `tab`도 넘긴다: `steps`는 첫 진입의 메뉴 소개이고 사용법 버튼은 지금 탭의 투어를 연다.
 * 집필실처럼 탭 메뉴 대신 패널을 여닫는 화면은 `panel`을 켠다: 버튼은 `steps`를 열고 패널 투어는 그 패널이 처음 열릴 때만 저절로 뜬다.
 */
export function ScreenTour({ screen, steps, tabs, tab, panel, ready = true, className = 'btn sm' }: {
  screen: TourScreen
  steps: readonly TourStep[]
  tabs?: Record<string, readonly TourStep[]>
  tab?: string
  panel?: boolean
  ready?: boolean
  className?: string
}) {
  const tour = useScreenTour({ screen, steps, tabs, tab, panel, ready })
  const running = tour.active !== null
  // 투어가 떠 있는 동안 Esc·Tab은 투어만 받는다: 아래 시트(집필실 버전·공개 패널)가 같은 키로 닫히거나 초점을 가져오지 않게 body에서 막는다(joyride의 Esc는 body에 달려 있어 그대로 동작한다).
  useEffect(() => {
    if (!running) return
    const keep = (e: KeyboardEvent) => { if (e.key === 'Escape' || e.key === 'Tab') e.stopPropagation() }
    document.body.addEventListener('keydown', keep)
    return () => document.body.removeEventListener('keydown', keep)
  }, [running])
  return (
    <>
      <button type="button" className={className} aria-haspopup="dialog" disabled={!tour.canStart} onClick={tour.start}>사용법</button>
      {tour.active && (
        <Joyride
          run
          continuous
          steps={tour.active}
          onEvent={tour.onEvent}
          locale={LOCALE}
          tooltipComponent={TourTooltip}
          // 화면보다 큰 대상(좁은 화면의 편집기·긴 목록)에서도 말풍선이 화면 안에 남게 세로로도 밀어 넣는다.
          floatingOptions={{ hideArrow: true, shiftOptions: { crossAxis: true } }}
          styles={{ floater: { filter: 'none' } }}
          options={{
            skipBeacon: true,
            blockTargetInteraction: true,
            overlayClickAction: false,
            overlayColor: 'rgba(10, 10, 14, 0.5)',
            spotlightPadding: 8,
            spotlightRadius: 14,
            scrollDuration: scrollDuration(),
          }}
        />
      )}
    </>
  )
}

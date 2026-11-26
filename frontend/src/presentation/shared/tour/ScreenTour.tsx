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
 */
export function ScreenTour({ screen, steps, ready = true, className = 'btn sm' }: { screen: TourScreen; steps: readonly TourStep[]; ready?: boolean; className?: string }) {
  const tour = useScreenTour(screen, steps, ready)
  return (
    <>
      <button type="button" className={className} aria-haspopup="dialog" disabled={!ready} onClick={tour.start}>사용법</button>
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

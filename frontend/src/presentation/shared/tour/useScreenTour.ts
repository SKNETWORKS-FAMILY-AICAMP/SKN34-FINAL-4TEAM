import { createContext, useCallback, useContext, useEffect, useEffectEvent, useRef, useState } from 'react'
import { ACTIONS, EVENTS, type EventData, type Step } from 'react-joyride'

import { isTourSeen, markTourSeen, type TourScreen } from './tourPrefs'

/** 한 단계. target은 요소의 `data-tour` 값(`<화면>-<이름>`)이다: 문구·클래스로 요소를 찾지 않는다. */
export type TourStep = { target: string; title: string; text: string }

/**
 * 투어를 저절로 시작할지. 앱(App)만 켠다: 화면만 따로 그리는 테스트가 투어에 가려지지 않게 기본은 꺼 둔다(첫 방문 안내 U46을 App에만 마운트하는 것과 같다).
 * 사용법 버튼은 이 값과 무관하게 늘 시작한다.
 */
export const TourAutoStart = createContext(false)

const target = (name: string) => `[data-tour="${name}"]`
/** 화면에 있고 보이는 대상만 쓴다(회차 0개·다음 회차 탭 없음·접힌 메뉴·잠긴 기능). checkVisibility가 없는 환경은 있는 대로 쓰고, 보이지 않는 대상은 joyride가 건너뛴다. */
const present = (step: TourStep) => {
  const el = document.querySelector(target(step.target))
  return !!el && (el.checkVisibility?.({ visibilityProperty: true }) ?? true)
}

/**
 * 화면 투어의 상태. `ready`는 화면의 주요 데이터가 도착해 첫 대상이 그려졌다는 뜻이다(읽는 중·열람 전용은 호출 측이 false로 두고, 읽기에 실패한 화면은 성공 신호로만 true를 만들어 시작하지 않는다).
 * 오류 문구 같은 일시 상태는 `ready`에 넣지 않는다: 작업 중 버튼이 잠기고, 문구가 지워질 때 ready가 다시 true가 되어 도중에 시작된다.
 * 처음 보는 화면이고 다른 대화 상자가 열려 있지 않으면 ready가 된 순간 한 번 시작한다(`ready`가 다시 바뀌어도 본 화면·떠 있는 투어는 다시 시작하지 않는다).
 * 완료·건너뛰기·닫기·Esc 어느 쪽으로 끝나도 그 화면을 본 것으로 기억한다. 도중에 화면을 떠나면 기억하지 않아 다음 방문에 다시 시작한다.
 */
export function useScreenTour(screen: TourScreen, steps: readonly TourStep[], ready: boolean) {
  const auto = useContext(TourAutoStart)
  const [active, setActive] = useState<Step[] | null>(null)
  // 띄운 투어가 아직 상태(active)에 반영되기 전인지. StrictMode처럼 자동 시작 effect가 곧바로 한 번 더 돌면 active가 아직 비어 보여 투어를 다시 시작한다.
  const pending = useRef(false)
  const start = () => {
    const found = steps.filter(present).map((s): Step => ({ target: target(s.target), title: s.title, content: s.text, placement: 'auto' }))
    if (found.length) {
      pending.current = true
      setActive(found)
    }
  }
  const autoStart = useEffectEvent(() => {
    if (active || pending.current) return
    if (!isTourSeen(screen) && !document.querySelector('[role=dialog],[role=alertdialog]')) start()
  })
  useEffect(() => { if (auto && ready) autoStart() }, [auto, ready])
  // joyride에서 닫기(✕)·Esc는 '다음 단계'라서 투어를 끝내는 신호로 쓰려면 step:after의 close를 직접 본다.
  const onEvent = useCallback(({ type, action }: EventData) => {
    if (type === EVENTS.TOUR_END || (type === EVENTS.STEP_AFTER && action === ACTIONS.CLOSE)) {
      markTourSeen(screen)
      pending.current = false
      setActive(null)
    }
  }, [screen])
  return { active, start, onEvent }
}
import { createContext, useCallback, useContext, useEffect, useEffectEvent, useRef, useState } from 'react'
import { EVENTS, type EventData, type Step } from 'react-joyride'

import { isTourSeen, markTourSeen, type TourScreen } from './tourPrefs'

/** 한 단계. target은 요소의 `data-tour` 값(`<화면>-<이름>`, 탭·패널은 `<화면>-<탭>-<이름>`)이다: 문구·클래스로 요소를 찾지 않는다. */
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
/** 열린 대화 상자가 있는지. `own`은 그 패널 자신의 대화 상자를 알아보는 선택자다(집필실의 버전·공개 시트는 안에 그 패널의 대상이 있다): 그것만 있으면 열리지 않은 것으로 본다. */
const dialogOpen = (own?: string) => [...document.querySelectorAll('[role=dialog],[role=alertdialog]')].some((d) => !(own && d.querySelector(own)))

/**
 * 화면 투어의 상태. `ready`는 화면의 주요 데이터가 도착해 첫 대상이 그려졌다는 뜻이다(읽는 중·열람 전용은 호출 측이 false로 두고, 읽기에 실패한 화면은 성공 신호로만 true를 만들어 시작하지 않는다).
 * 오류 문구 같은 일시 상태는 `ready`에 넣지 않는다: 작업 중 버튼이 잠기고, 문구가 지워질 때 ready가 다시 true가 되어 도중에 시작된다.
 * 처음 보는 화면이고 다른 대화 상자가 열려 있지 않으면 ready가 된 순간 한 번 시작한다(`ready`가 다시 바뀌어도 본 화면은 다시 시작하지 않는다).
 * 완료·건너뛰기·닫기·Esc 어느 쪽으로 끝나도 그 화면을 본 것으로 기억한다. 도중에 화면을 떠나면 기억하지 않아 다음 방문에 다시 시작한다.
 *
 * 탭·패널 투어(`tabs`: 탭 키 → 단계, `tab`: 지금 보는 탭): 화면 투어(메뉴 소개)가 먼저이고 끝나면(이미 봤으면 바로) 지금 탭의 투어가 한 번, 다른 탭으로 처음 옮길 때마다 그 탭의 투어가 한 번 뜬다.
 * 두 투어는 같이 뜨지 않는다(투어가 끝나 `active`가 비면 같은 effect가 다음 투어를 본다). 탭의 내용을 아직 불러오는 중이면 `tab`을 비워 둔다.
 * 사용법 버튼(`start`)은 탭이 있는 화면에서는 지금 탭의 투어를 열고(화면 투어는 첫 진입에만), `panel`(탭이 아니라 열고 닫는 패널)이거나 탭이 없는 화면에서는 화면 투어를 연다.
 */
export function useScreenTour({ screen, steps, tabs, tab, panel = false, ready }: { screen: TourScreen; steps: readonly TourStep[]; tabs?: Record<string, readonly TourStep[]>; tab?: string; panel?: boolean; ready: boolean }) {
  const auto = useContext(TourAutoStart)
  const [active, setActive] = useState<{ steps: Step[]; tab?: string } | null>(null)
  // 이 화면을 연 동안 이미 띄운 투어(화면 ''·탭). 기억을 저장할 수 없는 브라우저에서도 끝낸 투어가 다시 뜨지 않게 한다.
  const shown = useRef(new Set<string>())
  // 띄운 투어가 아직 상태(active)에 반영되기 전인지. StrictMode처럼 effect가 곧바로 한 번 더 돌면 active가 아직 비어 보여 다음 투어가 덮어쓴다.
  const pending = useRef(false)
  const done = (at?: string) => shown.current.has(at ?? '') || isTourSeen(screen, at)
  const begin = (list: readonly TourStep[] | undefined, at?: string) => {
    const found = (list ?? []).filter(present).map((s): Step => ({ target: target(s.target), title: s.title, content: s.text, placement: 'auto' }))
    if (found.length) {
      shown.current.add(at ?? '')
      pending.current = true
      setActive({ steps: found, tab: at })
    }
    return found.length > 0
  }
  // 띄울 투어의 대상이 아직 하나도 그려지지 않았으면(지연 로딩되는 관계도 캔버스 등) 잠시 뒤 다시 본다.
  // ponytail: 0.25초 간격으로 탭마다 20번(5초)까지만. 그 뒤에도 없으면 그 방문에는 띄우지 않는다(사용법 버튼은 그대로).
  const [retry, setRetry] = useState(0)
  const tries = useRef({ tab, n: 0 })
  const autoStart = useEffectEvent(() => {
    if (active || pending.current) return
    if (tries.current.tab !== tab) tries.current = { tab, n: 0 }
    let missed = false
    if (!done()) { if (dialogOpen() || begin(steps)) return; missed = steps.length > 0 }
    if (tab && !done(tab) && !dialogOpen(`[data-tour^="${screen}-${tab}-"]`)) { if (begin(tabs?.[tab], tab)) return; missed ||= !!tabs?.[tab]?.length }
    if (!missed || tries.current.n >= 20) return
    tries.current.n += 1
    const timer = setTimeout(() => setRetry((n) => n + 1), 250)
    return () => clearTimeout(timer)
  })
  useEffect(() => (auto && ready ? autoStart() : undefined), [auto, ready, tab, active, retry])
  const tabbed = !!tabs && !panel
  const canStart = ready && (!tabbed || !!(tab && tabs[tab]?.length))
  const start = () => { if (!tabbed) begin(steps); else if (tab) begin(tabs[tab], tab) }
  // 투어를 끝내고 이 투어(화면·탭)를 본 것으로 기억한다. 건너뛰기·완료·✕는 joyride의 tour:end로, Esc는 ScreenTour가 직접 부른다.
  // joyride의 닫기(close)는 '이 단계를 마치고 다음으로'라서 투어를 끝내지 않고, 그 신호(step:after의 close)와 Esc 처리는 말풍선이 다 뜬 뒤(lifecycle tooltip)에만 온다:
  // 스크롤 이동이 끝나지 않는 동안(숨은 탭은 requestAnimationFrame이 멈춘다) ✕는 다음 단계로 넘어가고 Esc는 무시됐다(#991). 그래서 ✕는 건너뛰기와 같은 동작으로 둔다.
  const at = active?.tab
  const end = useCallback(() => {
    markTourSeen(screen, at)
    pending.current = false
    setActive(null)
  }, [screen, at])
  const onEvent = useCallback(({ type }: EventData) => { if (type === EVENTS.TOUR_END) end() }, [end])
  return { active: active?.steps ?? null, canStart, start, onEvent, end }
}

import type { ReactNode } from 'react'
import Svg, { Circle, Path } from 'react-native-svg'

import type { TabKey } from './tabs.ts'

/**
 * 하단 탭 아이콘: 웹의 선 아이콘(frontend/src/presentation/shared/icons.tsx의 StrokeIcon)과 같은 24px 격자·굵기 2·둥근 끝·단색 선이다.
 * 내 정보는 웹 Gnb의 사람 모양(머리 원 + 어깨 path)을 그대로 선으로 그린다. 색은 선택(pri)·비선택(sub)에 따라 부르는 쪽이 정한다.
 */
const GLYPHS: Record<TabKey, ReactNode> = {
  home: <Path d="M3.5 11L12 4l8.5 7M5.5 9.35V19.5A1.5 1.5 0 0 0 7 21h10a1.5 1.5 0 0 0 1.5-1.5V9.35M10 21v-6.5h4V21" />,
  explore: <><Circle cx="11" cy="11" r="7" /><Path d="M16.5 16.5L21 21" /></>,
  library: <><Path d="M4 5h1.5c2.7 0 4.9.8 6.5 2 1.6-1.2 3.8-2 6.5-2H20v13h-1.5c-2.7 0-4.9.8-6.5 2-1.6-1.2-3.8-2-6.5-2H4z" /><Path d="M12 7v13" /></>,
  notifications: <><Path d="M6 16V11a6 6 0 0 1 12 0v5l2 2H4z" /><Path d="M12 2.5V5M10 20.5a2 2 0 0 0 4 0" /></>,
  me: <><Circle cx="12" cy="8.5" r="4" /><Path d="M4 21c.8-4.4 4-7 8-7s7.2 2.6 8 7z" /></>,
}

export function TabIcon({ name, color, size = 24 }: { name: TabKey; color: string; size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      {GLYPHS[name]}
    </Svg>
  )
}

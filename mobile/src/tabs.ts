import { originOf } from './config.ts'
import { isSameOrigin } from './webview.ts'

export type TabKey = 'home' | 'explore' | 'library' | 'notifications' | 'me'

/** 하단 탭. path는 웹 라우터(frontend/src/App.tsx)의 실제 경로이고, 누르면 WebView가 같은 origin의 이 경로로 이동한다. */
export const TABS: readonly { key: TabKey; label: string; path: string }[] = [
  { key: 'home', label: '홈', path: '/' },
  { key: 'explore', label: '탐색', path: '/search' },
  { key: 'library', label: '내 서재', path: '/lib' },
  { key: 'notifications', label: '알림', path: '/notifications' }, // /inbox는 독자 피드백함이다
  { key: 'me', label: '내 정보', path: '/me/profile' },
]

/** 웹 GNB가 각 화면에서 켜는 메뉴(`<Gnb on=…>`)를 따라 경로를 탭에 묶는다. 경로 접두는 /로 끊어 비교한다(/me가 /meeting을 고르지 않는다). */
const GROUPS: readonly (readonly [TabKey, RegExp])[] = [
  ['home', /^\/$/],
  ['explore', /^\/(search|worlds|rank|chat|tag|ifs)(\/|$)/],
  ['library', /^\/(lib|studio|content|worldstudio|inbox|import|new|write|fork)(\/|$)/],
  ['notifications', /^\/notifications(\/|$)/],
  ['me', /^\/me(\/(?!signup(\/|$)).*)?$/], // /me/signup은 로그인 전 가입 화면이다
]

/** WebView의 현재 주소에서 선택할 탭. 우리 웹이 아니거나 어느 탭에도 속하지 않는 화면(작품 상세·읽기 등)이면 null. */
export function selectedTab(url: string, base?: string): TabKey | null {
  if (!isSameOrigin(url, base)) return null
  const path = url.slice(originOf(url)!.length).split(/[?#]/)[0] || '/'
  return GROUPS.find(([, pattern]) => pattern.test(path))?.[0] ?? null
}

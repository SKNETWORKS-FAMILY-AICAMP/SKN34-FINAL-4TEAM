import { API_BASE_URL, originOf, webUrl } from './config.ts'
import { payloadTarget } from './notification.ts'

export function isSameOrigin(url: string, base = API_BASE_URL) {
  const origin = originOf(url)
  return origin !== undefined && origin === originOf(base)
}

/**
 * WebView 안의 이동 판정. 우리 웹(같은 origin)과 about:blank만 앱 안에서 열고, 다른 origin의 http(s)·mailto·tel은 시스템에 맡기며,
 * 그 밖의 scheme(javascript·file·data·앱 scheme 등)은 열지 않는다.
 */
export function navigationDecision(url: string, base = API_BASE_URL): 'allow' | 'external' | 'block' {
  if (url === 'about:blank' || isSameOrigin(url, base)) return 'allow'
  return /^(https?|mailto|tel):/i.test(url) ? 'external' : 'block'
}

/** 알림(로컬·원격)을 눌렀을 때 WebView가 갈 주소. 웹 noticeTarget 규칙의 경로(고정된 /... 경로뿐이고 id는 인코딩돼 다른 origin으로 새지 않는다)만 우리 origin에 붙이고, 대상이 없으면 이동하지 않는다. */
export function tapDestination(data: unknown, base = API_BASE_URL) {
  const path = payloadTarget(data)
  return path ? webUrl(path, base) : null
}

/**
 * 하단 탭을 눌렀을 때 WebView 안에서 실행할 스크립트. 웹 라우터(react-router의 BrowserRouter)는 popstate를 받아 화면을 바꾸므로
 * 주소 기록에 경로를 더하고 popstate를 보내면 페이지를 새로 읽지 않고 이동하며 뒤로가기 기록도 쌓인다(웹은 바꾸지 않는다).
 * 끝의 true는 react-native-webview가 마지막 식이 값이 아니면 iOS에서 조용히 실패하는 것을 피하기 위한 것이다.
 */
export const navigateScript = (path: string) =>
  `(function (path) { if (location.pathname + location.search !== path) { history.pushState(null, '', path); dispatchEvent(new PopStateEvent('popstate')) } })(${JSON.stringify(path)}); true;`

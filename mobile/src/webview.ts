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

/** API 서버(= STORYFORK 웹) 주소의 기본값: 로컬 Compose의 web nginx(/api 프록시)다. Android 에뮬레이터는 http://10.0.2.2:5173(웹의 Web Locks는 보안 컨텍스트가 필요해 https나 localhost여야 하니 adb reverse로 localhost를 쓴다). */
const DEFAULT_API_BASE_URL = 'http://localhost:5173'

/** 값이 없거나 비어 있으면(CI의 비어 있는 변수가 빈 문자열로 넘어오는 경우 포함) 기본값이다. 끝 슬래시는 버린다. */
export const apiBaseUrl = (value: string | undefined) => (value?.trim() || DEFAULT_API_BASE_URL).replace(/\/+$/, '')

/** 비밀이 아니라 번들에 들어간다. Expo가 `process.env.EXPO_PUBLIC_*`를 번들 시점에 박으므로 이 표기 그대로 읽어야 한다. */
export const API_BASE_URL = apiBaseUrl(process.env.EXPO_PUBLIC_API_BASE_URL)

/** scheme://host:port(경로 제외, 소문자). 절대 주소가 아니면 undefined다. */
export const originOf = (url: string) => url.match(/^[a-z][a-z0-9+.-]*:\/\/[^/?#]+/i)?.[0].toLowerCase()

/** 웹 주소: API 기준 origin(경로 제외) + 웹 경로. */
export function webUrl(path: string, base = API_BASE_URL) {
  return (originOf(base) ?? base) + path
}

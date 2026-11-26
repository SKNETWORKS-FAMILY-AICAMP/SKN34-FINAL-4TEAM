import { z } from 'zod'

/** 웹 페이지의 배경색(상태바 띠를 웹 상단 바와 같게 칠한다)과 그 색이 어두운지(상태바 글자·하단 탭 색을 고른다). */
export type Look = { background: string; dark: boolean }

/** 웹이 알려 주기 전(앱을 켠 직후)의 색: 웹 라이트 테마의 --bg(#F8F9FA). */
export const DEFAULT_LOOK: Look = { background: 'rgb(248, 249, 250)', dark: false }

const message = z.object({ type: z.literal('storyfork.background'), color: z.string() })
const cssRgb = /^rgba?\(\s*(\d{1,3})[\s,]+(\d{1,3})[\s,]+(\d{1,3})\s*(?:[,/]\s*([\d.]+%?)\s*)?\)$/

/**
 * BACKGROUND_SCRIPT가 WebView에서 보낸 문자열을 look으로 읽는다. getComputedStyle이 돌려주는 rgb()·rgba() 색만 받고,
 * 투명하거나 읽을 수 없는 색, 다른 메시지는 null이다(앱은 이전 색을 그대로 둔다).
 */
export function lookOf(raw: string): Look | null {
  let data: unknown
  try { data = JSON.parse(raw) } catch { return null }
  const parsed = message.safeParse(data)
  const match = parsed.success ? cssRgb.exec(parsed.data.color.trim()) : null
  if (!match) return null
  const [r, g, b] = [match[1], match[2], match[3]].map(Number)
  const alpha = match[4] === undefined ? 1 : match[4].endsWith('%') ? parseFloat(match[4]) / 100 : Number(match[4])
  if (alpha !== 1 || Math.max(r, g, b) > 255) return null
  return { background: `rgb(${r}, ${g}, ${b})`, dark: (r * 299 + g * 587 + b * 114) / 1000 < 128 }
}

/**
 * WebView 안에서 실행해 웹 body의 배경색(웹 상단 바는 이 색의 86%를 얹은 sticky 바다)을 앱에 알린다: 지금 색을 보내고, 테마 전환(html의 data-theme)·
 * body 속성 변경·OS 다크 모드 변경으로 색이 달라지면 다시 보낸다. 웹 코드는 바꾸지 않고, 앱은 같은 origin이 보낸 메시지만 받는다.
 */
export const BACKGROUND_SCRIPT = `(function () {
  var last = '';
  function report() {
    var color = getComputedStyle(document.body).backgroundColor;
    if (color === last) return;
    last = color;
    window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'storyfork.background', color: color }));
  }
  report();
  var observer = new MutationObserver(report);
  observer.observe(document.documentElement, { attributes: true });
  observer.observe(document.body, { attributes: true });
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', report);
})(); true;`

/** 웹 테마 토큰(frontend/src/styles/storyfork.css)의 라이트·다크 값: 하단 탭·오류 화면이 웹과 같은 색을 쓴다. */
export const palette = (dark: boolean) =>
  dark
    ? { surface: '#1c1c21', border: '#2c2c33', ink: '#ececf1', sub: '#a0a3ae', pri: '#9d87ff', onPri: '#140e2b' }
    : { surface: '#ffffff', border: '#dee2e6', ink: '#191a1f', sub: '#5f6370', pri: '#6d4ae0', onPri: '#ffffff' }

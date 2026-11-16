// 화면 어디서나 띄우는 Toast와 페이지 이동 바. 목업의 toast()·RB를 window 이벤트로 옮겼습니다.
export const toast = (message: string) => window.dispatchEvent(new CustomEvent('sf-toast', { detail: message }))
/** 토스트가 머무는 시간(ms). 글자 수에 비례하되(1초 + 글자당 80ms) 2.6초보다 짧지 않고 8초를 넘지 않는다: 긴 오류 문구도 끝까지 읽을 수 있게. */
export const toastDuration = (message: string) => Math.min(8000, Math.max(2600, 1000 + 80 * message.length))
export const showRouteProgress = () => window.dispatchEvent(new Event('sf-progress'))
// Check before opening a replacement Sheet as well as before imperative navigation.
export const requestLeave = () => window.dispatchEvent(new Event('sf-before-leave', { cancelable: true }))
export const openQuick = () => window.dispatchEvent(new Event('sf-quick'))
export const openPolicy = () => window.dispatchEvent(new Event('sf-policy'))

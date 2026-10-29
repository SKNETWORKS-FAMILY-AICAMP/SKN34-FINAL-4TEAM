// 화면 어디서나 띄우는 Toast와 페이지 이동 바. 목업의 toast()·RB를 window 이벤트로 옮겼습니다.
export const toast = (message: string) => window.dispatchEvent(new CustomEvent('sf-toast', { detail: message }))
export const showRouteProgress = () => window.dispatchEvent(new Event('sf-progress'))

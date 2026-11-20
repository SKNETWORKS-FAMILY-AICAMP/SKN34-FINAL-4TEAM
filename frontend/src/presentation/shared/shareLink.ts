import { toast } from './events'

/**
 * 링크를 공유한다. 먼저 클립보드에 복사해 토스트로 알린다(데스크톱 Chrome의 OS 공유 창은 눈에 잘 띄지 않고 닫으면 아무 안내도 없어 복사를 기본으로 한다).
 * 복사를 못 하면(비보안 출처·권한 거부) Web Share 공유 창을 열고(사용자가 닫으면 조용히 끝낸다), 그것도 없거나 실패하면 성공으로 숨기지 않고 주소를 보여 준다.
 */
export async function shareLink(url: string) {
  try { await navigator.clipboard.writeText(url); toast('링크를 복사했어요'); return } catch { /* 공유 창으로 넘어간다 */ }
  if (typeof navigator.share === 'function') {
    try { await navigator.share({ url }); return } catch (error) { if (error instanceof DOMException && error.name === 'AbortError') return }
  }
  toast(`링크를 복사하지 못했어요 · ${url}`)
}

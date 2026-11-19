export type McpChangeState = { stale: boolean; reload: () => void }

/**
 * 다른 곳(AI·외부 도구)에서 열어 둔 대상이 바뀌었는데 저장하지 않은 수정이 있어 덮어쓰지 않았을 때(또는 자동으로 다시 읽지 못했을 때)의 안내(#553).
 * 누르면 확인 없이 서버 값으로 다시 불러오고, 버튼이 사라지므로 초점은 화면의 main이 이어받는다(`#main`은 집필실·세계관 화면 모두 있다).
 */
export function McpChangeBanner({ stale, reload }: McpChangeState) {
  if (!stale) return null
  return (
    <div className="ep-alert ep-changed" role="status">
      <span>다른 곳에서 바뀌었어요</span>
      <button type="button" className="btn sm" onClick={() => { reload(); document.getElementById('main')?.focus({ preventScroll: true }) }}>다시 불러오기</button>
    </div>
  )
}

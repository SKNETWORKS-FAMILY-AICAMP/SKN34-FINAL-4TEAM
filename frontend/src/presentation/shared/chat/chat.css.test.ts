import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'

const css = readFileSync(new URL('./chat.css', import.meta.url), 'utf8')
/** 한 줄에 한 규칙인 이 파일에서 '줄 처음의 선택자 {' 규칙의 선언부(없으면 빈 글). */
const rule = (selector: string) => {
  const start = css.indexOf('\n' + selector + ' {')
  return start < 0 ? '' : css.slice(css.indexOf('{', start) + 1, css.indexOf('}', start))
}

// jsdom에는 레이아웃이 없어 렌더 테스트로는 못 잡는다(#688 UI 리뷰): 이름이 긴 파일 하나가 입력 카드를 채팅 폭 밖으로 밀어
// 전송 버튼이 화면 밖으로 나가고, 보낸 말풍선의 첨부 칩은 왼쪽이 잘렸다. 화면 확인은 CI 브라우저 레인이다.
it('긴 첨부 파일 이름이 입력 카드와 보낸 말풍선을 채팅 폭 밖으로 밀지 않는다', () => {
  // 칩은 white-space:nowrap이라 최소 폭이 이름 길이만큼 크다. 카드의 grid 열이 그만큼 늘지 않게 0까지 줄이고,
  // 칩 목록은 부모 폭을 넘지 않게 해야 칩 이름의 말줄임(.chat-chip-name)이 동작한다.
  expect(rule('.chat-card')).toMatch(/grid-template-columns:\s*minmax\(0,\s*1fr\)/)
  expect(rule('.chat-chips')).toMatch(/max-width:\s*100%/)
})

// 눌린 답변 평가(#560)는 글자색만 바뀌면 구분하기 어렵다(1440px 실화면): 사이드바 선택 항목처럼 배경도 바꾸고, 더 구체적인 hover 규칙에서 눌린 버튼을 뺀다.
it('눌린 답변 평가 버튼은 --pri-soft 배경·--pri-ink 글자이고 hover가 그 배경을 덮지 않는다', () => {
  const pressed = rule('.chat-msg-actions button[aria-pressed="true"]')
  expect(pressed).toMatch(/background:\s*var\(--pri-soft\)/)
  expect(pressed).toMatch(/color:\s*var\(--pri-ink\)/)
  expect(rule('.chat-msg-actions button:hover:not(:disabled, [aria-pressed="true"])')).toMatch(/background:\s*var\(--muted-bg\)/)
})

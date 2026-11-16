/** 다른 키와 함께 누르는 키. 이 키만으로는 'Esc 다음 Tab'의 순서를 끊지 않는다(Shift+Tab의 Shift). */
const MODIFIERS = ['Shift', 'Control', 'Alt', 'Meta']

/** 편집기를 키보드로 벗어나는 방법. 편집기 아래에 한 줄로 보이고 입력 영역의 설명(`aria-describedby`)으로 잇는다. */
export const TAB_ESCAPE_HINT = 'Tab은 들여쓰기예요. 편집기 밖으로 나가려면 Esc를 누른 다음 Tab을 누르세요.'

/**
 * Toast UI Editor의 마크다운 편집 영역(`.ProseMirror`)은 Tab·Shift+Tab을 늘 들여쓰기로 가로채 키보드만으로는 빠져나갈 수 없다(WCAG 2.1.2).
 * 편집기 덩어리(`el`)의 캡처 단계에서 Esc를 누른 바로 다음 Tab·Shift+Tab은 편집기에 넘기지 않아 브라우저가 초점을 옮기게 한다. 들여쓰기는 그대로 Tab이다.
 * 정리 함수를 돌려준다.
 */
export function escapeWithTab(el: HTMLElement) {
  let leaving = false // Esc를 방금 눌렀다: 바로 다음 Tab은 편집기 밖으로 나간다
  const keys = (e: KeyboardEvent) => {
    const target = e.target instanceof Element ? e.target : null
    if (!target?.closest('.ProseMirror') || MODIFIERS.includes(e.key)) return
    if (e.key === 'Tab' && leaving) e.stopPropagation() // 편집기(ProseMirror)가 받지 못하면 들여쓰기 대신 브라우저의 초점 이동이 일어난다
    leaving = e.key === 'Escape' && !e.isComposing && e.keyCode !== 229 // 한글 조합을 끝내는 Esc는 세지 않는다
  }
  const stay = () => { leaving = false }
  el.addEventListener('keydown', keys, true)
  el.addEventListener('focusout', stay)
  return () => {
    el.removeEventListener('keydown', keys, true)
    el.removeEventListener('focusout', stay)
  }
}

/** 메뉴를 여는 키: ContextMenu 키와 Shift+F10(캔버스와 키보드 목록이 같이 쓴다). */
export const isMenuKey = (e: { key: string; shiftKey: boolean }) => e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')
/** 요소의 화면 가운데: 키보드로 연 메뉴가 놓일 자리다. */
export const centerOf = (el: Element) => { const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 } }

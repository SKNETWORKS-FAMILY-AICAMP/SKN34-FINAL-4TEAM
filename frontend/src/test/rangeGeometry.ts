/**
 * jsdom에는 글자 위치를 계산하는 Range API가 없어 ProseMirror(Tiptap)가 커서·스크롤을 계산하지 못한다.
 * 편집기에 입력·선택·삽입하는 렌더 테스트의 beforeAll에서 한 번 부른다.
 */
export function stubRangeGeometry() {
  const rect = { x: 0, y: 0, width: 0, height: 0, top: 0, right: 0, bottom: 0, left: 0, toJSON: () => ({}) }
  Range.prototype.getBoundingClientRect = () => rect as DOMRect
  Range.prototype.getClientRects = () => ({ length: 0, item: () => null, [Symbol.iterator]: [][Symbol.iterator] }) as unknown as DOMRectList
}

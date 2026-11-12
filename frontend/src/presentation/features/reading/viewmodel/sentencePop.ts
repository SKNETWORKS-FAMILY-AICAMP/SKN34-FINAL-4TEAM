/** 문장 팝업과 화면 양 끝 사이에 남기는 여백(px). 팝업 최대 폭(`calc(100% - 24px)`)도 이 값의 두 배를 뺀다. */
export const POP_GUTTER = 12

/**
 * 문장 팝업의 왼쪽 위치(화면 기준 px). 고른 문장의 왼쪽(anchor)에 맞추되, 팝업의 실제 폭(width)이 화면 폭(viewport)을
 * 넘지 않게 왼쪽으로 당기고 양 끝에 여백을 남긴다. 버튼 글자 길이에 따라 폭이 달라지므로 폭을 가정하지 않고 잰 값을 받는다.
 */
export const popLeft = (anchor: number, width: number, viewport: number) => Math.max(POP_GUTTER, Math.min(anchor, viewport - width - POP_GUTTER))

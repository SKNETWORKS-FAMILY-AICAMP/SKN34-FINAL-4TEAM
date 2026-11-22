/** 글자 폭 어림(화면 px): 한글·한자 같은 넓은 글자는 한 칸(글자 크기), 영문·숫자·기호는 약 0.56칸이다. 캔버스·SVG 글자를 재지 않고 자리를 잡을 때 쓴다. */
export function textWidth(text: string, size: number) {
  let width = 0
  for (const char of text) width += (char.codePointAt(0) ?? 0) > 0x2e7f ? size : size * 0.56
  return width
}

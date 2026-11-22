/** 글을 파일로 내려받는다(서버 없이 브라우저 안에서: Blob → 임시 링크의 download). 원고 내보내기와 같은 방식이다. */
export function downloadText(filename: string, text: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], { type }))
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/** 폼 입력값을 이름으로 읽습니다. 프롬프트 본문처럼 공백도 내용인 입력만 trim을 끕니다. */
export const formText = (form: HTMLFormElement, name: string, trim = true) => {
  const value = String(new FormData(form).get(name) ?? '')
  return trim ? value.trim() : value
}
/** 숫자 입력. 비어 있으면 0이 아니라 NaN이라 UseCase의 입력 검사가 알립니다. */
export const formNumber = (form: HTMLFormElement, name: string) => { const value = formText(form, name); return value === '' ? Number.NaN : Number(value) }

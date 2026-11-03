/** 목업 S.inq: 사용자 문의 (운영팀 답변은 관리자 화면에서) */
export type Inquiry = { id: string; t: string; s: string; b: string; d: string; st: string; reply?: string }

export const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/

/** 목업 saveProfile: 문제가 있으면 안내 문구, 없으면 null */
export function checkProfile(nick: string, email: string) {
  if (nick.trim().length < 2) return '닉네임은 2자 이상이에요'
  if (!EMAIL.test(email.trim())) return '이메일 형식을 확인해 주세요'
  return null
}

export function checkPassword(password: string) {
  if (!password.trim()) return '공백만으로는 비밀번호를 만들 수 없어요.'
  if (password.length < 8) return '비밀번호는 8자 이상이에요'
  if (new TextEncoder().encode(password).length > 72) return '비밀번호가 너무 길어요. 글자 수를 줄여 주세요. 한글·이모지는 영문보다 더 많은 공간을 사용해요.'
  return null
}

/** 가입 입력의 첫 오류와 수정할 필드를 반환합니다. */
export function checkSignup(o: { email: string; nick: string; p1: string; p2: string }): { field: 'email' | 'nick' | 'p1' | 'p2'; message: string } | null {
  if (!EMAIL.test(o.email.trim())) return { field: 'email', message: '이메일 형식을 확인해 주세요' }
  if (o.nick.trim().length < 2) return { field: 'nick', message: '닉네임은 2자 이상이에요' }
  const passwordError = checkPassword(o.p1)
  if (passwordError) return { field: 'p1', message: passwordError }
  if (o.p1 !== o.p2) return { field: 'p2', message: '비밀번호가 서로 달라요' }
  return null
}

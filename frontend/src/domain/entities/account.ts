/** 목업 S.inq: 사용자 문의 (운영팀 답변은 관리자 화면에서) */
export type Inquiry = { id: string; t: string; s: string; b: string; d: string; st: string; reply?: string }

export const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/

/** 목업 saveProfile: 문제가 있으면 안내 문구, 없으면 null */
export function checkProfile(nick: string, email: string) {
  if (nick.trim().length < 2) return '닉네임은 2자 이상이에요'
  if (!EMAIL.test(email.trim())) return '이메일 형식을 확인해 주세요'
  return null
}

/** 목업 #suf 제출: 입력한 비밀번호는 저장하지 않습니다. */
export function checkSignup(o: { email: string; nick: string; p1: string; p2: string; termsOk: boolean }) {
  if (!EMAIL.test(o.email.trim())) return '이메일 형식을 확인해 주세요'
  if (o.nick.trim().length < 2) return '닉네임은 2자 이상이에요'
  if (o.p1.length < 8) return '비밀번호는 8자 이상이에요'
  if (o.p1 !== o.p2) return '비밀번호가 서로 달라요'
  if (!o.termsOk) return '필수 약관에 동의해 주세요'
  return null
}

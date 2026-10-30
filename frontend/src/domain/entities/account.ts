/** 목업 S.inq: 사용자 문의 (운영팀 답변은 관리자 화면에서) */
export type Inquiry = { id: string; t: string; s: string; b: string; d: string; st: string; reply?: string }

/** 목업 NOTICE: [날짜, 제목, 내용] */
export const NOTICE: [string, string, string][] = [['2026.10.27', 'STORYFORK 데모 버전 안내', '지금 보시는 화면은 SKN34 최종 프로젝트 4팀의 인터랙티브 목업이에요. AI 응답과 수치는 미리 정한 데모 값이에요.'], ['2026.10.26', '포크 이용 안내', '작가가 허용한 회차에서만 포크할 수 있어요. 포크한 소설은 그 시점의 설정을 복사해 쓰기 때문에 원작이 바뀌어도 영향을 받지 않아요.'], ['2026.10.24', '댓글·피드백·신고 안내', '댓글은 공개 의견으로 등록돼요. 단순 오류·스토리 오류·질문·제안은 피드백으로, 권리 침해·유해 콘텐츠는 운영팀 신고로 따로 접수돼요.'], ['2026.10.22', 'AI 기능 크레딧 정책 안내', 'AI 기능의 크레딧 차감 기준은 아직 정해지지 않았어요. 화면에 보이는 숫자는 예시이며 실제로 차감되지 않아요.']]

/** 목업 EVENTS */
export const EVENTS = [{ t: '첫 포크 써 보기', p: '2026.10.27 ~ 11.30', st: '진행 중', d: '좋아하는 원작의 허용된 회차에서 포크하고 1화를 공개해 보세요.', go: '/rank?t=orig', cta: '포크할 소설 고르기' }, { t: '캐릭터 챗으로 인물 만나기', p: '2026.10.27 ~ 11.15', st: '진행 중', d: '내가 읽은 회차까지만 아는 인물에게 질문해 보세요.', go: '/chat', cta: '캐릭터 챗 열기' }, { t: '고전 소설 정주행', p: '2026.11.01 ~ 11.30', st: '예정', d: '저작권이 만료된 고전 소설을 끝까지 읽어 보세요.', go: '/search?q=고전리메이크&f=tag', cta: '고전 소설 보기' }]

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/

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

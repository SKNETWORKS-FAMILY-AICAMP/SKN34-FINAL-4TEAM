/** 원고 본문 상한. 서버 `DraftRequest`·`EpisodeService.validate`의 40,000자와 같다. */
export const BODY_MAX = 40000
/** 공개(발행)에 필요한 본문 분량. 서버는 검사하지 않는 화면 규칙이다(UC-10 U13, 2026-11-11 사용자 결정). */
export const PUBLISH_MIN = 5000

const won = (n: number) => n.toLocaleString('ko-KR')

/**
 * 저장되는 본문 문자열의 길이(공백·줄바꿈 포함, UTF-16 단위)다. 이미지 표식 `[[image:<UUID>]]`는 46자로 센다.
 * 서버 `Manuscript.bodyLength`(text.length + images.size * 45)와 40,000자 검사(`body.length`)가 모두 같은 값이라 40,000자 한도를 어긋남 없이 지킨다.
 */
export const bodyLength = (body: string) => body.length

/** 공개까지 더 채워야 하는 글자 수. 0이면 공개 가능 분량이다. */
export const publishRemaining = (body: string) => Math.max(0, PUBLISH_MIN - bodyLength(body))

/** 공개를 막는 사유. 공개해도 되는 분량이면 빈 문자열이다. */
export const publishBlocker = (body: string) =>
  publishRemaining(body) ? `공개하려면 본문이 ${won(PUBLISH_MIN)}자 이상이어야 해요. 지금은 ${won(bodyLength(body))}자예요.` : ''

/** 편집기 하단 글자 수 옆에 붙이는 분량 안내. */
export const publishHint = (body: string) =>
  publishRemaining(body) ? `공개까지 ${won(PUBLISH_MIN)}자 중 ${won(publishRemaining(body))}자 남음` : '공개 가능 분량'

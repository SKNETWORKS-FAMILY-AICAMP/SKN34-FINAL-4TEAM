import type { ReactNode } from 'react'

/** 목업 CHEV: 뒤로 가기 버튼 화살표 */
export const BackChev = () => (
  <svg className="chev" viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
    <path d="M15 5l-7 7 7 7" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
)

const HEART = 'M12 20.3s-7.4-4.5-9.2-9C1.6 8 3.6 4.6 7.1 4.6c2 0 3.7 1.1 4.9 2.8 1.2-1.7 2.9-2.8 4.9-2.8 3.5 0 5.5 3.4 4.3 6.7-1.8 4.5-9.2 9-9.2 9z'

/** 목업 HEART: 관심 소설 버튼 */
export const Heart = () => (
  <svg className="hrt" viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
    <path d={HEART} />
  </svg>
)

/** 집필실·채팅이 함께 쓰는 선 아이콘: 24px 격자, 선 굵기 2, 둥근 끝. 크기는 쓰는 쪽이 정한다. */
const StrokeIcon = ({ size = 20, children }: { size?: number; children: ReactNode }) => (
  <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{children}</svg>
)

export const PlusIcon = ({ size }: { size?: number }) => <StrokeIcon size={size}><path d="M12 5v14M5 12h14" /></StrokeIcon>
export const MoreIcon = () => <StrokeIcon><circle cx="5" cy="12" r="1" /><circle cx="12" cy="12" r="1" /><circle cx="19" cy="12" r="1" /></StrokeIcon>
/** 항목별 더보기: 세로 점 세 개 */
export const MoreVerticalIcon = () => <StrokeIcon><circle cx="12" cy="5" r="1" /><circle cx="12" cy="12" r="1" /><circle cx="12" cy="19" r="1" /></StrokeIcon>
/** 채팅 앱의 '새 글 쓰기': 사각형 + 연필 */
export const ComposeIcon = () => <StrokeIcon><path d="M12 4H7a3 3 0 0 0-3 3v10a3 3 0 0 0 3 3h10a3 3 0 0 0 3-3v-5" /><path d="M18 3.5a1.8 1.8 0 0 1 2.5 2.5L12 14.5l-3.5 1 1-3.5z" /></StrokeIcon>
/** 본문 이미지 첨부 */
export const ImageIcon = () => <StrokeIcon><rect x="3" y="4" width="18" height="16" rx="3" /><circle cx="9" cy="10" r="1.5" /><path d="M21 16l-5-5-8 8" /></StrokeIcon>
export const MicIcon = () => <StrokeIcon><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5 11a7 7 0 0 0 14 0M12 18v3" /></StrokeIcon>
export const SendIcon = () => <StrokeIcon><path d="M12 19V5M5 12l7-7 7 7" /></StrokeIcon>
/** 오른쪽 패널 접기 */
export const FoldIcon = () => <StrokeIcon><rect x="3" y="4" width="18" height="16" rx="3" /><path d="M15 4v16M8 9l3 3-3 3" /></StrokeIcon>
/** AI 채팅의 브랜드 마크(반짝임) */
export const SparkIcon = ({ size }: { size?: number }) => <StrokeIcon size={size}><path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z" /><path d="M19 16v4M17 18h4" /></StrokeIcon>

/** 목업 CROWN: 랭킹 1위 */
export const Crown = () => (
  <svg viewBox="0 0 24 24" width="22" height="22">
    <path d="M3 8l4.5 4L12 5l4.5 7L21 8l-2 11H5z" fill="#F5B014" stroke="#8A5A00" strokeWidth="1.2" strokeLinejoin="round" /><circle cx="12" cy="5" r="1.6" fill="#FFE7A3" />
  </svg>
)

/** 통계·메타·버튼용 얇은 선 아이콘의 공통 껍데기: 24 격자, 한 가지 굵기, currentColor, 스크린리더에서 숨김. 크기는 곁의 글자·버튼에 맞춰 정한다. */
const Line = ({ size, children }: { size: number; children: ReactNode }) => (
  <svg className="mi" viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{children}</svg>
)

/** 좋아요 수(통계): 하트 외곽선 */
export const Like = () => <Line size={13}><path d={HEART} /></Line>

/** 조회 수: 얇은 외곽선 눈 */
export const Eye = () => <Line size={13}><path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" /><circle cx="12" cy="12" r="2.8" /></Line>

/** 댓글 수: 말풍선 외곽선 */
export const Bubble = () => <Line size={13}><path d="M4 5.5A1.5 1.5 0 0 1 5.5 4h13A1.5 1.5 0 0 1 20 5.5v9a1.5 1.5 0 0 1-1.5 1.5H10l-4.5 4v-4A1.5 1.5 0 0 1 4 14.5z" /></Line>

/** 포크 수: 곧게 내려가는 줄기에서 한 갈래가 옆으로 갈라지는 분기(git branch) 선 아이콘 */
export const Branch = () => <Line size={13}><circle cx="6" cy="5" r="2.2" /><circle cx="6" cy="19" r="2.2" /><circle cx="18" cy="8" r="2.2" /><path d="M6 7.2v9.6M18 10.2c0 4.2-3.4 6.2-12 5.8" /></Line>

/** 공유 버튼: 상자에서 위로 나가는 화살표(하트와 같은 크기) */
export const Share = () => <Line size={22}><path d="M12 15V3.5M8 7l4-3.5L16 7M6 11v7.5A1.5 1.5 0 0 0 7.5 20h9a1.5 1.5 0 0 0 1.5-1.5V11" /></Line>

/** 소설 신고 버튼: 깃발(부차 행동이라 작게) */
export const Flag = () => <Line size={16}><path d="M5 21V4.5M5 5h12.5l-2.8 3.8 2.8 3.7H5" /></Line>

import type { ReactNode } from 'react'

/** 목업 CHEV: 뒤로 가기 버튼 화살표 */
export const BackChev = () => (
  <svg className="chev" viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
    <path d="M15 5l-7 7 7 7" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
)

/** 목업 HEART: 관심 소설 버튼 */
export const Heart = () => (
  <svg className="hrt" viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
    <path d="M12 20.3s-7.4-4.5-9.2-9C1.6 8 3.6 4.6 7.1 4.6c2 0 3.7 1.1 4.9 2.8 1.2-1.7 2.9-2.8 4.9-2.8 3.5 0 5.5 3.4 4.3 6.7-1.8 4.5-9.2 9-9.2 9z" />
  </svg>
)

/** 집필실·채팅이 함께 쓰는 선 아이콘: 24px 격자, 선 굵기 2, 둥근 끝. 크기는 쓰는 쪽이 정한다. */
const Line = ({ size = 20, children }: { size?: number; children: ReactNode }) => (
  <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{children}</svg>
)

export const PlusIcon = ({ size }: { size?: number }) => <Line size={size}><path d="M12 5v14M5 12h14" /></Line>
export const MoreIcon = () => <Line><circle cx="5" cy="12" r="1" /><circle cx="12" cy="12" r="1" /><circle cx="19" cy="12" r="1" /></Line>
/** 항목별 더보기: 세로 점 세 개 */
export const MoreVerticalIcon = () => <Line><circle cx="12" cy="5" r="1" /><circle cx="12" cy="12" r="1" /><circle cx="12" cy="19" r="1" /></Line>
/** 채팅 앱의 '새 글 쓰기': 사각형 + 연필 */
export const ComposeIcon = () => <Line><path d="M12 4H7a3 3 0 0 0-3 3v10a3 3 0 0 0 3 3h10a3 3 0 0 0 3-3v-5" /><path d="M18 3.5a1.8 1.8 0 0 1 2.5 2.5L12 14.5l-3.5 1 1-3.5z" /></Line>
/** 본문 이미지 첨부 */
export const ImageIcon = () => <Line><rect x="3" y="4" width="18" height="16" rx="3" /><circle cx="9" cy="10" r="1.5" /><path d="M21 16l-5-5-8 8" /></Line>
export const MicIcon = () => <Line><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5 11a7 7 0 0 0 14 0M12 18v3" /></Line>
export const SendIcon = () => <Line><path d="M12 19V5M5 12l7-7 7 7" /></Line>
/** 오른쪽 패널 접기 */
export const FoldIcon = () => <Line><rect x="3" y="4" width="18" height="16" rx="3" /><path d="M15 4v16M8 9l3 3-3 3" /></Line>
/** AI 채팅의 브랜드 마크(반짝임) */
export const SparkIcon = ({ size }: { size?: number }) => <Line size={size}><path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z" /><path d="M19 16v4M17 18h4" /></Line>

/** 목업 CROWN: 랭킹 1위 */
export const Crown = () => (
  <svg viewBox="0 0 24 24" width="22" height="22">
    <path d="M3 8l4.5 4L12 5l4.5 7L21 8l-2 11H5z" fill="#F5B014" stroke="#8A5A00" strokeWidth="1.2" strokeLinejoin="round" /><circle cx="12" cy="5" r="1.6" fill="#FFE7A3" />
  </svg>
)

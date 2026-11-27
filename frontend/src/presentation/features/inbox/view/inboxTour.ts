import type { TourStep } from '../../../shared/tour/ScreenTour'

/**
 * 사용법 투어(#971)의 피드백함 단계: 제보 → 수정 제안 순서. 작가 피드백함(/inbox)과 작품 관리의 '받은 피드백' 탭이 같은 컴포넌트(FeedbackReportInbox·EditSuggestionInbox)를 쓰므로 같은 앵커·같은 단계를 쓴다.
 * 두 목록을 읽은 뒤에 시작하고(읽기에 실패하면 시작하지 않는다), 카드 안 버튼 단계는 필터에 가려지지 않은 첫 카드에만 붙은 data-tour로 짚으므로 카드가 없으면 빠진다.
 */
export const inboxTour: TourStep[] = [
  { target: 'inbox-reports', title: '독자 제보', text: '독자가 내 작품 회차에 남긴 문장 제보가 최신순으로 모여요. 비공개 제보는 작가만 볼 수 있어요.' },
  { target: 'inbox-report-actions', title: '제보 처리', text: '회차 보기로 원문을 확인하고, 확인했어요·처리 상태·답변하기로 처리해요. 처리 상태는 독자의 내 서재에 바로 표시돼요.' },
  { target: 'inbox-suggestions', title: '독자 수정 제안', text: '독자가 보낸 문장 수정 제안이에요. 변경 전·후와 범위 검사를 보여 주고, 검사는 표시일 뿐이에요.' },
  { target: 'inbox-suggestion-actions', title: '제안 승인', text: '승인해야만 초안에 반영돼요. 편집안을 고쳤다면 먼저 편집안 저장을 눌러야 승인할 수 있어요. 발행은 집필실에서 따로 해요. 거절이나 보류도 고를 수 있어요.' },
]

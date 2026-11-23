const IN_PROGRESS = ['queued', 'running', 'loading']
const inProgress = (status = '') => IN_PROGRESS.includes(status)

/**
 * 공개 회차 머리의 세계관 배지 글이다(initial-build-storage-contract). 최초 구축이 진행 중이면 '세계관 추출 중', 아니고 발행 회차 업데이트(`update`)가 진행 중이면 '세계관 업데이트 중'이며
 * 둘 다 진행 중이면 최초 구축이 먼저다. 진행 중은 queued·running·loading뿐이라 실패·unknown·완료와 작업 없음은 배지가 없다(실패를 진행 중으로 보이지 않는다).
 * 배지가 보이는 동안(null이 아닌 동안)은 상태를 2초마다 다시 읽는다.
 */
export function worldBuildBadge(job?: { status: string; update?: { status: string } | null } | null) {
  if (inProgress(job?.status)) return '세계관 추출 중'
  if (inProgress(job?.update?.status)) return '세계관 업데이트 중'
  return null
}

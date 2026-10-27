// 연결 상태의 공통 모양(root, dot)과 상태별 색상(loading, healthy, error)을 구분합니다.
// 상태 판단은 컴포넌트가 맡고, 이 파일은 각 상태가 어떻게 보이는지만 관리합니다.
export const coreApiStatusStyles = {
  root: 'flex items-start gap-[10px] border-t border-[rgba(27,48,37,0.22)] pt-[13px]',
  dot: 'mt-1 size-[9px] shrink-0 rounded-full',
  loadingDot: 'motion-safe:animate-connection-pulse bg-[#b77700]',
  healthyDot: 'bg-[#1f8a4c] shadow-[0_0_0_4px_rgba(31,138,76,0.16)]',
  errorDot: 'bg-[#b23d2b] shadow-[0_0_0_4px_rgba(178,61,43,0.12)]',
  title: 'block text-[0.78rem]',
  description: 'mt-1 mb-0 text-[0.71rem] leading-[1.45] text-[#456438]',
  retryButton: 'mt-[10px] min-h-11 rounded bg-[#1a2d24] px-4 py-2 text-sm text-white focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-brand-primary disabled:opacity-50',
} as const

export function coreApiStatusDotClassName(state: 'loading' | 'healthy' | 'error') {
  const variant = {
    loading: coreApiStatusStyles.loadingDot,
    healthy: coreApiStatusStyles.healthyDot,
    error: coreApiStatusStyles.errorDot,
  }[state]

  return `${coreApiStatusStyles.dot} ${variant}`
}

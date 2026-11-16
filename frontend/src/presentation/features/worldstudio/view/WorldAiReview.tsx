import { Sheet } from '../../../shared/Sheet'
import { reviewButtonLabel, reviewGroups } from '../viewmodel/reviewQueue'
import { useInitialWorldReview } from '../viewmodel/useInitialWorldReview'
import type { useWorldStudioViewModel } from '../viewmodel/useWorldStudioViewModel'
import { ReviewBody } from './InitialWorldReview'
import { WorldReviewSection } from './WorldReviewSection'

type VM = ReturnType<typeof useWorldStudioViewModel>

/**
 * 설정집 화면의 `AI 검토` 버튼과 그 시트. 버튼 이름에는 설정집 검토 의견 수와 후보 검토 대기 수를 짧게 붙인다(`AI 검토 · 의견 5 · 후보 2`, 없으면 `AI 검토`).
 * 시트는 맨 위에 '설정집 검토'(`WorldReviewSection`: 설정을 AI가 검토해 지적·수정안을 낸다), 그 아래에 기존 'AI 후보 검토'(`ReviewBody`: 분석한 설정 후보의 승인·거절)를 둔다.
 * 후보 분석 목록은 화면이 열릴 때 한 번 읽어 대기 수를 보이고(데모는 저장한 후보의 대기 수), 훅을 이 컴포넌트가 가져 시트를 닫아도 분석·검토 상태가 남는다. 설정집 화면이 편집 화면 뒤에 가려져 있는 동안에도 마운트된 채라 같은 상태를 이어 쓴다.
 */
export function WorldAiReview({ studio }: { studio: VM }) {
  const vm = useInitialWorldReview(studio.reviewWorldId, true, studio.dirty || studio.relationDirty, studio.saved?.version, studio.reload, studio.setReviewBusy)
  const waiting = vm.demo ? (studio.saved?.analysis?.candidates.filter((c) => c.decision === 'pending').length ?? 0) : reviewGroups(vm.analysis).pending.length
  const close = () => studio.setReviewOpen(false)
  return (
    <>
      <button type="button" className="btn sm" aria-haspopup="dialog" onClick={() => studio.setReviewOpen(true)}>{reviewButtonLabel(studio.review.findings.length, waiting)}</button>
      {studio.reviewOpen && (
        <Sheet sid="W01" label="AI 검토" panelClass="sheet world-sheet" onClose={close}>
          <div className="world-sheet-head"><button type="button" className="btn sm" onClick={close}>닫기</button></div>
          <WorldReviewSection review={studio.review} />
          <ReviewBody studio={studio} vm={vm} />
        </Sheet>
      )}
    </>
  )
}

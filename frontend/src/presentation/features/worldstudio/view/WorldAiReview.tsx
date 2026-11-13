import { Sheet } from '../../../shared/Sheet'
import { reviewGroups } from '../viewmodel/reviewQueue'
import { useInitialWorldReview } from '../viewmodel/useInitialWorldReview'
import type { useWorldStudioViewModel } from '../viewmodel/useWorldStudioViewModel'
import { ReviewBody } from './InitialWorldReview'

type VM = ReturnType<typeof useWorldStudioViewModel>

/**
 * 설정집 화면의 `AI 후보 검토 (대기 N)` 버튼과 그 시트. 분석 목록은 화면이 열릴 때 한 번 읽어 대기 수를 보이고(데모는 저장한 후보의 대기 수), 시트는 `ReviewBody`(카드형 후보 검토)를 연다.
 * 훅을 이 컴포넌트가 가져 시트를 닫아도 분석·검토 상태가 남는다. 설정집 화면이 편집 화면 뒤에 가려져 있는 동안에도 마운트된 채라 같은 상태를 이어 쓴다.
 */
export function WorldAiReview({ studio }: { studio: VM }) {
  const vm = useInitialWorldReview(studio.reviewWorldId, true, studio.dirty || studio.relationDirty, studio.saved?.version, studio.reload, studio.setReviewBusy)
  const waiting = vm.demo ? (studio.saved?.analysis?.candidates.filter((c) => c.decision === 'pending').length ?? 0) : reviewGroups(vm.analysis).pending.length
  const close = () => studio.setReviewOpen(false)
  return (
    <>
      <button type="button" className="btn sm" aria-haspopup="dialog" onClick={() => studio.setReviewOpen(true)}>AI 후보 검토 (대기 {waiting})</button>
      {studio.reviewOpen && (
        <Sheet sid="W01" label="AI 후보 검토" panelClass="sheet world-sheet" onClose={close}>
          <div className="world-sheet-head"><button type="button" className="btn sm" onClick={close}>닫기</button></div>
          <ReviewBody studio={studio} vm={vm} />
        </Sheet>
      )}
    </>
  )
}

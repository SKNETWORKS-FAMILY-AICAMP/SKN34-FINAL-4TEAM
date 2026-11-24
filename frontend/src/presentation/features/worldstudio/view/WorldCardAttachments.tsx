import { MediaPanel } from '../../../shared/media/MediaPanel'
import type { useWorldStudioViewModel } from '../viewmodel/useWorldStudioViewModel'

type VM = ReturnType<typeof useWorldStudioViewModel>

/**
 * 설정 카드의 첨부(참고 파일·설정 이미지, #735): 공용 `MediaPanel`을 카드 대상으로 붙인다. 올리기·목록·내려받기·이름 변경·교체·삭제는 옛 설정 첨부와 같고
 * 세계관 소유자만 보고 받는다(독자 설정 위키·공개 세계관·가져오기에는 나오지 않는다). 대표 이미지(`CardImageControl`)와는 별개다.
 * 첨부는 서버에 저장된 카드에만 붙는다: 아직 저장하지 않은 새 카드는 패널 대신 이유를 알리고, 서버 저장소가 없는 데모(메모리)는 첨부 자체가 없어 아무것도 그리지 않는다(카드 이미지와 같은 기준).
 * 세계관을 저장하는 동안은 패널을 잠가 그사이 올린 파일과 저장이 겹치지 않게 한다.
 */
export function WorldCardAttachments({ vm, cardId }: { vm: VM; cardId: string }) {
  if (!vm.cardImages.supported) return null
  if (!vm.saved?.settings.some((s) => s.item.id === cardId)) {
    return (
      <section className="media-panel" aria-label="설정 첨부">
        <h3>이미지·파일 첨부</h3>
        <p className="small muted">세계관을 저장하면 이 카드에 참고 파일·이미지를 첨부할 수 있어요.</p>
      </section>
    )
  }
  return <MediaPanel key={cardId} target={{ kind: 'card', worldId: vm.saved.id, cardId }} disabled={vm.busy} />
}

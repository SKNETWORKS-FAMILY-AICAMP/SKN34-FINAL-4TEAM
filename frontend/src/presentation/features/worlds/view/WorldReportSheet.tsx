import type { PublicWorld } from '../../../../domain/entities/publicWorld'
import { ReportWorkForm } from '../../../shared/reports/ReportWorkForm'
import { Sheet } from '../../../shared/Sheet'

/** 공개 세계관 신고 시트(결정 D). 서버 세계관만 운영 신고 API(34)로 접수하고, 처리의 제한·해제는 이 세계관의 공개 경로에 적용된다. */
export function WorldReportSheet({ world, onClose }: { world: Pick<PublicWorld, 'id' | 'name'>; onClose: () => void }) {
  return (
    <Sheet sid="U06" label="세계관 신고" onClose={onClose}>
      <div className="sh-h"><h3>🚩 세계관 신고 · {world.name}</h3><button type="button" className="x" aria-label="닫기" onClick={onClose}>✕</button></div>
      <ReportWorkForm key={world.id} target={{ targetType: 'world', worldId: world.id }} title={world.name} alwaysOpen />
    </Sheet>
  )
}

import { historyLabel, type ReportHistory } from '../../../domain/entities/report'
import { kstDateTime } from '../format'

/** 신고 처리 이력(오래된순). 관리자 화면과 내 신고 화면이 함께 씁니다. */
export function ReportHistoryList({ history }: { history: ReportHistory[] }) {
  if (!history.length) return <p className='small muted'>아직 처리 이력이 없어요.</p>
  return (
    <ol className='mt-2 list-decimal space-y-3 pl-5'>
      {history.map((h) => (
        <li key={h.id}>
          <b>{historyLabel(h.type)}</b> <span className='small muted'>{kstDateTime(h.createdAt)}</span>
          {h.body && <p className='mt-1 whitespace-pre-wrap break-words'>{h.body}</p>}
        </li>
      ))}
    </ol>
  )
}

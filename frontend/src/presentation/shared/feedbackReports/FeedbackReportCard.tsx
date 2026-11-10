import type { ReactNode, Ref } from 'react'

import {
  REPORT_KIND_LABEL, REPORT_STATUS_LABEL, REPORT_VISIBILITY_LABEL, reportStatusChip, type FeedbackReport,
} from '../../../domain/entities/feedbackReport'
import { kstDateTime } from '../format'

const wrap = { whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' } as const

/**
 * 제보 한 건의 표시(읽기 전용)다. 회차 제보 목록·내 제보·작가 피드백함이 함께 쓴다.
 * 원문을 볼 수 없는 제보(body가 null: 비공개 제보의 공개 답변만 노출)는 내용 대신 안내를 보이고, 철회·정정은 원문을 지우지 않고 표시만 남긴다.
 * 동작 버튼은 호출 측이 children으로 넣는다. 처리한 버튼이 사라져도 키보드 위치를 이어 갈 수 있게 카드는 ref로 프로그램 포커스를 받는다(tabIndex -1).
 */
export function FeedbackReportCard({ report: r, showWork = false, ref, children }: { report: FeedbackReport; showWork?: boolean; ref?: Ref<HTMLDivElement>; children?: ReactNode }) {
  const meta = [r.reporterName, kstDateTime(r.createdAt)].filter(Boolean).join(' · ')
  return (
    <div className="rp" data-report={r.id} ref={ref} tabIndex={-1}>
      <div className="top">
        <b>{showWork ? `${r.workTitle} ` : ''}{r.episodeNumber}화 · {REPORT_KIND_LABEL[r.kind]}</b>
        <span>
          {r.visibility === 'private' && <><span className="chip">{REPORT_VISIBILITY_LABEL.private}</span>{' '}</>}
          {r.withdrawn && <><span className="chip">철회됨</span>{' '}</>}
          <span className={`chip ${reportStatusChip(r.status)}`}>{REPORT_STATUS_LABEL[r.status]}</span>
        </span>
      </div>
      {r.quote && <q className="cq">{r.quote}</q>}
      {r.body === null
        ? <p className="small muted">비공개 제보라 내용은 보이지 않고 작가의 공개 답변만 볼 수 있어요.</p>
        : <div className="small" style={wrap}>{r.body}</div>}
      <div className="small muted">{meta}</div>
      {r.amendments.map((a) => (
        <div className="a" key={a.createdAt + a.action}>
          {a.action === 'correct'
            ? <>✎ 정정 · {kstDateTime(a.createdAt)}<br /><span style={wrap}>{a.body}</span></>
            : <>↩ 철회됨 · {kstDateTime(a.createdAt)}</>}
        </div>
      ))}
      {r.responses.map((p) => (
        <div className="a" key={p.id}>
          <b>{p.authorName}</b>{!p.isPublic && ' · 비공개 답변'} · {kstDateTime(p.createdAt)}<br />
          <span style={wrap}>{p.body}</span>
        </div>
      ))}
      {children}
    </div>
  )
}

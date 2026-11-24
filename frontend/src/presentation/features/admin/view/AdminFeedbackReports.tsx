import {
  FEEDBACK_REPORT_STATUSES, REPORT_KIND_LABEL, REPORT_STATUS_LABEL, REPORT_VISIBILITY_LABEL, reportStatusChip,
} from '../../../../domain/entities/feedbackReport'
import { kstDateTime } from '../../../shared/format'
import type { useAdminViewModel } from '../viewmodel/useAdminViewModel'
import type { useFeedbackReportsViewModel } from '../viewmodel/useFeedbackReportsViewModel'
import { LiveState, Pager, Table } from './OperationsPanels'

type VM = ReturnType<typeof useAdminViewModel>
type Reports = NonNullable<ReturnType<typeof useFeedbackReportsViewModel>>

/** 제보·문의 탭의 작가 검토 제보(#750): 독자가 회차에 남긴 모든 제보를 읽기만 합니다. 확인·답변·상태 변경은 작가가 하므로 조치 버튼이 없습니다. */
export function AdminFeedbackReports({ vm, reports }: { vm: VM; reports: Reports }) {
  const page = reports.data
  return (
    <section className="panel admin-operations" aria-label="작가 검토 제보">
      <h2 className="panel-title">작가 검토 제보</h2>
      <p className="small muted">독자가 작품 회차에 남긴 제보를 최신순으로 보여 줘요. 열람 전용 · 처리는 작가가 합니다.</p>
      <div className="admin-filter">
        <label className="field">
          상태
          <select
            className="inp"
            value={reports.status ?? ''}
            onChange={(e) => reports.setStatus(FEEDBACK_REPORT_STATUSES.find((status) => status === e.target.value) ?? null)}
          >
            <option value="">전체</option>
            {FEEDBACK_REPORT_STATUSES.map((status) => <option key={status} value={status}>{REPORT_STATUS_LABEL[status]}</option>)}
          </select>
        </label>
      </div>
      <LiveState vm={vm} label="작가 검토 제보 목록" state={reports} />
      {page && (page.items.length
        ? (
          <>
            <Table label="작가 검토 제보 표">
              <thead>
                <tr>
                  <th scope="col">유형</th>
                  <th scope="col">내용</th>
                  <th scope="col">작품·회차</th>
                  <th scope="col">제보자</th>
                  <th scope="col">접수일</th>
                  <th scope="col">상태</th>
                </tr>
              </thead>
              <tbody>
                {page.items.map((report) => (
                  <tr key={report.id}>
                    <td className="admin-nowrap">
                      {REPORT_KIND_LABEL[report.kind]}
                      <br />
                      <span className="small muted">{REPORT_VISIBILITY_LABEL[report.visibility]} 제보</span>
                    </td>
                    <td>
                      <div className="admin-prose">{report.body}</div>
                      {report.quote && <div className="admin-prose small muted">“{report.quote}”</div>}
                    </td>
                    <td>{report.workTitle} · {report.episodeNumber}화</td>
                    <td className="admin-nowrap">{report.reporterName}</td>
                    <td className="admin-nowrap">{kstDateTime(report.createdAt)}</td>
                    <td className="admin-nowrap">
                      <span className={`chip ${reportStatusChip(report.status)}`}>{REPORT_STATUS_LABEL[report.status]}</span>
                      {report.withdrawn && <span className="chip">철회됨</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </Table>
            <Pager page={page.page} size={page.size} total={page.total} onPage={reports.setPage} />
          </>
        )
        : <p className="admin-empty">{reports.status ? '조건에 맞는 제보가 없어요.' : '접수된 제보가 없어요.'}</p>)}
    </section>
  )
}

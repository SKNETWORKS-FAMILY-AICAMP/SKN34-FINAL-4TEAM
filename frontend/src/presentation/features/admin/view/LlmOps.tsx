import {
  METRICS_GROUPS, PERIODS, TRACE_STATUS_OPTIONS, bodyText, count, millis, percent, traceStatusLabel, usd, type TraceItem,
} from '../../../../domain/entities/llmOps'
import { kstDateTime } from '../../../shared/format'
import { LLM_VIEWS, useLlmOpsViewModel } from '../viewmodel/useLlmOpsViewModel'
import type { useAdminViewModel } from '../viewmodel/useAdminViewModel'
import { LlmAlerts } from './LlmAlerts'
import { LlmOpsManage } from './LlmOpsManage'
import { formText } from './formValue'
import { LiveState, Pager, Table } from './OperationsPanels'
import { useAdminDetailFocus } from './useAdminDetailFocus'

export type VM = ReturnType<typeof useAdminViewModel>
export type LlmVM = ReturnType<typeof useLlmOpsViewModel>

const statusChip = (status: string) => <span className={`chip ${status === 'success' ? 'ok' : 'wait'}`}>{traceStatusLabel(status)}</span>

/** 40-A~E LLM Ops: Langfuse 기준 추적·지표와 프롬프트·모델·평가·누설 검사·경고 기준을 운영 서비스 API로 보고 관리합니다. */
export function LlmOps({ vm }: { vm: VM }) {
  const l = useLlmOpsViewModel(vm.live.mutate)
  // 목록에서 상세를 열면 상세 제목으로, 닫으면 눌렀던 목록 버튼으로 초점을 옮깁니다.
  const root = useAdminDetailFocus(l.traceId ?? l.promptName ?? l.runId, !!(l.trace.data || l.prompt.data || l.evaluation.data))
  return (
    <>
      <nav className="chips admin-subnav" aria-label="LLM Ops 보기">
        {LLM_VIEWS.map(([view, label]) => (
          <button key={view} type="button" className={l.view === view ? 'on' : undefined} aria-pressed={l.view === view} onClick={() => l.choose(view)}>{label}</button>
        ))}
      </nav>
      <section ref={root}>
        {l.view === 'alerts' && <LlmAlerts vm={vm} />}
        {l.view === 'traces' && (l.traceId ? <TraceDetailPanel vm={vm} l={l} /> : <Traces vm={vm} l={l} />)}
        {l.view === 'metrics' && <Metrics vm={vm} l={l} />}
        {l.view === 'leaks' && <LeakChecks vm={vm} l={l} />}
        <LlmOpsManage vm={vm} l={l} />
      </section>
    </>
  )
}

function Traces({ vm, l }: { vm: VM; l: LlmVM }) {
  const page = l.traces.data, f = l.traceFilters
  return (
    <section className="panel admin-operations" aria-label="LLM 추적">
      <form
        className="admin-filter"
        onSubmit={(e) => {
          e.preventDefault()
          const form = e.currentTarget
          l.applyTraceFilters({ hours: Number(formText(form, 'hours')), feature: formText(form, 'feature'), status: formText(form, 'status'), userId: formText(form, 'userId'), requestId: formText(form, 'requestId') })
        }}
      >
        <label className="field">기간<select className="inp" name="hours" defaultValue={f.hours}>{PERIODS.map(([hours, label]) => <option key={hours} value={hours}>{label}</option>)}</select></label>
        <label className="field">기능<input className="inp" name="feature" defaultValue={f.feature} placeholder="예: qa" /></label>
        <label className="field">
          상태
          <select className="inp" name="status" defaultValue={f.status}>
            <option value="">전체</option>
            {TRACE_STATUS_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </label>
        <label className="field">회원<input className="inp" name="userId" defaultValue={f.userId} placeholder="회원 ID" /></label>
        <label className="field">요청 ID<input className="inp" name="requestId" defaultValue={f.requestId} placeholder="AI 요청 ID" /></label>
        <button type="submit" className="btn sm pri">조회</button>
      </form>
      <LiveState vm={vm} label="추적 목록" state={l.traces} />
      {page && (page.items.length
        ? (
          <>
            <Table label="LLM 추적 표">
              <thead>
                <tr>
                  <th scope="col">시각</th>
                  <th scope="col">기능</th>
                  <th scope="col">상태</th>
                  <th scope="col">지연</th>
                  <th scope="col">토큰(입력/출력)</th>
                  <th scope="col">비용</th>
                  <th scope="col">회원</th>
                  <th scope="col" className="act">상세</th>
                </tr>
              </thead>
              <tbody>{page.items.map((row) => <TraceRow key={row.id} row={row} onOpen={l.openTrace} />)}</tbody>
            </Table>
            <Pager page={page.page} size={page.size} total={page.total} onPage={l.setTracePage} />
          </>
        )
        : <p className="admin-empty">조건에 맞는 추적이 없어요.</p>)}
      <p className="admin-note">AI 요청 하나가 추적 하나예요. 요청 ID로는 한 요청의 실행 단계를 바로 찾을 수 있어요. 입력·출력 본문은 상세에서만 보여요.</p>
    </section>
  )
}

function TraceRow({ row, onOpen }: { row: TraceItem; onOpen: (id: string) => void }) {
  return (
    <tr>
      <td>{kstDateTime(row.timestamp)}</td>
      <td>{row.feature}</td>
      <td>{statusChip(row.status)}</td>
      <td>{millis(row.latencyMs)}</td>
      <td>{count(row.inputTokens)} / {count(row.outputTokens)}</td>
      <td>{usd(row.cost)}</td>
      <td>{row.userId ?? '—'}</td>
      <td><button type="button" className="btn sm" data-record-id={row.id} aria-label={`${row.feature} 추적 ${row.id} 단계 상세`} onClick={() => onOpen(row.id)}>단계 상세</button></td>
    </tr>
  )
}

function TraceDetailPanel({ vm, l }: { vm: VM; l: LlmVM }) {
  const t = l.trace.data
  return (
    <section className="panel admin-operations" aria-label="추적 상세">
      <button type="button" className="btn sm" onClick={l.closeTrace}>추적 목록으로</button>
      <LiveState vm={vm} label="추적 상세 내용" state={l.trace} />
      {t && (
        <>
          <h2 tabIndex={-1}>{t.feature} · {traceStatusLabel(t.status)}</h2>
          <dl className="ai">
            <dt>시각</dt><dd>{kstDateTime(t.timestamp)}</dd>
            <dt>지연</dt><dd>{millis(t.latencyMs)}</dd>
            <dt>토큰</dt><dd>입력 {count(t.inputTokens)} / 출력 {count(t.outputTokens)}</dd>
            <dt>비용</dt><dd>{usd(t.cost)}</dd>
            <dt>회원</dt><dd>{t.userId ?? '—'}</dd>
            <dt>작품</dt><dd>{t.workId ?? '—'}</dd>
            <dt>추적 ID</dt><dd>{t.id}</dd>
          </dl>
          <h3>실행 단계</h3>
          <Table label="추적 실행 단계 표">
            <thead>
              <tr>
                <th scope="col">단계</th>
                <th scope="col">종류</th>
                <th scope="col">시작</th>
                <th scope="col">지연</th>
                <th scope="col">모델</th>
                <th scope="col">토큰(입력/출력)</th>
                <th scope="col">수준</th>
                <th scope="col">프롬프트</th>
              </tr>
            </thead>
            <tbody>
              {t.observations.map((o) => (
                <tr key={o.id}>
                  <td>{o.name}</td>
                  <td>{o.type}</td>
                  <td>{kstDateTime(o.startTime)}</td>
                  <td>{millis(o.latencyMs)}</td>
                  <td>{o.model ?? '—'}</td>
                  <td>{count(o.inputTokens)} / {count(o.outputTokens)}</td>
                  <td>
                    <span className={`chip ${o.level === 'ERROR' ? 'wait' : ''}`}>{o.level}</span>
                    {o.statusMessage && <div className="small">{o.statusMessage}</div>}
                  </td>
                  <td>{o.promptName ? `${o.promptName} v${o.promptVersion ?? '?'}` : '—'}</td>
                </tr>
              ))}
            </tbody>
          </Table>
          <h3>입력</h3>
          <pre className="admin-prose">{bodyText(t.input) || '기록 없음'}</pre>
          <h3>출력</h3>
          <pre className="admin-prose">{bodyText(t.output) || '기록 없음'}</pre>
        </>
      )}
    </section>
  )
}

function Metrics({ vm, l }: { vm: VM; l: LlmVM }) {
  const m = l.metrics.data, q = l.metricsQuery
  const groupLabel = METRICS_GROUPS.find(([value]) => value === q.groupBy)?.[1] ?? ''
  return (
    <section className="panel admin-operations" aria-label="LLM 지표">
      <form
        className="admin-filter"
        onSubmit={(e) => {
          e.preventDefault()
          const form = e.currentTarget
          l.setMetricsQuery({ hours: Number(formText(form, 'hours')), groupBy: METRICS_GROUPS.find(([value]) => value === formText(form, 'groupBy'))?.[0] ?? 'day' })
        }}
      >
        <label className="field">기간<select className="inp" name="hours" defaultValue={q.hours}>{PERIODS.map(([hours, label]) => <option key={hours} value={hours}>{label}</option>)}</select></label>
        <label className="field">
          묶음
          <select className="inp" name="groupBy" defaultValue={q.groupBy}>{METRICS_GROUPS.map(([value, label]) => <option key={value} value={value}>{label}별</option>)}</select>
        </label>
        <button type="submit" className="btn sm pri">조회</button>
      </form>
      <LiveState vm={vm} label="지표 현황" state={l.metrics} />
      {m && (
        <>
          {m.rows.length
            ? (
              <Table label="LLM 지표 표">
                <thead>
                  <tr>
                    <th scope="col">{groupLabel}</th>
                    <th scope="col">요청</th>
                    <th scope="col">실패율</th>
                    <th scope="col">시간 초과율</th>
                    <th scope="col">p50 지연</th>
                    <th scope="col">p95 지연</th>
                    <th scope="col">토큰(입력/출력)</th>
                    <th scope="col">비용(사용자)</th>
                    <th scope="col">비용(플랫폼)</th>
                  </tr>
                </thead>
                <tbody>
                  {m.rows.map((row) => (
                    <tr key={row.key}>
                      <td>{row.key}</td>
                      <td>{count(row.requests)}</td>
                      <td>{percent(row.failureRate)}</td>
                      <td>{percent(row.timeoutRate)}</td>
                      <td>{millis(row.p50LatencyMs)}</td>
                      <td>{millis(row.p95LatencyMs)}</td>
                      <td>{count(row.inputTokens)} / {count(row.outputTokens)}</td>
                      <td>{usd(row.costUser)}</td>
                      <td>{usd(row.costPlatform)}</td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            )
            : <p className="admin-empty">이 기간의 요청이 없어요.</p>}
          <div className="kpi">
            {([['제안 채택률', m.adoptionRate], ['수정안 승인률', m.approvalRate], ['필터 복원률', m.filterRestoreRate]] as const).map(([label, rate]) => (
              <div key={label}>
                <small>{label}</small>
                <b className={rate == null ? 'unavailable' : undefined}>{percent(rate)}</b>
              </div>
            ))}
          </div>
        </>
      )}
      <p className="admin-note">사용자 부담 비용은 AI 요청이 크레딧을 차감하기 시작하면 0이 아니게 돼요. 필터 복원률은 콘텐츠 필터 기능이 생기기 전까지 데이터가 없어요.</p>
    </section>
  )
}

function LeakChecks({ vm, l }: { vm: VM; l: LlmVM }) {
  const rows = l.leaks.data
  return (
    <section className="panel admin-operations" aria-label="정보 누설 검사">
      <LiveState vm={vm} label="누설 검사 기록" state={l.leaks} />
      {rows && (rows.length
        ? (
          <Table label="정보 누설 검사 표">
            <thead>
              <tr>
                <th scope="col">검사 시각</th>
                <th scope="col">작품</th>
                <th scope="col">판정</th>
                <th scope="col">걸린 항목</th>
                <th scope="col">사유</th>
                <th scope="col" className="act">추적</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  <td>{kstDateTime(row.checkedAt)}</td>
                  <td>{row.workId}</td>
                  <td><span className={`chip ${row.suspected ? 'wait' : 'ok'}`}>{row.suspected ? '의심' : '이상 없음'}</span></td>
                  <td>{row.matched.join(', ') || '—'}</td>
                  <td>{row.reason ?? '—'}</td>
                  <td><button type="button" className="btn sm" aria-label={`추적 ${row.traceId} 보기`} onClick={() => l.openTrace(row.traceId)}>추적 보기</button></td>
                </tr>
              ))}
            </tbody>
          </Table>
        )
        : <p className="admin-empty">아직 검사 결과가 없어요.</p>)}
      <p className="admin-note">Fork 작품 요청을 표본으로 뽑아 원작의 비공개 카드 제목·미발행 회차 제목이 답변에 그대로 나왔는지 대조한 결과예요. 표본 비율은 ‘경고 기준·설정’에서 정해요.</p>
    </section>
  )
}

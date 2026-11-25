import type { ReactNode } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router'

import { METRICS_SUBS, PROMPT_SUBS, type LlmPage, type MetricsSub, type PipelineFlowKey, type PromptSub, llmPageHref, metricsSub, metricsSubHref, pipelineFlowHref, pipelineFlowKey, promptSub, promptViewHref } from '../../../../domain/entities/admin'
import { LLM_FORBIDDEN, PERIODS, TRACE_STATUS_OPTIONS, bodyText, count, millis, traceStatusLabel, usd, type TraceItem } from '../../../../domain/entities/llmOps'
import { kstDateTime } from '../../../shared/format'
import { MoreVerticalIcon } from '../../../shared/icons'
import { PopMenu } from '../../../shared/PopMenu'
import { useLlmOpsViewModel } from '../viewmodel/useLlmOpsViewModel'
import type { useAdminViewModel } from '../viewmodel/useAdminViewModel'
import { AdminPipeline } from './AdminPipeline'
import { AgentMetrics } from './AgentMetrics'
import { LlmAlerts } from './LlmAlerts'
import { AgentEvaluations, AlertRules, LeakSampleRate, Models, Prompts } from './LlmOpsManage'
import { PromptDetail } from './PromptLoop'
import { PromptName } from './PromptName'
import { formText } from './formValue'
import { LiveState, Pager, Table } from './OperationsPanels'
import { useAdminDetailFocus } from './useAdminDetailFocus'

export type VM = ReturnType<typeof useAdminViewModel>
export type LlmVM = ReturnType<typeof useLlmOpsViewModel>

const statusChip = (status: string) => <span className={`chip ${status === 'success' ? 'ok' : 'bad'}`}>{traceStatusLabel(status)}</span>

/** VM이 옮겨 갈 자리(쪽과 보기)의 주소. 보기를 모르면 그 쪽의 첫 보기이고, 프롬프트·평가로 가면 지금의 흐름 범위를 그대로 가져갑니다(#857). */
const placeHref = (page: LlmPage, sub: string | undefined, flow: PipelineFlowKey) =>
  page === 'prompts' ? promptViewHref(promptSub(sub ?? null), flow) : page === 'metrics' ? metricsSubHref(metricsSub(sub ?? null)) : llmPageHref(page)

/**
 * 40-A~E LLM Ops: Langfuse 기준 추적·지표와 프롬프트·평가·누설 검사·경고 기준을 운영 서비스 API로 보고 관리합니다(#857로 세 메뉴).
 * 사이드바 세 메뉴(주소 view)가 쪽이고, 쪽마다 패널을 위아래로 쌓습니다. 상세(추적·프롬프트)를 열면 그 쪽은 상세만 보이고 닫으면 목록 패널들이 돌아옵니다.
 * 에이전트 지표 쪽은 위의 보기 전환(주소 sub)으로 지표(에이전트 카드)·추적 중 하나만, 프롬프트·평가 쪽은 에이전트별 평가(입구)·프롬프트·모델·AI 파이프라인(DEC-58) 중 하나만 보입니다.
 * 경고·누설 감시 쪽은 경고 목록·경고 기준 아래에 정보 누설 검사 기록과 표본 비율을 쌓습니다.
 */
export function LlmOps({ vm, page }: { vm: VM; page: LlmPage }) {
  const navigate = useNavigate()
  const params = useSearchParams()[0]
  const rawSub = params.get('sub')
  const metrics = metricsSub(rawSub), prompts = promptSub(rawSub), workflow = pipelineFlowKey(params.get('flow'))
  const l = useLlmOpsViewModel(vm.live.mutate, page, (next, nextSub) => navigate(placeHref(next, nextSub, workflow)), page === 'metrics' ? metrics : prompts, workflow)
  // 워크플로우(주소 flow, AI 파이프라인 보기)는 사이드바 하위 탭이 고르고, 기록 패널의 '내부 흐름 보기'는 같은 주소로 옮겨 갑니다(VM이 주소가 바뀌면 고른 노드를 닫습니다).
  const onWorkflow = (next: PipelineFlowKey) => navigate(pipelineFlowHref(next))
  // 목록에서 상세를 열면 상세 제목으로, 닫으면 눌렀던 목록 버튼으로 초점을 옮깁니다(프롬프트 상세 안의 평가 Run은 평가 단계가 따로 맡습니다).
  const root = useAdminDetailFocus(l.traceId ?? l.promptName, !!(l.trace.data || l.prompt.data))
  return (
    <section ref={root}>
      {page === 'metrics' && <MetricsView vm={vm} l={l} sub={metrics} />}
      {page === 'prompts' && <PromptsView vm={vm} l={l} sub={prompts} workflow={workflow} onWorkflow={onWorkflow} />}
      {page === 'alerts' && <><LlmAlerts vm={vm} /><AlertRules vm={vm} l={l} /><LeakChecks vm={vm} l={l}><LeakSampleRate vm={vm} l={l} /></LeakChecks></>}
    </section>
  )
}

/** 에이전트 지표 쪽: 보기 전환(지표·추적)과 고른 보기 하나. 추적 상세를 열어 둔 동안은 상세만 보입니다. */
function MetricsView({ vm, l, sub }: { vm: VM; l: LlmVM; sub: MetricsSub }) {
  return (
    <>
      {!l.traceId && (
        <nav className="pipe-views" aria-label="에이전트 지표 보기">
          {METRICS_SUBS.map(([key, label]) => <Link key={key} to={metricsSubHref(key)} aria-current={key === sub ? 'page' : undefined}>{label}</Link>)}
        </nav>
      )}
      {sub === 'cards' && <AgentMetrics vm={vm} l={l} />}
      {sub === 'traces' && (l.traceId ? <TraceDetailPanel vm={vm} l={l} /> : <Traces vm={vm} l={l} />)}
    </>
  )
}

/** 프롬프트·평가 쪽: 보기 전환(에이전트별 평가·프롬프트·모델·AI 파이프라인)과 고른 보기 하나. 프롬프트 상세(개선 루프)를 열어 둔 동안은 상세만 보입니다. */
function PromptsView({ vm, l, sub, workflow, onWorkflow }: { vm: VM; l: LlmVM; sub: PromptSub; workflow: PipelineFlowKey; onWorkflow: (workflow: PipelineFlowKey) => void }) {
  return (
    <>
      {!l.promptName && (
        <nav className="pipe-views" aria-label="프롬프트·평가 보기">
          {PROMPT_SUBS.map(([key, label]) => <Link key={key} to={promptViewHref(key, workflow)} aria-current={key === sub ? 'page' : undefined}>{label}</Link>)}
        </nav>
      )}
      {sub === 'evals' && <AgentEvaluations vm={vm} l={l} workflow={workflow} />}
      {sub === 'all' && <AdminPipeline vm={vm} l={l} workflow={workflow} onWorkflow={onWorkflow} />}
      {sub === 'prompts' && (l.promptName ? <PromptDetail vm={vm} l={l} /> : <Prompts vm={vm} l={l} workflow={workflow} />)}
      {sub === 'models' && <Models vm={vm} l={l} />}
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
        <button type="submit" className="btn sm">조회</button>
      </form>
      <LiveState vm={vm} label="추적 목록" state={l.traces} forbidden={LLM_FORBIDDEN} />
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
                  <th scope="col" className="act act-menu"><span className="sr-only">상세</span></th>
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
      <td className="admin-date">{kstDateTime(row.timestamp)}</td>
      <td>{row.feature}</td>
      <td>{statusChip(row.status)}</td>
      <td>{millis(row.latencyMs)}</td>
      <td>{count(row.inputTokens)} / {count(row.outputTokens)}</td>
      <td>{usd(row.cost)}</td>
      <td>{row.userId ?? '—'}</td>
      <td className="act-menu" data-record-id={row.id}>
        <PopMenu className="row-menu" label={`「${row.feature} 추적 ${row.id}」 조치`} icon={<MoreVerticalIcon />}>
          <button type="button" role="menuitem" onClick={() => onOpen(row.id)}>단계 상세</button>
        </PopMenu>
      </td>
    </tr>
  )
}

function TraceDetailPanel({ vm, l }: { vm: VM; l: LlmVM }) {
  const t = l.trace.data
  return (
    <section className="panel admin-operations" aria-label="추적 상세">
      <button type="button" className="btn sm" onClick={l.closeTrace}>추적 목록으로</button>
      <LiveState vm={vm} label="추적 상세 내용" state={l.trace} forbidden={LLM_FORBIDDEN} />
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
                  <td className="admin-date">{o.startTime ? kstDateTime(o.startTime) : '—'}</td>
                  <td>{millis(o.latencyMs)}</td>
                  <td>{o.model ?? '—'}</td>
                  <td>{count(o.inputTokens)} / {count(o.outputTokens)}</td>
                  <td>
                    <span className={`chip ${o.level === 'ERROR' ? 'bad' : ''}`}>{o.level}</span>
                    {o.statusMessage && <div className="small">{o.statusMessage}</div>}
                  </td>
                  <td>{o.promptName ? <><PromptName code={o.promptName} /> v{o.promptVersion ?? '?'}</> : '—'}</td>
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

function LeakChecks({ vm, l, children }: { vm: VM; l: LlmVM; children: ReactNode }) {
  const rows = l.leaks.data
  return (
    <section className="panel admin-operations" aria-label="정보 누설 검사">
      <h2>정보 누설 검사</h2>
      <LiveState vm={vm} label="누설 검사 기록" state={l.leaks} forbidden={LLM_FORBIDDEN} />
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
                <th scope="col" className="act act-menu"><span className="sr-only">추적</span></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  <td className="admin-date">{kstDateTime(row.checkedAt)}</td>
                  <td>{row.workId}</td>
                  <td><span className={`chip ${row.suspected ? 'bad' : 'ok'}`}>{row.suspected ? '의심' : '이상 없음'}</span></td>
                  <td>{row.matched.join(', ') || '—'}</td>
                  <td>{row.reason ?? '—'}</td>
                  <td className="act-menu">
                    <PopMenu className="row-menu" label={`「추적 ${row.traceId}」 조치`} icon={<MoreVerticalIcon />}>
                      <button type="button" role="menuitem" onClick={() => l.openTrace(row.traceId)}>추적 보기</button>
                    </PopMenu>
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        )
        : <p className="admin-empty">아직 검사 결과가 없어요.</p>)}
      <p className="admin-note">Fork 작품 요청을 표본으로 뽑아 원작의 비공개 카드 제목·미발행 회차 제목이 답변에 그대로 나왔는지 대조한 결과예요.</p>
      {children}
    </section>
  )
}

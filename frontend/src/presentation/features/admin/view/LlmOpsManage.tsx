import { Fragment, useState } from 'react'

import {
  LLM_FORBIDDEN, OPTIMIZATION_DEFAULT_CALLS, OPTIMIZATION_MAX_CALLS, estimatedCalls, evaluationStatusLabel, fixedModel, isOptimizable, itemReason, itemWaiting, labelText, modelLabel, passedLabel, pendingSeed, perMillion,
  productionOf, versionAction, type Evaluation, type EvaluationItem,
} from '../../../../domain/entities/llmOps'
import { AGENT_EVALUATIONS, latestRun } from '../../../../domain/entities/llmOpsEvalTable'
import { alertRuleLabel, type AlertRule } from '../../../../domain/entities/operationsAlert'
import { kstDateTime } from '../../../shared/format'
import { MoreVerticalIcon } from '../../../shared/icons'
import { PopMenu } from '../../../shared/PopMenu'
import { EvaluationChart } from './AdminCharts'
import type { LlmVM, VM } from './LlmOps'
import { formNumber, formText } from './formValue'
import { ActionLines, LiveState, Table } from './OperationsPanels'

type Props = { vm: VM; l: LlmVM }

/** 평가 통과 여부의 칩 색: 미통과만 실패 색(bad)이고, 통과는 중립, 결과 없음(null)은 칠하지 않는다. */
const passTone = (passed: boolean | null | undefined) => (passed === false ? 'bad' : passed ? 'ok' : '')

/**
 * 프롬프트 패널(#705): 모든 LLM 호출의 프롬프트를 표로 보이고, 상세에서 모델+본문 조합을 저장하고 후보로 등록한 뒤 서비스에 반영합니다.
 * 회귀 평가·지표는 평가 세트가 있는 프롬프트(#787)만 후보 등록에 통과가 필요하고 나머지는 선택입니다(평가 쪽에서 실행하고 버전 행에서 결과를 엽니다). 변경 조치는 모두 활동 로그에 남습니다.
 */
export function Prompts({ vm, l }: Props) {
  const rows = l.prompts.data, p = l.prompt.data, live = p && productionOf(p), seed = p && pendingSeed(p)
  // 고를 수 있는 모델은 운영 설정의 목록(AI가 부르는 OpenAI 모델, #806)이고, 반영 중인 모델은 목록에 없어도 그대로 남긴다.
  const modelNames = [...new Set([...(live?.model ? [live.model] : []), ...(p?.models ?? [])])]
  if (!l.promptName) {
    return (
      <section className="panel admin-operations" aria-label="프롬프트">
        <LiveState vm={vm} label="프롬프트 목록" state={l.prompts} forbidden={LLM_FORBIDDEN} />
        {rows && (rows.length
          ? (
            <Table label="프롬프트 표">
              <thead>
                <tr>
                  <th scope="col">프롬프트</th>
                  <th scope="col">서비스 반영</th>
                  <th scope="col">모델</th>
                  <th scope="col">후보</th>
                  <th scope="col">코드 시드</th>
                </tr>
              </thead>
              <tbody>
                {[...rows].sort((a, b) => a.name.localeCompare(b.name)).map((row) => {
                  const current = productionOf(row), pending = pendingSeed(row), candidates = row.candidates
                  return (
                    <tr key={row.name}>
                      <td><button type="button" className="admin-prompt-name" data-record-id={row.name} onClick={() => l.openPrompt(row.name)}>{row.name}</button></td>
                      <td className="admin-num">{current ? `${current.version}번 버전` : '없음'}</td>
                      <td>{current ? modelLabel(current.model) : '—'}</td>
                      <td className="admin-num">{candidates ? `${candidates}개` : '—'}</td>
                      <td>{pending ? <span className="chip wait">코드 시드 {pending.version}번 버전 대기</span> : '—'}</td>
                    </tr>
                  )
                })}
              </tbody>
            </Table>
          )
          : <p className="admin-empty">등록된 프롬프트가 없어요. AI 서비스가 시작될 때 모든 LLM 호출의 프롬프트를 버전 1로 등록해요.</p>)}
        <p className="admin-note">
          프롬프트의 정본은 Langfuse예요. 모델과 본문을 묶은 조합을 저장하고, 회귀 평가로 지표를 본 뒤 후보로 등록하면 서비스에 반영할 수 있어요(평가 세트가 있는 프롬프트는 평가를 통과해야 후보가 돼요).
          반영하면 AI 서비스가 재배포 없이 그 조합을 써요(캐시가 1분이라 잠시 뒤부터). 코드의 프롬프트(시드)가 바뀌면 AI 서비스가 코드 시드 버전으로 올려 둬요.
        </p>
      </section>
    )
  }
  return (
    <section className="panel admin-operations" aria-label="프롬프트 상세">
      <button type="button" className="btn sm" onClick={l.closePrompt}>프롬프트 목록으로</button>
      <LiveState vm={vm} label="프롬프트 버전 목록" state={l.prompt} forbidden={LLM_FORBIDDEN} />
      <ActionLines vm={vm} prefix={`prompt:${l.promptName}:`} />
      {p && (
        <>
          <h2 tabIndex={-1}>{p.name}</h2>
          <div className="admin-summary admin-prompt-live" role="group" aria-label="서비스 반영 중인 조합">
            <div><small>서비스 반영</small><b>{live ? `${live.version}번 버전` : '없음'}</b></div>
            <div><small>모델</small><b>{live ? modelLabel(live.model) : '—'}</b></div>
          </div>
          {seed && <p className="admin-note">코드 시드({seed.version}번 버전)가 서비스 반영 중인 본문과 달라요. 후보로 등록하면 반영할 수 있어요.</p>}
          {p.evaluationDataset && <p className="admin-note">후보 등록 조건: 평가 세트 {p.evaluationDataset}의 회귀 평가를 통과해야 해요(그 버전의 가장 최근 평가 기준).</p>}
          <Table label="프롬프트 버전 표">
            <thead>
              <tr>
                <th scope="col">버전</th>
                <th scope="col">상태</th>
                <th scope="col">모델</th>
                <th scope="col">등록</th>
                <th scope="col">회귀 평가</th>
                <th scope="col" className="act admin-nowrap">조치</th>
              </tr>
            </thead>
            <tbody>
              {[...p.versions].sort((a, b) => b.version - a.version).map((v) => {
                const action = versionAction(v), busy = !!vm.actions[`prompt:${p.name}:${v.version}`]?.pending, evaluation = v.evaluation
                const states = v.labels.map(labelText).filter((label): label is string => label !== null)
                return (
                  <Fragment key={v.version}>
                  <tr>
                    <td className="admin-num">{v.version}</td>
                    <td>{states.length ? states.map((label) => <span key={label} className={`chip ${label === '서비스 반영 중' ? 'ok' : ''}`}>{label}</span>) : '—'}</td>
                    <td>{modelLabel(v.model)}</td>
                    <td className="admin-date">{v.createdAt ? kstDateTime(v.createdAt) : '—'}</td>
                    <td>
                      {evaluation
                        ? (
                          <>
                            <span className={`chip ${passTone(evaluation.passed)}`}>{passedLabel(evaluation.passed)}</span>{' '}
                            <button type="button" className="btn sm" aria-label={`${p.name} ${v.version}번 버전 평가 결과 보기`} onClick={() => l.openEvaluation(evaluation.runId)}>결과 보기</button>
                          </>
                        )
                        : '평가 없음'}
                    </td>
                    <td className="admin-nowrap">
                      {action === 'live'
                        ? '반영 중'
                        : action === 'promote'
                          ? (
                            <button
                              type="button" className="btn sm pri" disabled={busy} aria-label={`${p.name} ${v.version}번 버전 서비스에 반영`}
                              onClick={(e) => {
                                if (!window.confirm(`${p.name} ${v.version}번 버전을 서비스에 반영할까요? AI 서비스가 곧 이 조합(${modelLabel(v.model)})을 쓰게 돼요.`)) return
                                // 반영되면 이 버튼이 '반영 중' 글자로 바뀌어 초점이 사라지므로 상세 제목으로 옮긴다.
                                const heading = e.currentTarget.closest('section')?.querySelector<HTMLElement>('h2')
                                void l.promote(p.name, v.version).then((ok) => { if (ok) heading?.focus() })
                              }}
                            >
                              서비스에 반영
                            </button>
                          )
                          : p.evaluationDataset && evaluation?.passed !== true
                            ? <span className="small muted">평가 통과 후 가능</span>   // 서버도 409로 막는다(#787). 행의 평가는 짝 세트의 최신 Run이다
                            : (
                            <button type="button" className="btn sm" disabled={busy} aria-label={`${p.name} ${v.version}번 버전 후보 등록`} onClick={() => void l.registerCandidate(p.name, v.version)}>
                              후보 등록
                            </button>
                          )}
                    </td>
                  </tr>
                  {/* 반영 전에 그 버전의 본문을 확인한다(#807). 펼친 본문은 표 전체 폭의 새 줄이라 좁은 화면에서 표를 넓히지 않는다. */}
                  {v.prompt != null && (
                    <tr className="admin-prompt-body">
                      <td colSpan={6}>
                        <details>
                          <summary>{v.version}번 버전 본문{v.commitMessage ? ` · ${v.commitMessage}` : ''}</summary>
                          <pre>{v.prompt}</pre>
                        </details>
                      </td>
                    </tr>
                  )}
                  </Fragment>
                )
              })}
            </tbody>
          </Table>
          <form
            onSubmit={async (e) => {
              e.preventDefault()
              const form = e.currentTarget
              if (await l.createPromptVersion(p.name, formText(form, 'prompt', false), formText(form, 'note'), formText(form, 'model'))) form.reset()
            }}
          >
            <h3>새 조합 만들기</h3>
            <p className="small muted">서비스에 반영 중인 모델과 본문으로 채워 뒀어요. 모델만 바꿔도 새 조합이 돼요.</p>
            <fieldset disabled={!!vm.actions[`prompt:${p.name}:new`]?.pending} className="form-grid">
              <label className="field">
                모델
                {/* 반영 중인 모델은 목록이 오기 전에도 선택지에 있어 기본값이 잡힌다. key는 프롬프트·반영 버전만이라 목록이 늦게 와도 고른 값이 남는다. */}
                <select
                  className="inp" name="model" key={`${p.name}:${live?.version}`} defaultValue={live?.model ?? ''} disabled={fixedModel(p.name)}
                  aria-describedby={fixedModel(p.name) ? 'prompt-model-fixed' : undefined}
                >
                  <option value="">{modelLabel(null)}</option>
                  {modelNames.map((name) => <option key={name} value={name}>{name}</option>)}
                </select>
              </label>
              {fixedModel(p.name) && <p id="prompt-model-fixed" className="small muted wide">Decisions API가 gpt-6-luna만 지원해 모델은 고정이에요. 프롬프트만 바꿀 수 있어요.</p>}
              <label className="field wide">프롬프트 본문<textarea className="ta" name="prompt" rows={10} required defaultValue={live?.prompt ?? ''} key={`${p.name}:${live?.version}`} /></label>
              <label className="field wide">변경 메모(선택)<input className="inp" name="note" /></label>
              <div className="rowend wide"><button type="submit" className="btn pri">{vm.actions[`prompt:${p.name}:new`]?.pending ? '저장 중…' : '조합 저장'}</button></div>
            </fieldset>
          </form>
          {isOptimizable(p.name) && <OptimizeForm vm={vm} l={l} name={p.name} versions={p.versions.map((v) => v.version).sort((a, b) => b - a)} base={live?.version} />}
        </>
      )}
    </section>
  )
}

/**
 * 자동 개선(GEPA, #823): 기준 버전과 평가 호출 상한을 정해 요청합니다. AI가 새 버전(라벨 없음)을 저장하고 게이트 세트 회귀 평가까지 돌리며(수십 분),
 * 후보 등록·서비스 반영은 사람이 위 버전 표에서 합니다. 비용이 드는 요청이라 예상 OpenAI 호출 수(어림)를 보이고 한 번 더 확인합니다.
 */
function OptimizeForm({ vm, l, name, versions, base }: { vm: VM; l: LlmVM; name: string; versions: number[]; base?: number }) {
  const [calls, setCalls] = useState(String(OPTIMIZATION_DEFAULT_CALLS))
  const busy = !!vm.actions[`prompt:${name}:optimize`]?.pending, budget = Number(calls), valid = Number.isInteger(budget) && budget >= 1 && budget <= OPTIMIZATION_MAX_CALLS
  const estimate = valid ? `약 ${estimatedCalls(name, budget).toLocaleString('ko-KR')}회` : '—'
  return (
    <form
      aria-label="프롬프트 자동 개선"
      onSubmit={(e) => {
        e.preventDefault()
        const version = formNumber(e.currentTarget, 'baseVersion')
        // 값이 어긋나면 확인 없이 보내 사용 사례가 어긋난 이유를 알린다.
        if (!valid || window.confirm(`${name} ${version}번 버전을 기준으로 자동 개선을 시작할까요? 예상 OpenAI 호출은 ${estimate}이고 수십 분 걸려요.`)) void l.optimize(name, version, budget)
      }}
    >
      <h3>자동 개선(GEPA)</h3>
      <p className="small muted">기준 버전을 반성 모델이 고쳐 쓰고 최적화 풀의 val 점수가 가장 높은 지시문을 새 버전(라벨 없음)으로 저장한 뒤 게이트 세트 회귀 평가까지 돌려요. 후보 등록·서비스 반영은 위 표에서 사람이 해요.</p>
      <fieldset disabled={busy} className="form-grid">
        <label className="field">
          자동 개선 기준 버전
          <select className="inp" name="baseVersion" key={`${name}:${base}`} defaultValue={base ?? versions[0]}>
            {versions.map((v) => <option key={v} value={v}>{v}번 버전</option>)}
          </select>
        </label>
        <label className="field">
          평가 호출 상한
          <input className="inp" name="maxMetricCalls" type="number" min={1} max={OPTIMIZATION_MAX_CALLS} step={1} value={calls} onChange={(e) => setCalls(e.target.value)} required />
        </label>
        <p className="small muted wide" aria-live="polite">
          예상 OpenAI 호출 {estimate}(2 × 상한 + 2 × 게이트 세트 문항 수, 기준 평가가 없으면 더 들어요). 같은 프롬프트는 한 번에 하나만 돌아요.
        </p>
        <div className="rowend wide"><button type="submit" className="btn pri">{busy ? '요청 중…' : '자동 개선 실행'}</button></div>
      </fieldset>
    </form>
  )
}

export function Models({ vm, l }: Props) {
  const rows = l.models.data, busy = !!vm.actions['model:new']?.pending
  return (
    <section className="panel admin-operations" aria-label="모델 단가">
      <LiveState vm={vm} label="모델 목록" state={l.models} forbidden={LLM_FORBIDDEN} />
      {rows && (rows.length
        ? (
          <>
            <p className="small muted">단가는 100만 토큰당 USD예요.</p>
            <Table label="모델 단가 표">
              <thead>
                <tr>
                  <th scope="col">모델</th>
                  <th scope="col">매칭 패턴</th>
                  <th scope="col">입력 단가</th>
                  <th scope="col">출력 단가</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id}>
                    <td className="admin-nowrap"><b>{row.modelName}</b></td>
                    <td className="muted">{row.matchPattern}</td>
                    <td>{perMillion(row.inputPrice)}</td>
                    <td>{perMillion(row.outputPrice)}</td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </>
        )
        : <p className="admin-empty">등록된 모델이 없어요.</p>)}
      <form
        hidden={rows === null}
        onSubmit={async (e) => {
          e.preventDefault()
          const form = e.currentTarget
          if (await l.createModel({ modelName: formText(form, 'modelName'), matchPattern: formText(form, 'matchPattern'), inputPerMillion: formNumber(form, 'inputPerMillion'), outputPerMillion: formNumber(form, 'outputPerMillion') })) form.reset()
        }}
      >
        <h3>모델 등록</h3>
        <fieldset disabled={busy} className="form-grid">
          <label className="field">모델 이름<input className="inp" name="modelName" required /></label>
          <label className="field">매칭 패턴(정규식)<input className="inp" name="matchPattern" placeholder="예: (?i)^gpt-x$" required /></label>
          <label className="field">입력 단가(100만 토큰당 USD)<input className="inp" name="inputPerMillion" type="number" min="0" step="any" required /></label>
          <label className="field">출력 단가(100만 토큰당 USD)<input className="inp" name="outputPerMillion" type="number" min="0" step="any" required /></label>
          <div className="rowend wide"><button type="submit" className="btn pri">{busy ? '등록 중…' : '모델 등록'}</button></div>
        </fieldset>
        <ActionLines vm={vm} prefix="model:" />
      </form>
      <p className="admin-note">모델 단가는 Langfuse가 AI 요청 비용을 계산하는 기준이에요.</p>
    </section>
  )
}

const evaluationChip = (e: Evaluation) => <span className={`chip ${e.status === 'failed' ? 'bad' : passTone(e.passed)}`}>{e.status === 'completed' ? passedLabel(e.passed) : evaluationStatusLabel(e.status)}</span>

/** 문항별 결과(실패 로그, #823): 서버가 실패 먼저로 줍니다. 문항 본문은 오지 않아 문항 id·지표 점수·결과·이유만 보입니다. */
function EvaluationItems({ items }: { items: EvaluationItem[] }) {
  const names = [...new Set(items.flatMap((item) => Object.keys(item.scores)))], failed = items.filter((item) => item.failed).length
  return (
    <>
      <h3>문항별 결과</h3>
      <p className="small muted" role="status">실패 {failed}문항 / 전체 {items.length}문항 (실패: 항목 오류 · 시점 위반 · 지표 하나라도 0.5 미만)</p>
      <Table label="문항별 결과 표">
        <thead>
          <tr>
            <th scope="col">문항</th>
            {names.map((name) => <th key={name} scope="col">{name}</th>)}
            <th scope="col">결과</th>
            <th scope="col">이유</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr key={item.itemId}>
              <td>{item.itemId}</td>
              {names.map((name) => <td key={name} className="admin-num">{item.scores[name] == null ? '—' : item.scores[name].toFixed(2)}</td>)}
              <td><span className={`chip ${item.failed ? 'bad' : itemWaiting(item) ? 'wait' : ''}`}>{item.failed ? '실패' : itemWaiting(item) ? '진행 중' : '통과'}</span></td>
              <td>{itemReason(item) ?? '—'}</td>
            </tr>
          ))}
        </tbody>
      </Table>
    </>
  )
}

/**
 * 에이전트별 평가 표(#837): 에이전트마다 쓰는 평가 모드·세트·지표와 회귀 평가 세트의 최근 Run을 한눈에 봅니다. 목록은 도메인 상수(llmOpsEvalTable)이고
 * 최근 Run은 아래 회귀 평가와 같은 평가 목록(최근 50건)에서 세트 이름으로 찾습니다. 세트가 없는 에이전트도 숨기지 않으며
 * 원문 검색은 모델 없이 CI에서 확인하는 평가라 실행 버튼이 없습니다.
 */
export function AgentEvaluations({ l }: Pick<Props, 'l'>) {
  const rows = l.evaluations.data
  return (
    <section className="panel admin-operations" aria-label="에이전트별 평가">
      <h2>에이전트별 평가</h2>
      <Table label="에이전트별 평가 표">
        <thead>
          <tr>
            <th scope="col">에이전트</th>
            <th scope="col">평가 모드</th>
            <th scope="col">평가 세트(항목 수)</th>
            <th scope="col">지표</th>
            <th scope="col">최근 결과</th>
          </tr>
        </thead>
        <tbody>
          {AGENT_EVALUATIONS.map((row) => {
            const latest = row.dataset && rows ? latestRun(row.dataset, rows) : undefined
            return (
              <tr key={`${row.agent}|${row.feature}`}>
                <td>{row.agent}<div className="small muted">{row.feature}</div></td>
                <td>{row.mode}</td>
                <td>{row.set}</td>
                <td>{row.metrics}</td>
                <td>
                  {!row.dataset ? row.result : !rows ? '—' : !latest ? '실행한 평가 없음' : (
                    <>
                      {evaluationChip(latest)} <span className="small muted">{latest.prompt} {latest.version}번 버전 · {kstDateTime(latest.createdAt)}</span>{' '}
                      <button type="button" className="btn sm" aria-label={`「${latest.dataset} 최근 평가 ${latest.runId}」 Run 상세`} onClick={() => l.openEvaluation(latest.runId)}>Run 상세</button>
                    </>
                  )}
                </td>
              </tr>
            )
          })}
        </tbody>
      </Table>
      <p className="admin-note">새 답변 생성은 아래 회귀 평가로 실행하고, 원문 검색은 고정 원문의 검색 순위만 채점하는 CI 평가라 실행 버튼이 없어요(수치는 docs/evaluation/retrieval.md). 최근 Run은 회귀 평가 목록(최근 50건) 안에서 찾아요.</p>
    </section>
  )
}

export function Evaluations({ vm, l }: Props) {
  const rows = l.evaluations.data, e = l.evaluation.data, busy = !!vm.actions['eval:new']?.pending
  if (l.runId) {
    return (
      <section className="panel admin-operations" aria-label="평가 상세">
        <button type="button" className="btn sm" onClick={l.closeEvaluation}>평가 목록으로</button>
        <LiveState vm={vm} label="평가 지표 목록" state={l.evaluation} forbidden={LLM_FORBIDDEN} />
        {e && (
          <>
            <h2 tabIndex={-1}>{e.dataset} · {e.prompt} {e.version}번 버전</h2>
            <p>{evaluationChip(e)} <span className="small muted">{kstDateTime(e.createdAt)} · 실행 {e.runId}</span></p>
            {e.metrics.length > 0 && <EvaluationChart metrics={e.metrics} />}
            {e.metrics.length
              ? (
                <Table label="평가 지표 표">
                  <thead>
                    <tr>
                      <th scope="col">지표</th>
                      <th scope="col">점수</th>
                      <th scope="col">기준 버전</th>
                      <th scope="col">차이</th>
                    </tr>
                  </thead>
                  <tbody>
                    {e.metrics.map((m) => (
                      <tr key={m.name}>
                        <td>{m.name}</td>
                        <td>{m.score.toFixed(3)}</td>
                        <td>{m.baseline == null ? '—' : m.baseline.toFixed(3)}</td>
                        <td>{m.delta == null ? '—' : (m.delta > 0 ? '+' : '') + m.delta.toFixed(3)}</td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              )
              : <p className="admin-empty">아직 지표가 없어요. 실행이 끝나면 채워져요.</p>}
            {e.items && (e.items.length ? <EvaluationItems items={e.items} /> : <p className="admin-empty">끝난 문항이 아직 없어요.</p>)}
          </>
        )}
      </section>
    )
  }
  return (
    <section className="panel admin-operations" aria-label="회귀 평가">
      <h2>회귀 평가</h2>
      <LiveState vm={vm} label="평가 목록" state={l.evaluations} forbidden={LLM_FORBIDDEN} />
      {rows && (rows.length
        ? (
          <Table label="회귀 평가 표">
            <thead>
              <tr>
                <th scope="col">데이터셋</th>
                <th scope="col">프롬프트</th>
                <th scope="col">상태·결과</th>
                <th scope="col">실행 시각</th>
                <th scope="col" className="act act-menu"><span className="sr-only">상세</span></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.runId}>
                  <td>{row.dataset}</td>
                  <td>{row.prompt} {row.version}번 버전</td>
                  <td>{evaluationChip(row)}</td>
                  <td className="admin-date">{kstDateTime(row.createdAt)}</td>
                  <td className="act-menu" data-record-id={row.runId}>
                    <PopMenu className="row-menu" label={`「${row.dataset} ${row.prompt} ${row.version}번 버전 평가」 조치`} icon={<MoreVerticalIcon />}>
                      <button type="button" role="menuitem" onClick={() => l.openEvaluation(row.runId)}>상세</button>
                    </PopMenu>
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        )
        : <p className="admin-empty">아직 실행한 평가가 없어요.</p>)}
      <form
        hidden={rows === null}
        onSubmit={async (event) => {
          event.preventDefault()
          const form = event.currentTarget
          if (await l.runEvaluation(formText(form, 'dataset'), formText(form, 'prompt'), formNumber(form, 'version'))) form.reset()
        }}
      >
        <h3>회귀 평가 실행</h3>
        <fieldset disabled={busy} className="form-grid admin-eval-grid">
          <label className="field">데이터셋<input className="inp" name="dataset" list="eval-datasets" autoComplete="off" placeholder="예: simulation.narrate" required /></label>
          <label className="field">프롬프트 이름<input className="inp" name="prompt" list="eval-prompts" autoComplete="off" placeholder="예: character_simulation.narrate" required /></label>
          <label className="field">버전<input className="inp" name="version" type="number" min="1" step="1" placeholder="예: 2" required /></label>
          <div className="rowend wide"><button type="submit" className="btn pri">{busy ? '요청 중…' : '평가 실행'}</button></div>
        </fieldset>
        {/* 이전에 돌린 데이터셋·프롬프트 이름을 고를 수 있게 한다(자유 입력은 그대로). */}
        <datalist id="eval-datasets">{[...new Set(rows?.map((r) => r.dataset))].map((v) => <option key={v} value={v} />)}</datalist>
        <datalist id="eval-prompts">{[...new Set(rows?.map((r) => r.prompt))].map((v) => <option key={v} value={v} />)}</datalist>
        <ActionLines vm={vm} prefix="eval:" />
      </form>
      <p className="admin-note">평가는 직접 실행하거나 켜 둔 일정으로만 돌아요. 1회 비용 상한은 아직 정하지 않아 상한 없이 실행돼요.</p>
    </section>
  )
}

/** 경고 쪽의 경고 기준: 규칙마다 기준값·기준 시간·켜기를 저장합니다. */
export function AlertRules({ vm, l }: Props) {
  const rules = l.rules.data
  return (
    <section className="panel admin-operations" aria-label="경고 기준">
      <LiveState vm={vm} label="경고 기준" state={l.rules} forbidden={LLM_FORBIDDEN} />
      {rules && (
        <>
          <h2>경고 기준</h2>
          <ActionLines vm={vm} prefix="rule:" target={(key) => alertRuleLabel(key.split(':')[1])} />
          <Table label="경고 기준 표">
            <thead>
              <tr>
                <th scope="col">규칙</th>
                <th scope="col">기준값</th>
                <th scope="col">기준 시간(분)</th>
                <th scope="col">켜기</th>
                <th scope="col">마지막 변경</th>
                <th scope="col" className="act"><span className="sr-only">저장</span></th>
              </tr>
            </thead>
            <tbody>{rules.map((rule) => <RuleRow key={rule.key} rule={rule} l={l} busy={!!vm.actions[`rule:${rule.key}`]?.pending} />)}</tbody>
          </Table>
        </>
      )}
      <p className="admin-note">처음엔 모두 꺼져 있고, 값을 넣고 켜야 경고가 만들어져요. 비율 기준은 0~1(0.1 = 10%)이에요.</p>
    </section>
  )
}

/** 정보 누설 검사 패널 아래의 표본 비율(0~1) 한 줄. 패널을 따로 두지 않고 검사 기록 바로 아래에 붙인다. */
export function LeakSampleRate({ vm, l }: Props) {
  const s = l.settings.data, busy = !!vm.actions['setting:leak']?.pending
  return (
    <section className="admin-leak-rate" aria-label="누설 검사 표본 비율">
      <h3>표본 비율</h3>
      <LiveState vm={vm} label="누설 검사 표본 비율" state={l.settings} forbidden={LLM_FORBIDDEN} />
      {s && (
        <form
          onSubmit={async (e) => {
            e.preventDefault()
            await l.updateSettings(formNumber(e.currentTarget, 'leakSampleRate'))
          }}
        >
          <fieldset disabled={busy} className="admin-filter">
            <label className="field">
              표본 비율(0~1)
              <input className="inp" name="leakSampleRate" type="number" min="0" max="1" step="any" required defaultValue={s.leakSampleRate} key={s.leakSampleRate} aria-describedby="leak-rate-hint" />
            </label>
            <button type="submit" className="btn">{busy ? '저장 중…' : '표본 비율 저장'}</button>
          </fieldset>
          <p id="leak-rate-hint" className="small muted">0.1이면 Fork 작품 요청 10개 중 1개꼴로 검사해요.</p>
          <ActionLines vm={vm} prefix="setting:" />
        </form>
      )}
    </section>
  )
}

function RuleRow({ rule, l, busy }: { rule: AlertRule; l: LlmVM; busy: boolean }) {
  const [threshold, setThreshold] = useState(rule.threshold == null ? '' : String(rule.threshold))
  const [windowMinutes, setWindowMinutes] = useState(String(rule.windowMinutes))
  const [enabled, setEnabled] = useState(rule.enabled)
  const label = alertRuleLabel(rule.key)
  // 저장 버튼이 보낼 값. 저장된 값과 다르면 아직 저장하지 않은 변경이라 '저장 안 됨'을 보인다(저장 없이 쪽을 떠나면 변경이 사라지고 경고는 켜지지 않는다).
  const next = { threshold: threshold.trim() === '' ? null : Number(threshold), windowMinutes: windowMinutes.trim() === '' ? Number.NaN : Number(windowMinutes), enabled }
  const unsaved = next.threshold !== (rule.threshold ?? null) || next.windowMinutes !== rule.windowMinutes || next.enabled !== rule.enabled
  return (
    <tr>
      <td>{label}<div className="small muted">{rule.metric}</div></td>
      <td><input className="inp" type="number" min="0" step="any" aria-label={`${label} 기준값`} value={threshold} onChange={(e) => setThreshold(e.target.value)} /></td>
      <td><input className="inp" type="number" min="1" step="1" aria-label={`${label} 기준 시간(분)`} value={windowMinutes} onChange={(e) => setWindowMinutes(e.target.value)} /></td>
      <td><input type="checkbox" aria-label={`${label} 켜기`} checked={enabled} onChange={(e) => setEnabled(e.target.checked)} /></td>
      <td className="admin-date">{kstDateTime(rule.updatedAt)}</td>
      <td>
        <div className="admin-inline">
          <button
            type="button"
            className="btn sm"
            aria-label={`${label} 기준 저장`}
            disabled={busy}
            onClick={() => void l.updateRule(rule.key, next)}
          >
            저장
          </button>
          {unsaved && <span className="small muted">저장 안 됨</span>}
        </div>
      </td>
    </tr>
  )
}

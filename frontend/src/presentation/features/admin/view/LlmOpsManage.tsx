import { useState } from 'react'

import { LLM_FORBIDDEN, evaluationStatusLabel, passedLabel, perMillion, promoteLabel, type Evaluation } from '../../../../domain/entities/llmOps'
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

/** 프롬프트·모델·평가·경고 기준·표본 비율 패널. 변경 조치(새 버전·승격·모델 등록·평가 실행·기준 저장)는 모두 활동 로그에 남습니다. */
export function Prompts({ vm, l }: Props) {
  const rows = l.prompts.data, p = l.prompt.data
  if (!l.promptName) {
    return (
      <section className="panel admin-operations" aria-label="프롬프트">
        <LiveState vm={vm} label="프롬프트 목록" state={l.prompts} forbidden={LLM_FORBIDDEN} />
        {rows && (rows.length
          ? (
            <ul className="admin-record-list">
              {rows.map((row) => (
                <li key={row.name}>
                  <button type="button" className="admin-record-link" data-record-id={row.name} onClick={() => l.openPrompt(row.name)}>
                    <b>{row.name}</b>
                    <span className="small muted">버전·평가 결과·production 라벨 보기</span>
                  </button>
                </li>
              ))}
            </ul>
          )
          : <p className="admin-empty">등록된 프롬프트가 없어요. AI 서비스가 시작될 때 코드의 프롬프트가 버전 1로 등록돼요.</p>)}
        <p className="admin-note">프롬프트의 정본은 Langfuse예요. 새 버전은 라벨 없이 등록되고, production으로 올리려면 그 버전의 최신 회귀 평가가 통과여야 해요.</p>
      </section>
    )
  }
  return (
    <section className="panel admin-operations" aria-label="프롬프트 상세">
      <button type="button" className="btn sm" onClick={l.closePrompt}>프롬프트 목록으로</button>
      <LiveState vm={vm} label="프롬프트 버전 목록" state={l.prompt} forbidden={LLM_FORBIDDEN} />
      <ActionLines vm={vm} prefix="prompt:" />
      {p && (
        <>
          <h2 tabIndex={-1}>{p.name}</h2>
          <Table label="프롬프트 버전 표">
            <thead>
              <tr>
                <th scope="col">버전</th>
                <th scope="col">라벨</th>
                <th scope="col">등록</th>
                <th scope="col">최신 회귀 평가</th>
                <th scope="col" className="act act-menu"><span className="sr-only">production</span></th>
              </tr>
            </thead>
            <tbody>
              {[...p.versions].sort((a, b) => b.version - a.version).map((v) => {
                const action = promoteLabel(p.versions, v), busy = !!vm.actions[`prompt:${p.name}:${v.version}`]?.pending, evaluation = v.evaluation
                return (
                  <tr key={v.version}>
                    <td>{v.version}</td>
                    <td>{v.labels.length ? v.labels.map((label) => <span key={label} className="chip ok">{label}</span>) : '—'}</td>
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
                    <td className="act-menu">
                      {action
                        ? (
                          <PopMenu className="row-menu" label={`「${p.name} ${v.version}번 버전」 조치`} icon={<MoreVerticalIcon />}>
                            <button
                              type="button"
                              role="menuitem"
                              disabled={busy}
                              onClick={() => { if (window.confirm(`${p.name} ${v.version}번 버전을 production으로 ${action === '복원' ? '되돌릴까요' : '올릴까요'}? 서비스가 바로 이 버전의 프롬프트를 쓰게 돼요.`)) void l.promote(p.name, v.version) }}
                            >
                              production {action}
                            </button>
                          </PopMenu>
                        )
                        : '—'}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </Table>
          <form
            onSubmit={async (e) => {
              e.preventDefault()
              const form = e.currentTarget
              if (await l.createPromptVersion(p.name, formText(form, 'prompt', false), formText(form, 'note'))) form.reset()
            }}
          >
            <h3>새 버전 등록</h3>
            <fieldset disabled={!!vm.actions[`prompt:${p.name}:new`]?.pending} className="form-grid">
              <label className="field wide">새 버전 본문<textarea className="ta" name="prompt" rows={8} required /></label>
              <label className="field wide">변경 메모(선택)<input className="inp" name="note" /></label>
              <div className="rowend wide"><button type="submit" className="btn pri">{vm.actions[`prompt:${p.name}:new`]?.pending ? '등록 중…' : '새 버전 등록'}</button></div>
            </fieldset>
          </form>
        </>
      )}
    </section>
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

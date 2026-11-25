import { Fragment } from 'react'

import {
  LLM_FORBIDDEN, LOOP_STAGES, OPTIMIZATION_UNSUPPORTED_MESSAGE, defaultModelOf, fixedModel, isOptimizable, labelText, modelLabel, passTone, passedLabel, pendingSeed, productionOf, recentDefaultModel, versionAction, type Prompt, type RecentModel,
} from '../../../../domain/entities/llmOps'
import { pairSets, setItems } from '../../../../domain/entities/llmOpsEvalTable'
import { promptLabel } from '../../../../domain/entities/promptNames'
import { kstDateTime } from '../../../shared/format'
import type { LlmVM, VM } from './LlmOps'
import { Evaluations, OptimizeForm } from './LlmOpsManage'
import { ModelLabel } from './ModelLabel'
import { formText } from './formValue'
import { ActionLines, LiveState, Table } from './OperationsPanels'
import { DatasetPanel } from './PromptDatasets'
import { PromptName } from './PromptName'

type Props = { vm: VM; l: LlmVM }
type StageProps = Props & { p: Prompt; recent: RecentModel | null }

/** 단계 번호 ①~⑥(보이는 표시일 뿐이라 읽는 이름에는 넣지 않고, 순서는 목록이 알립니다). */
const mark = (index: number) => String.fromCodePoint(0x2460 + index)

/**
 * 프롬프트 상세 = 프롬프트 개선 루프(#857): 위쪽 단계 표시(① 프롬프트 ─ ② 평가 세트 ─ ③ 평가 ─ ④ 자동 개선 ─ ⑤ 게이트 ─ ⑥ 서비스 반영)에서 단계를 고르면 아래 패널이 바뀝니다.
 * 패널은 기존 패널(버전 표·새 조합 폼·회귀 평가·자동 개선·후보 등록·서비스 반영)을 단계별로 옮긴 것입니다. 단계는 화면 상태라 주소에 두지 않고, 프롬프트를 열거나 닫으면 ①로 돌아갑니다.
 * 제목은 한국어 표시 이름과 작은 코드이고(PromptName), 모델을 고르지 않은 버전의 모델 칸은 서버가 알려 준 실제 기본 모델 '기본 모델 · gpt-…'(#868), 못 알려 줬으면 파이프라인 기록에서 찾은 '기본 모델 · 최근 사용 …'(근거 없으면 '기본 모델(환경 설정)', #857)입니다.
 */
export function PromptDetail({ vm, l }: Props) {
  const p = l.prompt.data, live = p && productionOf(p)
  const recent = p && l.recent.data ? recentDefaultModel(p, l.recent.data) : null
  const at = LOOP_STAGES.findIndex(([key]) => key === l.stage)
  return (
    <section className="panel admin-operations" aria-label="프롬프트 상세">
      <button type="button" className="btn sm" onClick={l.closePrompt}>프롬프트 목록으로</button>
      <LiveState vm={vm} label="프롬프트 버전 목록" state={l.prompt} forbidden={LLM_FORBIDDEN} />
      <ActionLines vm={vm} prefix={`prompt:${l.promptName}:`} />
      {p && (
        <>
          <h2 tabIndex={-1}><PromptName code={p.name} /></h2>
          <div className="admin-summary admin-prompt-live" role="group" aria-label="서비스 반영 중인 조합">
            <div><small>서비스 반영</small><b>{live ? `${live.version}번 버전` : '없음'}</b></div>
            <div><small>모델</small><b>{live ? <ModelLabel model={live.model} effective={live.effectiveModel} recent={recent} basis /> : '—'}</b></div>
          </div>
          <nav className="loop-steps" aria-label="프롬프트 개선 루프 단계">
            <ol>
              {LOOP_STAGES.map(([key, label], index) => (
                <li key={key}>
                  <button type="button" aria-current={key === l.stage ? 'step' : undefined} onClick={() => l.setStage(key)}>
                    <span aria-hidden="true">{mark(index)}</span>{label}
                  </button>
                </li>
              ))}
            </ol>
          </nav>
          {/* ① 프롬프트는 다른 단계를 보는 동안 닫아 둘 뿐 지우지 않는다: 새 조합 만들기에 쓰던 본문·모델·메모가 단계를 오가도 남는다. */}
          <div role="group" aria-label="1단계 프롬프트" hidden={l.stage !== 'prompt'}>
            <PromptStage vm={vm} l={l} p={p} recent={recent} />
          </div>
          {l.stage !== 'prompt' && (
            <div role="group" aria-label={`${at + 1}단계 ${LOOP_STAGES[at][1]}`}>
              {l.stage === 'set' && <SetStage vm={vm} l={l} p={p} />}
              {l.stage === 'eval' && <Evaluations vm={vm} l={l} p={p} />}
              {l.stage === 'optimize' && (isOptimizable(p.name)
                ? <OptimizeForm vm={vm} l={l} name={p.name} versions={p.versions.map((v) => v.version).sort((a, b) => b - a)} base={live?.version} />
                : <p className="admin-empty">{OPTIMIZATION_UNSUPPORTED_MESSAGE} 자동 개선은 인물 시뮬레이션 대사·나레이션 프롬프트(character_simulation.act·narrate)만 지원해요.</p>)}
              {l.stage === 'gate' && (
                <>
                  <p className="admin-note">
                    {p.evaluationDataset
                      ? `후보 등록 조건: 평가 세트 ${p.evaluationDataset}의 회귀 평가를 통과해야 해요(그 버전의 가장 최근 평가 기준).`
                      : '이 프롬프트는 짝 평가 세트가 없어 평가 없이 후보로 등록할 수 있어요.'}
                  </p>
                  <VersionsTable vm={vm} l={l} p={p} recent={recent} stage="gate" />
                </>
              )}
              {l.stage === 'serve' && (
                <>
                  <p className="admin-note">
                    서비스에는 후보로 등록한 버전만 반영할 수 있어요. 이전 버전으로 되돌릴 때도 후보로 등록한 뒤 같은 버튼을 써요.
                    반영하면 AI 서비스가 재배포 없이 그 조합을 써요(캐시가 1분이라 잠시 뒤부터). 코드의 프롬프트(시드)가 바뀌면 AI 서비스가 코드 시드 버전으로 올려 둬요.
                  </p>
                  <VersionsTable vm={vm} l={l} p={p} recent={recent} stage="serve" />
                </>
              )}
            </div>
          )}
        </>
      )}
    </section>
  )
}

/** ① 프롬프트: 버전 목록·본문과 새 조합 만들기. */
function PromptStage({ vm, l, p, recent }: StageProps) {
  const live = productionOf(p), seed = pendingSeed(p)
  // 고를 수 있는 모델은 운영 설정의 목록(AI가 부르는 OpenAI 모델, #806)이고, 반영 중인 모델은 목록에 없어도 그대로 남긴다.
  const modelNames = [...new Set([...(live?.model ? [live.model] : []), ...(p.models ?? [])])]
  const busy = !!vm.actions[`prompt:${p.name}:new`]?.pending
  return (
    <>
      {seed && <p className="admin-note">코드 시드({seed.version}번 버전)가 서비스 반영 중인 본문과 달라요. 후보로 등록하면 반영할 수 있어요.</p>}
      <VersionsTable vm={vm} l={l} p={p} recent={recent} stage="prompt" />
      <form
        onSubmit={async (e) => {
          e.preventDefault()
          const form = e.currentTarget
          if (await l.createPromptVersion(p.name, formText(form, 'prompt', false), formText(form, 'note'), formText(form, 'model'))) form.reset()
        }}
      >
        <h3>새 조합 만들기</h3>
        <p className="small muted">서비스에 반영 중인 모델과 본문으로 채워 뒀어요. 모델만 바꿔도 새 조합이 돼요.</p>
        <fieldset disabled={busy} className="form-grid">
          <label className="field">
            모델
            {/* 반영 중인 모델은 목록이 오기 전에도 선택지에 있어 기본값이 잡힌다. key는 프롬프트·반영 버전만이라 목록이 늦게 와도 고른 값이 남는다. */}
            <select
              className="inp" name="model" key={`${p.name}:${live?.version}`} defaultValue={live?.model ?? ''} disabled={fixedModel(p.name)}
              aria-describedby={fixedModel(p.name) ? 'prompt-model-fixed' : undefined}
            >
              <option value="">{modelLabel(null, recent, defaultModelOf(p))}</option>
              {modelNames.map((name) => <option key={name} value={name}>{name}</option>)}
            </select>
          </label>
          {fixedModel(p.name) && <p id="prompt-model-fixed" className="small muted wide">Decisions API가 gpt-6-luna만 지원해 모델은 고정이에요. 프롬프트만 바꿀 수 있어요.</p>}
          <label className="field wide">프롬프트 본문<textarea className="ta" name="prompt" rows={10} required defaultValue={live?.prompt ?? ''} key={`${p.name}:${live?.version}`} /></label>
          <label className="field wide">변경 메모(선택)<input className="inp" name="note" /></label>
          <div className="rowend wide"><button type="submit" className="btn pri">{busy ? '저장 중…' : '조합 저장'}</button></div>
        </fieldset>
      </form>
    </>
  )
}

/** ② 평가 세트: 이 프롬프트의 짝 세트 이름·문항 수와 평가 데이터셋 목록·JSONL 업로드(#857, 서버 API 예정). 지금 실제 세트는 저장소 파일을 seed 명령으로 등록하는 방식뿐입니다. */
function SetStage({ vm, l, p }: Props & { p: Prompt }) {
  const sets = pairSets(p.name)
  return (
    <>
      {sets.length
        ? sets.map((row) => {
          const items = setItems(row)
          return (
            <dl key={row.dataset} className="ai" aria-label={`평가 세트 ${row.dataset}`}>
              <dt>평가 세트</dt><dd>{row.dataset}</dd>
              <dt>문항 수</dt><dd>{items === undefined ? '—' : `${items}문항`}</dd>
              <dt>지표</dt><dd>{row.metrics}</dd>
              <dt>게이트</dt><dd>{p.evaluationDataset === row.dataset ? '후보로 등록하려면 이 세트의 회귀 평가를 통과해야 해요.' : '후보 등록 조건은 아니에요.'}</dd>
            </dl>
          )
        })
        : <p className="admin-empty">이 프롬프트는 짝 평가 세트가 없어요(평가 세트 없음). 평가 없이 후보로 등록하고 서비스에 반영할 수 있어요. 범용 세트(leak.spoiler·world.conflict·writing.fix)는 평가 단계에서 데이터셋 이름을 골라 돌려 볼 수 있어요.</p>}
      <DatasetPanel vm={vm} l={l} />
      <p className="admin-note">
        평가 세트는 저장소 파일(backend/ai-service/app/evaluation/datasets/, 파일 이름이 세트 이름)을 python -m app.evaluation.seed 명령으로 Langfuse Dataset에 등록해 만들어요.
        위의 목록과 JSONL 업로드는 운영 서버 API로 그 Dataset을 읽고, 있는 세트에 문항을 더해요. 저작권이 있는 원문(해리 포터·웹소설)은 저장소와 Langfuse에 올리지 않고 로컬 평가에서만 써요.
      </p>
    </>
  )
}

const VERSION_TABLES = {
  prompt: { label: '프롬프트 버전 표', columns: ['버전', '상태', '모델', '등록'] },
  gate: { label: '평가 게이트 버전 표', columns: ['버전', '상태', '회귀 평가', '조치'] },
  serve: { label: '서비스 반영 버전 표', columns: ['버전', '상태', '모델', '조치'] },
} as const

/** 같은 버전 목록을 단계별 열로 보입니다: ① 모델·등록 시각·본문, ⑤ 회귀 평가·후보 등록, ⑥ 모델·서비스 반영. */
function VersionsTable({ vm, l, p, recent, stage }: StageProps & { stage: keyof typeof VERSION_TABLES }) {
  const { label, columns } = VERSION_TABLES[stage]
  return (
    <Table label={label}>
      <thead>
        <tr>{columns.map((name) => <th key={name} scope="col" className={name === '조치' ? 'act admin-nowrap' : undefined}>{name}</th>)}</tr>
      </thead>
      <tbody>
        {[...p.versions].sort((a, b) => b.version - a.version).map((v) => {
          const action = versionAction(v), busy = !!vm.actions[`prompt:${p.name}:${v.version}`]?.pending, evaluation = v.evaluation
          const states = v.labels.map(labelText).filter((text): text is string => text !== null)
          return (
            <Fragment key={v.version}>
              <tr>
                <td className="admin-num">{v.version}</td>
                <td>{states.length ? states.map((text) => <span key={text} className={`chip ${text === '서비스 반영 중' ? 'ok' : ''}`}>{text}</span>) : '—'}</td>
                {stage !== 'gate' && <td><ModelLabel model={v.model} effective={v.effectiveModel} recent={recent} /></td>}
                {stage === 'prompt' && <td className="admin-date">{v.createdAt ? kstDateTime(v.createdAt) : '—'}</td>}
                {stage === 'gate' && (
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
                )}
                {stage === 'gate' && (
                  <td className="admin-nowrap">
                    {action === 'live'
                      ? '반영 중'
                      : action === 'promote'
                        ? '후보 등록됨'
                        : p.evaluationDataset && evaluation?.passed !== true
                          ? <span className="small muted">평가 통과 후 가능</span>   // 서버도 409로 막는다(#787). 행의 평가는 짝 세트의 최신 Run이다
                          : <button type="button" className="btn sm" disabled={busy} aria-label={`${p.name} ${v.version}번 버전 후보 등록`} onClick={() => void l.registerCandidate(p.name, v.version)}>후보 등록</button>}
                  </td>
                )}
                {stage === 'serve' && (
                  <td className="admin-nowrap">
                    {action === 'live'
                      ? '반영 중'
                      : action === 'promote'
                        ? (
                          <button
                            type="button" className="btn sm pri" disabled={busy} aria-label={`${p.name} ${v.version}번 버전 서비스에 반영`}
                            onClick={(e) => {
                              if (!window.confirm(`${promptLabel(p.name)} ${v.version}번 버전을 서비스에 반영할까요? AI 서비스가 곧 이 조합(${modelLabel(v.model, recent, v.effectiveModel)})을 쓰게 돼요.`)) return
                              // 반영되면 이 버튼이 '반영 중' 글자로 바뀌어 초점이 사라지므로 상세 제목으로 옮긴다.
                              const heading = e.currentTarget.closest('section')?.querySelector<HTMLElement>('h2')
                              void l.promote(p.name, v.version).then((ok) => { if (ok) heading?.focus() })
                            }}
                          >
                            서비스에 반영
                          </button>
                        )
                        : <span className="small muted">후보로 등록한 뒤 가능</span>}
                  </td>
                )}
              </tr>
              {/* 반영 전에 그 버전의 본문을 확인한다(#807). 펼친 본문은 표 전체 폭의 새 줄이라 좁은 화면에서 표를 넓히지 않는다. */}
              {stage === 'prompt' && v.prompt != null && (
                <tr className="admin-prompt-body">
                  <td colSpan={columns.length}>
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
  )
}

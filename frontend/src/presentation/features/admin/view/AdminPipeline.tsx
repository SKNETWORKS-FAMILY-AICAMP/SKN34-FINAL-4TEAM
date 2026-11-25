import { Fragment, Suspense, lazy, useEffect, useRef, useState, type CSSProperties } from 'react'

import { PIPELINE_FLOWS, type PipelineFlowKey } from '../../../../domain/entities/admin'
import { LLM_FORBIDDEN, PERIODS, bodyText, traceStatusLabel, type Observation } from '../../../../domain/entities/llmOps'
import { FLOW_DEFS, flowNodes, flowOfNode, isFlowStepId, type FlowDef } from '../../../../domain/entities/llmOpsFlows'
import {
  PIPELINE_RECORDS_LIMIT, RECORD_RESULTS, filterRecords, flowTree, guardVerdict, nodeStats, promptTargets, recalledTitles, recordResult, spanMillis, splitOutput, verdictText, type PipelineNode, type PipelineRecord,
} from '../../../../domain/entities/llmOpsPipeline'
import { promptLabel } from '../../../../domain/entities/promptNames'
import { kstDateTime } from '../../../shared/format'
import { MoreVerticalIcon } from '../../../shared/icons'
import { PopMenu } from '../../../shared/PopMenu'
import '../../../../styles/admin-pipeline.css'
import type { LlmVM, VM } from './LlmOps'
import { NodePromptLink } from './NodePromptLink'
import { LiveState, Pager, Table } from './OperationsPanels'
import { PromptName } from './PromptName'
import { useAdminDetailFocus } from './useAdminDetailFocus'

// react-force-graph(d3·canvas)는 파이프라인 그림을 볼 때만 내려받는다.
const PipelineCanvas = lazy(() => import('./AdminPipelineCanvas'))

/**
 * 프롬프트·평가 쪽의 'AI 파이프라인' 보기(DEC-58, 예전 프롬프트·모델의 전체): 집필 AI 파이프라인을 고정 좌표 캔버스로 보이고, 노드(Decision Guard·메인 에이전트·업무 Agent·도구)를 고르면
 * 그 노드의 observation 기록(결과 필터·표, 펼치면 입력·출력·메타데이터·도구 호출, 실행 흐름, 프롬프트 보기)을 캔버스와 노드 버튼 아래에 전체 폭으로 보인다(옆에 두면 표가 반쪽 폭에서 넘친다).
 * 캔버스는 보조라 같은 노드를 키보드로 고르는 버튼 목록을 캔버스 아래에 둔다. 노드를 고르면 기록 제목으로, 닫으면 눌렀던 노드 버튼으로 초점을 옮긴다.
 * 프롬프트가 연결된 노드는 노드 버튼 목록과 기록 패널 머리에 '프롬프트 보기'(NodePromptLink: 하나면 버튼·여럿이면 목록·없으면 없음, #857)가 있어 프롬프트 상세(개선 루프)로 바로 갑니다. 캔버스 위에는 두지 않습니다.
 * 워크플로우(주소 flow, #857 3차)는 사이드바 '프롬프트·평가' 아래 하위 탭이 고르고(3차 정정: 캔버스 위 선택 상자는 없다), 전체(서버 노드 흐름)와 내부에 여러 LLM 단계가 있는 에이전트의 내부 흐름 중 하나를 같은 자리에 그립니다. 흐름의 단계는 코드 근거로 정한 도메인 상수(llmOpsFlows)이고
 * 건수·오류는 서버 노드와 1:1인 단계에만 있으며, 서버 노드가 없는 단계는 점선 구조용 노드(이름만, 고르면 단계 설명)입니다. 전체에서 내부 흐름이 있는 노드를 고르면 기록 패널에 '내부 흐름 보기'가 있습니다.
 */
export function AdminPipeline({ vm, l, workflow, onWorkflow }: { vm: VM; l: LlmVM; workflow: PipelineFlowKey; onWorkflow: (workflow: PipelineFlowKey) => void }) {
  const server = l.pipeline.data
  const def = workflow === 'all' ? null : FLOW_DEFS[workflow]
  const name = PIPELINE_FLOWS.find(([key]) => key === workflow)?.[1] ?? ''
  const nodes = server && (flowNodes(workflow, server) ?? server)
  const parent = def ? server?.find((n) => n.id === def.node) : undefined
  // 흐름 화면의 선택은 그 흐름의 노드나 집계 노드(서버 노드)만 보인다: 주소만 바뀌어(뒤로 가기 등) 남은 다른 흐름의 선택은 그리지 않는다.
  const node = nodes?.find((n) => n.id === l.nodeId) ?? (parent?.id === l.nodeId ? parent : undefined)
  const groups: [string, PipelineNode[]][] = !nodes ? [] : def ? [[`${name} 내부 흐름`, nodes]] : [['요청 흐름', nodes.filter((n) => !n.standalone)], ['단독 기능', nodes.filter((n) => n.standalone)]]
  const root = useAdminDetailFocus(l.nodeId)
  return (
    <section ref={root} className="panel admin-operations admin-pipeline" aria-label="AI 파이프라인">
      <div className="admin-filter">
        <label className="field">
          기간
          <select className="inp" value={l.pipelineHours} onChange={(e) => l.setPipelineHours(Number(e.target.value))}>
            {PERIODS.map(([hours, label]) => <option key={hours} value={hours}>{label}</option>)}
          </select>
        </label>
      </div>
      <LiveState vm={vm} label="AI 파이프라인 현황" state={l.pipeline} forbidden={LLM_FORBIDDEN} />
      {nodes && (nodes.length
        ? (
          <div className="pipe-body">
            <div className="pipe-diagram">
              {def && <FlowCaption l={l} def={def} parent={parent} />}
              <Suspense fallback={<p className="admin-data-state" role="status">파이프라인 그림을 불러오고 있어요.</p>}>
                <PipelineCanvas nodes={nodes} selected={l.nodeId} onSelect={l.selectNode} title={def ? `${name} 내부 흐름` : undefined} />
              </Suspense>
              <NodeButtons l={l} groups={groups} selected={l.nodeId} onSelect={l.selectNode} />
            </div>
            {node && (isFlowStepId(node.id) ? <StepInfo l={l} node={node} parent={parent} /> : <NodeRecords vm={vm} l={l} node={node} workflow={workflow} onWorkflow={onWorkflow} />)}
          </div>
        )
        : <p className="admin-empty">파이프라인 노드가 없어요.</p>)}
      <p className="admin-note">
        {def
          ? '점선 노드는 서버 고정 노드 목록에 없는 단계라 이름만 그려요(단계별 서버 노드는 예정). 눌러 보면 단계 설명을 볼 수 있고, 서버 노드와 이어진 단계는 기록을 볼 수 있어요.'
          : '노드를 누르면 그 노드의 기록을 보여요. 건수는 고른 기간에 Langfuse에 기록된 단계 수이고, 입력·출력은 칸마다 앞 8,000자까지만 보여요.'}
      </p>
    </section>
  )
}

/** 흐름 화면의 설명과 서버 집계: 서버는 그 흐름의 LLM 단계를 한 서버 노드로 함께 세므로 그 노드의 건수를 집계로 보이고 그 노드의 기록 패널을 여는 버튼을 둔다. */
function FlowCaption({ l, def, parent }: { l: LlmVM; def: FlowDef; parent?: PipelineNode }) {
  return (
    <div className="pipe-flow-caption">
      <p className="small muted">{def.caption}</p>
      {parent && (
        <p className="small muted">
          서버는 이 흐름의 LLM 단계를 ‘{parent.label}’ 한 노드로 함께 세요(단계별 노드는 예정): {nodeStats(parent)}{' '}
          <button type="button" className="btn sm" onClick={() => l.selectNode(parent.id)}>집계 기록 보기</button>
        </p>
      )}
    </div>
  )
}

/** 서버 노드가 없는 단계(구조용 노드)를 고르면 서버에 기록을 묻지 않고 단계 설명을 보인다: LLM 여부·설명·프롬프트(프롬프트 보기)·기록이 어디 있는지. */
function StepInfo({ l, node, parent }: { l: LlmVM; node: PipelineNode; parent?: PipelineNode }) {
  const llm = node.step?.llm
  return (
    <section className="pipe-records pipe-stepinfo" aria-label={`${node.label} 단계`}>
      <div className="table-head">
        <h2 tabIndex={-1}>{node.label} 단계</h2>
        <button type="button" className="btn sm" onClick={l.closeNode}>단계 닫기</button>
      </div>
      <p className="small muted">{llm ? 'LLM 호출 · 단계별 서버 노드가 없어 건수·오류는 보이지 않아요(예정)' : 'LLM 아님 · 건수·오류를 세지 않는 단계예요'}</p>
      {node.step?.note && <p>{node.step.note}</p>}
      {node.promptNames.length > 0 && (
        <div className="pipe-meta">
          <p className="small muted">프롬프트 {node.promptNames.map((code, i) => <Fragment key={code}>{i > 0 && ' / '}<PromptName code={code} /></Fragment>)}</p>
          <NodePromptLink l={l} node={node} />
        </div>
      )}
      {llm && parent && <p className="admin-note">이 단계의 호출 기록은 서버 노드 ‘{parent.label}’의 기록에 함께 있어요(위 ‘집계 기록 보기’).</p>}
    </section>
  )
}

function NodeButtons({ l, groups, selected, onSelect }: { l: LlmVM; groups: [string, PipelineNode[]][]; selected: string | null; onSelect: (id: string) => void }) {
  return (
    <div className="pipe-nodes">
      {groups.filter(([, list]) => list.length).map(([title, list]) => (
        <div key={title} role="group" aria-label={title}>
          <h3>{title}</h3>
          <ul>
            {list.map((n) => (
              <li key={n.id}>
                <button type="button" className={`pipe-node${n.errors ? ' bad' : ''}${n.step ? ' structural' : ''}`} aria-current={n.id === selected ? 'true' : undefined} data-record-id={n.id} onClick={() => onSelect(n.id)}>
                  <b>{n.label}</b>
                  <span className="small muted">{nodeStats(n)}</span>
                </button>
                <NodePromptLink l={l} node={n} />
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  )
}

function NodeRecords({ vm, l, node, workflow, onWorkflow }: { vm: VM; l: LlmVM; node: PipelineNode; workflow: PipelineFlowKey; onWorkflow: (workflow: PipelineFlowKey) => void }) {
  const page = l.records.data
  const rows = page ? filterRecords(node.id, l.recordFilter.result, page.items) : []
  const inside = flowOfNode(node.id)
  return (
    <section className="pipe-records" aria-label={`${node.label} 기록`}>
      <div className="table-head">
        <h2 tabIndex={-1}>{node.label} 기록</h2>
        <div className="rowend">
          {inside && inside !== workflow && <button type="button" className="btn sm" onClick={() => onWorkflow(inside)}>내부 흐름 보기</button>}
          <button type="button" className="btn sm" onClick={l.closeNode}>기록 닫기</button>
        </div>
      </div>
      <div className="pipe-meta">
        <p className="small muted">{nodeStats(node)} · p95 지연 {spanMillis(node.p95LatencyMs)} · 프롬프트 {node.promptNames.length ? node.promptNames.map((name, i) => <Fragment key={name}>{i > 0 && ' / '}<PromptName code={name} /></Fragment>) : '없음'}</p>
        <NodePromptLink l={l} node={node} />
      </div>
      <div className="admin-filter">
        <label className="field">
          결과
          <select className="inp" value={l.recordFilter.result} onChange={(e) => l.setRecordResult(e.target.value)}>
            {RECORD_RESULTS.map(([value, label]) => <option key={label} value={value}>{label}</option>)}
          </select>
        </label>
      </div>
      <LiveState vm={vm} label="노드 기록" state={l.records} forbidden={LLM_FORBIDDEN} />
      {page && (
        <>
          {rows.length
            ? (
              <Table label={`${node.label} 기록 표`}>
                <thead>
                  <tr>
                    <th scope="col">시각</th>
                    <th scope="col">단계</th>
                    <th scope="col">결과</th>
                    <th scope="col">지연</th>
                    <th scope="col">모델</th>
                    <th scope="col">프롬프트</th>
                    <th scope="col" className="act act-menu"><span className="sr-only">조치</span></th>
                  </tr>
                </thead>
                <tbody>{rows.map((row) => <RecordRow key={row.id} l={l} node={node} row={row} />)}</tbody>
              </Table>
            )
            : <p className="admin-empty">조건에 맞는 기록이 없어요.</p>}
          {page.items.length > 0 && <Pager page={page.page} size={page.size} total={page.total} limit={PIPELINE_RECORDS_LIMIT} onPage={l.setRecordPage} />}
          {page.total > PIPELINE_RECORDS_LIMIT && <p className="admin-note">기록은 최신 1,000건까지만 볼 수 있어요. 기간이나 결과 조건으로 좁혀 보세요.</p>}
        </>
      )}
      {l.flow && <FlowPanel vm={vm} l={l} flow={l.flow} />}
    </section>
  )
}

function RecordRow({ l, node, row }: { l: LlmVM; node: PipelineNode; row: PipelineRecord }) {
  const [open, setOpen] = useState(false)
  const result = recordResult(row), verdict = guardVerdict(row), prompts = promptTargets(node, row)
  const detail = `pipe-record-${row.id}`
  return (
    <>
      <tr>
        <td className="admin-date">
          <button type="button" className="pipe-toggle" aria-expanded={open} aria-controls={open ? detail : undefined} onClick={() => setOpen(!open)}>
            {row.startTime ? kstDateTime(row.startTime) : '—'}
          </button>
        </td>
        <td>{row.name}</td>
        <td>
          <span className={`chip ${result.tone}`}>{result.label}</span>
          {verdict && verdictText(verdict) && <span className="small muted pipe-verdict">{verdictText(verdict)}</span>}
        </td>
        <td>{spanMillis(row.latencyMs)}</td>
        <td>{row.model ?? '—'}</td>
        <td>{row.promptName ? <><PromptName code={row.promptName} /> v{row.promptVersion ?? '?'}</> : '—'}</td>
        <td className="act-menu">
          <PopMenu className="row-menu" label={`「${row.name} ${row.id}」 조치`} icon={<MoreVerticalIcon />}>
            <button type="button" role="menuitem" onClick={() => l.openFlow(row.traceId, row.id)}>실행 흐름 보기</button>
            {prompts.map((name) => (
              <button key={name} type="button" role="menuitem" onClick={() => l.openPrompt(name)}>프롬프트 보기{prompts.length > 1 ? ` · ${promptLabel(name)}` : ''}</button>
            ))}
          </PopMenu>
        </td>
      </tr>
      {open && <tr className="pipe-detail" id={detail}><td colSpan={7}><RecordDetail row={row} guard={!!verdict} /></td></tr>}
    </>
  )
}

/** 입력·출력·메타데이터는 받은 그대로(칸마다 앞 8,000자까지) 보이고, 메인 에이전트 출력만 글과 도구 호출(이름·인자)로 나누며, NovelBrain 회상 기록(recalled 목록)은 회상한 기억 목록(제목 · 정체·성격·목표 같은 문서 조각)을 더한다. */
function RecordDetail({ row, guard }: { row: PipelineRecord; guard: boolean }) {
  const output = splitOutput(row.output), recalled = recalledTitles(row)
  return (
    <dl className="pipe-fields">
      {row.statusMessage && <><dt>상태 메시지</dt><dd>{row.statusMessage}</dd></>}
      <dt>입력</dt>
      <dd><pre className="admin-prose">{bodyText(row.input) || '기록 없음'}</pre></dd>
      <dt>출력</dt>
      <dd><pre className="admin-prose">{output.text || '기록 없음'}</pre></dd>
      {recalled && (
        <>
          <dt>회상한 기억</dt>
          <dd>{recalled.length ? <ul className="pipe-recalled">{recalled.map((title, i) => <li key={i}>{title}</li>)}</ul> : '없음'}</dd>
        </>
      )}
      {output.calls.length > 0 && (
        <>
          <dt>도구 호출</dt>
          <dd>
            <ul className="pipe-calls">
              {output.calls.map((call, i) => <li key={i}><b>{call.name}</b><pre className="admin-prose">{bodyText(call.args) || '인자 없음'}</pre></li>)}
            </ul>
          </dd>
        </>
      )}
      <dt>{guard ? '판정 근거(메타데이터)' : '메타데이터'}</dt>
      <dd><pre className="admin-prose">{bodyText(row.metadata) || '기록 없음'}</pre></dd>
    </dl>
  )
}

/** 기록 한 줄이 속한 작업(trace)의 observation을 부모 아래 자식 트리로 보이고, 단계마다 입력·출력을 펼쳐 볼 수 있다. 그 기록 자신에는 표시를 단다. */
function FlowPanel({ vm, l, flow }: { vm: VM; l: LlmVM; flow: { traceId: string; recordId: string } }) {
  const t = l.flowTrace.data
  const heading = useRef<HTMLHeadingElement>(null)
  useEffect(() => { heading.current?.focus() }, [flow.traceId])
  return (
    <section className="pipe-flow" aria-label="실행 흐름">
      <div className="table-head">
        <h3 tabIndex={-1} ref={heading}>실행 흐름</h3>
        <button type="button" className="btn sm" onClick={l.closeFlow}>실행 흐름 닫기</button>
      </div>
      <LiveState vm={vm} label="실행 흐름" state={l.flowTrace} forbidden={LLM_FORBIDDEN} />
      {t && (
        <>
          <p className="small muted">{t.feature} · {traceStatusLabel(t.status)} · 추적 {t.id}</p>
          <ol className="pipe-tree">
            {flowTree(t.observations).map(({ observation, depth }) => <FlowStep key={observation.id} step={observation} depth={depth} here={observation.id === flow.recordId} />)}
          </ol>
        </>
      )}
    </section>
  )
}

function FlowStep({ step, depth, here }: { step: Observation; depth: number; here: boolean }) {
  const meta = [step.type, spanMillis(step.endTime ? step.latencyMs : null), step.model, step.promptName ? `${promptLabel(step.promptName)} v${step.promptVersion ?? '?'}` : null].filter(Boolean).join(' · ')
  return (
    <li className="pipe-step" style={{ '--depth': depth } as CSSProperties} aria-current={here ? 'true' : undefined}>
      <div className="pipe-step-head">
        <b>{step.name}</b>
        <span className="small muted">{meta}</span>
        {step.level === 'ERROR' && <span className="chip bad">오류</span>}
        {here && <span className="chip">이 기록</span>}
      </div>
      {step.statusMessage && <p className="small">{step.statusMessage}</p>}
      <details>
        <summary>입력·출력</summary>
        <dl className="pipe-fields">
          <dt>입력</dt>
          <dd><pre className="admin-prose">{bodyText(step.input) || '기록 없음'}</pre></dd>
          <dt>출력</dt>
          <dd><pre className="admin-prose">{bodyText(step.output) || '기록 없음'}</pre></dd>
        </dl>
      </details>
    </li>
  )
}

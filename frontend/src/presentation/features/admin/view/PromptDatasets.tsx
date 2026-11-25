import { useState } from 'react'

import { PIPELINE_FLOWS } from '../../../../domain/entities/admin'
import { DATASET_KINDS, GATE_UPLOAD_NOTICE, datasetKindLabel, itemSummary, type DatasetItem, type DatasetKind } from '../../../../domain/entities/llmDatasets'
import { LLM_FORBIDDEN } from '../../../../domain/entities/llmOps'
import type { LlmVM, VM } from './LlmOps'
import { ActionLines, LiveState, Pager, Table } from './OperationsPanels'
import { PromptName } from './PromptName'

/** 오류 줄을 줄 번호와 이유로 보이는 개수(나머지는 '외 N줄'). */
const SHOWN_ERRORS = 5

/**
 * 프롬프트 상세 ② 평가 세트의 데이터셋(#868, 운영 서버 API): 목록(세트 이름·종류·짝 프롬프트·문항 수·설명, 종류로 거르기), 세트를 고르면 문항(id·요약, 본문은 접기, 20개씩 쪽), 있는 세트에 .jsonl 업로드.
 * 사이드바에서 고른 흐름이 있으면 그 흐름 프롬프트의 평가 게이트와 최적화 풀만 보입니다. 서버가 Langfuse Dataset을 읽고 올립니다(mockup에서는 같은 계약의 메모리 데이터).
 */
export function DatasetPanel({ vm, l }: { vm: VM; l: LlmVM }) {
  const d = l.dataset, rows = d.datasets.data && d.rows, flowName = PIPELINE_FLOWS.find(([key]) => key === d.flow)?.[1]
  return (
    <section className="admin-datasets" aria-label="평가 데이터셋">
      <h3>평가 데이터셋</h3>
      {d.flow !== 'all' && <p className="small muted">{flowName} 흐름의 세트 {d.scopedCount}개만 보여요(평가 게이트·최적화 풀). 전체 세트는 사이드바의 '전체'에서 봐요.</p>}
      <LiveState vm={vm} label="평가 데이터셋 목록" state={d.datasets} forbidden={LLM_FORBIDDEN} />
      {d.datasets.data && d.scopedCount > 0 && (
        <label className="admin-inline small">
          세트 종류
          <select className="inp" value={d.kind} onChange={(e) => d.setKind(e.target.value as DatasetKind | '')}>
            <option value="">전체</option>
            {DATASET_KINDS.map(([key, label]) => <option key={key} value={key}>{label}</option>)}
          </select>
        </label>
      )}
      {rows && (rows.length
        ? (
          <Table label="평가 데이터셋 표">
            <thead>
              <tr>
                <th scope="col">세트 이름</th>
                <th scope="col">종류</th>
                <th scope="col">짝 프롬프트</th>
                <th scope="col">문항 수</th>
                <th scope="col">설명</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.name}>
                  <td>
                    <button type="button" className="admin-prompt-name" aria-pressed={d.selected === row.name} onClick={() => d.select(d.selected === row.name ? null : row.name)}>{row.name}</button>
                  </td>
                  <td>{datasetKindLabel(row.kind)}</td>
                  <td>{row.prompt ? <PromptName code={row.prompt} /> : '—'}</td>
                  <td className="admin-num">{row.itemCount}문항</td>
                  <td>{row.description ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        )
        : <p className="admin-empty">{d.scopedCount ? '이 종류의 세트가 없어요.' : d.flow !== 'all' ? '이 흐름에는 평가 데이터셋이 없어요.' : '등록된 평가 데이터셋이 없어요.'}</p>)}
      {d.selected && <DatasetItems vm={vm} l={l} name={d.selected} />}
      <UploadForm vm={vm} l={l} />
    </section>
  )
}

/** 고른 세트의 문항: 한 줄에 id와 입력 요약만 보이고, 누르면 입력·기대 답변·메타데이터 본문이 펼쳐집니다(펼친 줄만 그립니다). 20개씩 쪽으로 넘깁니다. */
function DatasetItems({ vm, l, name }: { vm: VM; l: LlmVM; name: string }) {
  const page = l.dataset.items.data
  return (
    <section className="dataset-items" aria-label={`${name} 문항`}>
      <h4>{name} 문항</h4>
      <LiveState vm={vm} label="평가 데이터셋 문항" state={l.dataset.items} forbidden={LLM_FORBIDDEN} />
      {page && (page.items.length ? <ul>{page.items.map((item) => <ItemRow key={item.id} item={item} />)}</ul> : <p className="admin-empty">이 세트에는 문항이 없어요.</p>)}
      {page && page.total > page.size && <Pager page={page.page} size={page.size} total={page.total} onPage={l.dataset.setItemsPage} />}
    </section>
  )
}

function ItemRow({ item }: { item: DatasetItem }) {
  const [open, setOpen] = useState(false)
  const detail = `dataset-item-${item.id}`
  return (
    <li>
      <button type="button" className="dataset-toggle" aria-expanded={open} aria-controls={open ? detail : undefined} onClick={() => setOpen(!open)}>{item.id}</button>
      <span className="small muted">{itemSummary(item)}</span>
      {open && <pre id={detail} className="admin-prose">{JSON.stringify({ input: item.input, expectedOutput: item.expectedOutput, metadata: item.metadata }, null, 2)}</pre>}
    </li>
  )
}

/** 줄 번호와 이유 목록(처음 몇 줄만, 나머지는 건수). */
function ErrorLines({ errors }: { errors: { line: number; message: string }[] }) {
  const hidden = errors.length - SHOWN_ERRORS
  return (
    <ul className="dataset-errors">
      {errors.slice(0, SHOWN_ERRORS).map((error) => <li key={error.line}>{error.line}번째 줄 · {error.message}</li>)}
      {hidden > 0 && <li>…외 {hidden}줄</li>}
    </ul>
  )
}

/**
 * .jsonl 업로드: 올릴 세트(목록의 세트)를 고르고 파일을 고르면 바로 형식·크기를 검사해 미리보기(건수·첫 항목·오류 줄)를 보이며, 저작권 확인란을 체크해야 올릴 수 있습니다(올린 문항은 Langfuse에 저장됩니다).
 * 서버가 줄을 거절하면 그 줄 목록을 거절 표시로 보입니다.
 */
function UploadForm({ vm, l }: { vm: VM; l: LlmVM }) {
  const { form } = l.dataset, { preview, sets } = form
  const busy = !!vm.actions['dataset:upload']?.pending
  return (
    <form className="dataset-upload" aria-label="JSONL 업로드" onSubmit={(e) => { e.preventDefault(); void form.submit() }}>
      <h4>JSONL 파일 올리기</h4>
      <ActionLines vm={vm} prefix="dataset:" />
      <fieldset disabled={busy || !sets.length} className="form-grid">
        <label className="field">
          올릴 세트
          <select className="inp" value={form.target} onChange={(e) => form.setTarget(e.target.value)}>
            {sets.length ? sets.map((set) => <option key={set.name} value={set.name}>{`${set.name} · ${datasetKindLabel(set.kind)}`}</option>) : <option value="">세트가 없어요</option>}
          </select>
        </label>
        {form.targetKind === 'gate' && <p className="small muted wide">{GATE_UPLOAD_NOTICE}</p>}
        <label className="field">
          JSONL 파일(.jsonl만)
          <input key={form.inputKey} type="file" accept=".jsonl" onChange={(e) => void form.pick(e.target.files?.[0])} />
        </label>
        {form.pickError && <p className="admin-data-state wide" role="alert">{form.pickError}</p>}
        {form.picked && preview && (
          <div className="dataset-preview wide" aria-label="업로드 미리보기">
            <p role="status">
              <b>{form.picked.fileName}</b> · 줄 {preview.total}개 중 {preview.lines.length}개 통과{preview.errors.length ? ` · 오류 ${preview.errors.length}줄` : ''}
              {preview.total === 0 && ' · 올릴 문항이 없어요'}
            </p>
            {preview.limit && <p className="admin-data-state" role="alert">{preview.limit}</p>}
            {preview.lines[0] && (
              <>
                <p className="small muted">첫 항목</p>
                <pre className="admin-prose">{JSON.stringify(preview.lines[0], null, 2)}</pre>
              </>
            )}
            {preview.errors.length > 0 && <ErrorLines errors={preview.errors} />}
          </div>
        )}
        {form.rejected.length > 0 && (
          <div className="dataset-rejected wide" aria-label="서버가 거절한 줄">
            <p className="admin-action-error"><b>서버가 거절한 줄(아무것도 올라가지 않았어요)</b></p>
            <ErrorLines errors={form.rejected} />
          </div>
        )}
        <label className="admin-inline small wide">
          <input type="checkbox" required checked={form.confirmed} onChange={(e) => form.setConfirmed(e.target.checked)} /> 저작권 있는 원문(웹소설·해리 포터 등)이 아님
        </label>
        <p className="small muted wide">
          올린 문항은 서버를 거쳐 Langfuse Dataset에 저장되므로 저작권이 있는 원문은 올리지 말고 로컬 평가에서만 써요(시연 화면에서는 메모리에만 쌓여 새로 고치면 사라져요).
          UTF-8로 저장한 .jsonl이고 줄마다 {'{"input", "expectedOutput", "metadata"}'} 모양의 JSON 객체예요. input(객체)과 expectedOutput은 필수(null·빈 값 불가, 보통은 글이고 추출 세트는 정답표, 라우팅 세트는 guard·capabilities 정답)이고 metadata는 선택이며, 문항 id(서버가 붙여요)를 비롯한 다른 칸은 오류예요.
          세트마다 채점 코드가 읽는 칸이 더 필요하고(시뮬레이션은 input.data·metadata.judge, 라우팅은 input.request, 추출은 회차 input과 설정에 드는 core 정답이 하나 이상 있는 정답표, Q&A는 question·contexts, 범용은 metadata.criteria)
          같은 input이 파일 안에 두 번 있거나 이 세트·짝 세트에 이미 있어도 오류예요(이미 있는 것은 올릴 때 서버가 알려 줘요).
          500줄(빈 줄 제외)·2MB까지, 한 줄이라도 틀리면 아무것도 올리지 않아요. 새 세트는 만들 수 없고 위 목록의 세트에만 올려요.
        </p>
        <div className="rowend wide"><button type="submit" className="btn pri" disabled={!form.canSubmit}>{busy ? '올리는 중…' : '업로드'}</button></div>
      </fieldset>
    </form>
  )
}

import { useState } from 'react'

import { itemSummary, type DatasetItem } from '../../../../domain/entities/llmDatasets'
import { LLM_FORBIDDEN } from '../../../../domain/entities/llmOps'
import type { LlmVM, VM } from './LlmOps'
import { ActionLines, LiveState, Table } from './OperationsPanels'
import { PromptName } from './PromptName'

/** 미리보기에 줄 번호와 이유를 보이는 오류 줄 수(나머지는 '외 N줄'). */
const SHOWN_ERRORS = 5

/**
 * 프롬프트 상세 ② 평가 세트의 데이터셋(#857, 서버 API 예정): 목록(세트 이름·짝 프롬프트·문항 수·출처), 세트를 고르면 문항(id·요약, 본문은 접기), .jsonl 업로드.
 * 서버 API가 아직 없어 실제 모드에서는 '서버 준비 중'으로 잠그고 아무것도 읽거나 보내지 않으며(성공을 흉내 내지 않음), mockup에서만 메모리 데이터로 동작합니다.
 */
export function DatasetPanel({ vm, l }: { vm: VM; l: LlmVM }) {
  const d = l.dataset, rows = d.datasets.data
  return (
    <section className="admin-datasets" aria-label="평가 데이터셋">
      <h3>평가 데이터셋</h3>
      {d.ready
        ? (
          <>
            <LiveState vm={vm} label="평가 데이터셋 목록" state={d.datasets} forbidden={LLM_FORBIDDEN} />
            {rows && (rows.length
              ? (
                <Table label="평가 데이터셋 표">
                  <thead>
                    <tr>
                      <th scope="col">세트 이름</th>
                      <th scope="col">짝 프롬프트</th>
                      <th scope="col">문항 수</th>
                      <th scope="col">출처</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row) => (
                      <tr key={row.name}>
                        <td>
                          <button type="button" className="admin-prompt-name" aria-pressed={d.selected === row.name} onClick={() => d.select(d.selected === row.name ? null : row.name)}>{row.name}</button>
                        </td>
                        <td>{row.prompt ? <PromptName code={row.prompt} /> : '—'}</td>
                        <td className="admin-num">{row.items}문항</td>
                        <td>{row.source}</td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              )
              : <p className="admin-empty">등록된 평가 데이터셋이 없어요.</p>)}
            {d.selected && <DatasetItems vm={vm} l={l} name={d.selected} />}
          </>
        )
        : <p className="admin-empty" role="status">평가 데이터셋 목록과 JSONL 업로드는 서버 준비 중이에요. 서버 API가 열리면 이 화면에서 쓸 수 있어요(예정).</p>}
      <UploadForm vm={vm} l={l} />
    </section>
  )
}

/** 고른 세트의 문항: 한 줄에 id와 입력 요약만 보이고, 누르면 입력·기대 답변·메타데이터 본문이 펼쳐집니다(펼친 줄만 그립니다). */
function DatasetItems({ vm, l, name }: { vm: VM; l: LlmVM; name: string }) {
  const items = l.dataset.items.data
  return (
    <section className="dataset-items" aria-label={`${name} 문항`}>
      <h4>{name} 문항</h4>
      <LiveState vm={vm} label="평가 데이터셋 문항" state={l.dataset.items} forbidden={LLM_FORBIDDEN} />
      {items && (items.length ? <ul>{items.map((item) => <ItemRow key={item.id} item={item} />)}</ul> : <p className="admin-empty">이 세트에는 문항이 없어요.</p>)}
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

/** .jsonl 업로드: 파일을 고르면 바로 형식을 검사해 미리보기(건수·첫 항목·오류 줄)를 보이고, 저작권 확인란을 체크해야 올릴 수 있습니다(올린 문항은 Langfuse에 저장됩니다). */
function UploadForm({ vm, l }: { vm: VM; l: LlmVM }) {
  const { ready, form } = l.dataset, preview = form.preview
  const busy = !!vm.actions['dataset:upload']?.pending
  const hidden = preview ? preview.errors.length - SHOWN_ERRORS : 0
  return (
    <form className="dataset-upload" aria-label="JSONL 업로드" onSubmit={(e) => { e.preventDefault(); void form.submit() }}>
      <h4>JSONL 파일 올리기</h4>
      <ActionLines vm={vm} prefix="dataset:" />
      {!ready && <p id="dataset-upload-off" className="small muted">서버 준비 중이라 지금은 올릴 수 없어요.</p>}
      <fieldset disabled={!ready || busy} className="form-grid" aria-describedby={ready ? undefined : 'dataset-upload-off'}>
        <label className="field">
          세트 이름
          <input className="inp" value={form.setName} onChange={(e) => form.setSetName(e.target.value)} />
        </label>
        <label className="field">
          JSONL 파일(.jsonl만)
          <input key={form.inputKey} type="file" accept=".jsonl" onChange={(e) => void form.pick(e.target.files?.[0])} />
        </label>
        {form.pickError && <p className="admin-data-state wide" role="alert">{form.pickError}</p>}
        {form.picked && preview && (
          <div className="dataset-preview wide" aria-label="업로드 미리보기">
            <p role="status">
              <b>{form.picked.fileName}</b> · 줄 {preview.total}개 중 {preview.items.length}개 통과{preview.errors.length ? ` · 오류 ${preview.errors.length}줄` : ''}
              {preview.total === 0 && ' · 올릴 문항이 없어요'}
            </p>
            {preview.items[0] && (
              <>
                <p className="small muted">첫 항목</p>
                <pre className="admin-prose">{JSON.stringify(preview.items[0], null, 2)}</pre>
              </>
            )}
            {preview.errors.length > 0 && (
              <ul className="dataset-errors">
                {preview.errors.slice(0, SHOWN_ERRORS).map((error) => <li key={error.line}>{error.line}번째 줄 · {error.message}</li>)}
                {hidden > 0 && <li>…외 {hidden}줄</li>}
              </ul>
            )}
          </div>
        )}
        <label className="admin-inline small wide">
          <input type="checkbox" required checked={form.confirmed} onChange={(e) => form.setConfirmed(e.target.checked)} /> 저작권 있는 원문(웹소설·해리 포터 등)이 아님
        </label>
        {/* ready는 지금 mockup 메모리 구현뿐이다: HTTP 구현이 생기면 이 문구를 서버(Langfuse 저장) 기준으로 바꾼다. */}
        <p className="small muted wide">
          지금은 시연용 메모리에서 동작해 올린 문항이 Langfuse에 저장되지 않고 새로 고치면 사라져요. 서버 API가 열리면 Langfuse Dataset에 저장되므로 저작권이 있는 원문은 올리지 말고 로컬 평가에서만 써요.
          줄마다 {'{"id", "input", "expectedOutput"(선택), "metadata"}'} 모양의 JSON이어야 하고 같은 id는 덮어써요.
        </p>
        <div className="rowend wide"><button type="submit" className="btn pri" disabled={!form.canSubmit}>{busy ? '올리는 중…' : '업로드'}</button></div>
      </fieldset>
    </form>
  )
}

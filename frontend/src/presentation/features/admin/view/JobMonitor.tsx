import { useEffect, useRef, useState } from 'react'

import { JOB_KINDS, JOB_RUNS_LIMIT, JOB_STATUSES, jobKindLabel, jobProgress, jobSourceLabel, jobStatusLabel, jobTriggerLabel, type JobRun, type Schedule } from '../../../../domain/entities/jobMonitor'
import { kstDateTime } from '../../../shared/format'
import { useJobMonitorViewModel } from '../viewmodel/useJobMonitorViewModel'
import type { useAdminViewModel } from '../viewmodel/useAdminViewModel'
import { formText } from './formValue'
import { ActionLines, LiveState, Pager, Table } from './OperationsPanels'

type VM = ReturnType<typeof useAdminViewModel>
type Jobs = ReturnType<typeof useJobMonitorViewModel>

const statusChip = (status: string) => <span className={`chip ${status === 'succeeded' ? 'ok' : status === 'failed' ? 'wait' : ''}`}>{jobStatusLabel(status)}</span>

/** 35 작업 감시·정기 작업: 회차 원고 전처리와 운영 정기 작업을 같은 실행 기록으로 보고, 실패 재실행과 일정 관리를 요청합니다. */
export function JobMonitor({ vm }: { vm: VM }) {
  const j = useJobMonitorViewModel(vm.live.mutate)
  return (
    <>
      <Runs vm={vm} j={j} />
      <Schedules vm={vm} j={j} />
    </>
  )
}

function Runs({ vm, j }: { vm: VM; j: Jobs }) {
  const page = j.runs.data, q = j.query
  return (
    <section className="panel admin-operations" aria-label="작업 실행 기록">
      <div className="table-head">
        <h2 className="panel-title">실행 기록</h2>
        <button type="button" className="btn sm" onClick={j.runs.retry} disabled={j.runs.isRefreshing}>새로고침</button>
      </div>
      <form
        className="admin-filter"
        onSubmit={(e) => {
          e.preventDefault()
          const form = e.currentTarget
          j.applyFilters(formText(form, 'status'), formText(form, 'kind'))
        }}
      >
        <label className="field">
          상태
          <select className="inp" name="status" defaultValue={q.status}>
            <option value="">전체</option>
            {JOB_STATUSES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </label>
        <label className="field">종류<input className="inp" name="kind" list="job-kinds" defaultValue={q.kind} placeholder="예: regression_eval" /></label>
        <datalist id="job-kinds">{JOB_KINDS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</datalist>
        <button type="submit" className="btn sm pri">조회</button>
      </form>
      <LiveState vm={vm} label="실행 기록" state={j.runs} />
      <ActionLines vm={vm} prefix="run:" />
      {page && page.unavailable.length > 0 && (
        <p className="admin-data-state" role="status">
          일부 출처의 실행 기록을 불러오지 못했어요: {page.unavailable.join(', ')}. 불러온 출처의 기록만 보여서 원고 전처리 작업이 빠졌을 수 있어요.
        </p>
      )}
      {page && (page.items.length
        ? (
          <>
            <Table label="작업 실행 기록 표">
              <thead>
                <tr>
                  <th scope="col">작업</th>
                  <th scope="col">출처</th>
                  <th scope="col">상태</th>
                  <th scope="col">요청 주체</th>
                  <th scope="col">진행률</th>
                  <th scope="col">시작</th>
                  <th scope="col">종료</th>
                  <th scope="col">오류·대상</th>
                  <th scope="col" className="act">조치</th>
                </tr>
              </thead>
              <tbody>{page.items.map((run) => <RunRow key={run.id} run={run} j={j} busy={!!vm.actions[`run:${run.id}`]?.pending} />)}</tbody>
            </Table>
            <Pager page={page.page} size={page.size} total={page.total} limit={JOB_RUNS_LIMIT} onPage={j.setPage} />
            {page.total > JOB_RUNS_LIMIT && <p className="admin-note">실행 기록은 앞쪽 1,000건까지만 볼 수 있어요. 상태·종류 조건으로 좁혀 보세요.</p>}
          </>
        )
        : <p className="admin-empty">조건에 맞는 실행 기록이 없어요.</p>)}
      <p className="admin-note">실패한 작업만 다시 실행할 수 있어요. 사용자가 요청한 AI 작업은 자동으로 다시 실행하지 않아요.</p>
    </section>
  )
}

function RunRow({ run, j, busy }: { run: JobRun; j: Jobs; busy: boolean }) {
  const kind = jobKindLabel(run.kind), progress = run.progress
  return (
    <tr>
      <td>{kind}</td>
      <td>{jobSourceLabel(run.source)}</td>
      <td>{statusChip(run.status)}</td>
      <td>{jobTriggerLabel(run.trigger)}</td>
      <td>
        {progress && progress.total > 0 && <progress value={progress.done} max={progress.total} aria-label={`${kind} 진행률`} />}
        <div className="small">{jobProgress(progress)}</div>
      </td>
      <td>{run.startedAt ? kstDateTime(run.startedAt) : '—'}</td>
      <td>{run.finishedAt ? kstDateTime(run.finishedAt) : '—'}</td>
      <td>
        {run.error ?? '—'}
        {run.targetId && <div className="small muted">대상 {run.targetId}</div>}
      </td>
      <td>
        {run.status === 'failed'
          ? (
            <button
              type="button"
              className="btn sm"
              aria-label={`${kind} 실행 ${run.id} 다시 실행`}
              disabled={busy}
              onClick={() => { if (window.confirm('실패한 작업을 다시 실행할까요? 원고 전처리는 실패한 회차만 다시 접수돼요.')) void j.retry(run.id) }}
            >
              다시 실행
            </button>
          )
          : '—'}
      </td>
    </tr>
  )
}

function Schedules({ vm, j }: { vm: VM; j: Jobs }) {
  const [editing, setEditing] = useState<Schedule | null>(null)
  const rows = j.schedules.data
  return (
    <section className="panel admin-operations" style={{ marginTop: 14 }} aria-label="정기 작업 일정">
      <h2 className="panel-title">정기 작업 일정</h2>
      <LiveState vm={vm} label="일정 목록" state={j.schedules} />
      <ActionLines vm={vm} prefix="schedule:" />
      {rows && (rows.length
        ? (
          <Table label="정기 작업 일정 표">
            <thead>
              <tr>
                <th scope="col">작업</th>
                <th scope="col">cron 식</th>
                <th scope="col">사용</th>
                <th scope="col">매개변수</th>
                <th scope="col">최근 실행</th>
                <th scope="col" className="act">조치</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const kind = jobKindLabel(row.kind), busy = !!vm.actions[`schedule:${row.id}`]?.pending
                return (
                  <tr key={row.id}>
                    <td>{kind}</td>
                    <td>{row.cron}</td>
                    <td><span className={`chip ${row.enabled ? 'ok' : 'wait'}`}>{row.enabled ? '켜짐' : '꺼짐·취소됨'}</span></td>
                    <td>{Object.keys(row.params).length ? JSON.stringify(row.params) : '—'}</td>
                    <td>{row.lastRun ? <>{statusChip(row.lastRun.status)} <span className="small muted">{row.lastRun.startedAt ? kstDateTime(row.lastRun.startedAt) : ''}</span></> : '—'}</td>
                    <td>
                      <div className="admin-inline">
                        <button type="button" className="btn sm" aria-label={`${kind} 일정 수정`} disabled={busy} onClick={() => setEditing(row)}>수정</button>
                        <button
                          type="button"
                          className="btn sm"
                          aria-label={`${kind} 일정 취소`}
                          disabled={busy || !row.enabled}
                          onClick={() => { if (window.confirm(`${kind} 일정을 취소할까요? 일정은 삭제되지 않고 꺼져요.`)) void j.cancelSchedule(row.id) }}
                        >
                          일정 취소
                        </button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </Table>
        )
        : <p className="admin-empty">등록된 일정이 없어요.</p>)}
      <ScheduleForm key={editing?.id ?? 'new'} editing={editing} vm={vm} j={j} onDone={() => setEditing(null)} />
      <p className="admin-note">운영 서버가 1분마다 켜진 일정 중 도래한 것을 실행하고 실행 기록에 남겨요(같은 일정이 아직 실행 중이면 건너뛰어요). 서버가 해석하는 cron 식을 입력하면 잘못된 식은 서버가 알려 줘요.</p>
    </section>
  )
}

/** 일정 등록 폼이자 선택한 일정의 수정 폼입니다. 작업 종류는 등록할 때만 고르고 바꿀 수 없어요. */
function ScheduleForm({ editing, vm, j, onDone }: { editing: Schedule | null; vm: VM; j: Jobs; onDone: () => void }) {
  const busy = !!vm.actions[editing ? `schedule:${editing.id}` : 'schedule:new']?.pending
  const heading = useRef<HTMLHeadingElement>(null)
  // 목록에서 수정을 누르면 아래 폼으로 초점을 옮겨 키보드 사용자가 바로 고칠 수 있게 합니다.
  useEffect(() => { if (editing) heading.current?.focus() }, [editing])
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault()
        const form = e.currentTarget
        const cron = formText(form, 'cron'), params = formText(form, 'params'), enabled = new FormData(form).get('enabled') === 'on'
        if (editing ? await j.updateSchedule(editing.id, editing.kind, cron, enabled, params) : await j.createSchedule(formText(form, 'kind'), cron, enabled, params)) {
          if (editing) onDone()
          else form.reset()
        }
      }}
    >
      <h3 ref={heading} tabIndex={-1}>{editing ? `일정 수정 · ${jobKindLabel(editing.kind)}` : '일정 등록'}</h3>
      <fieldset disabled={busy} className="form-grid">
        <label className="field">
          작업 종류
          <select className="inp" name="kind" defaultValue={editing?.kind ?? JOB_KINDS[0][0]} disabled={!!editing}>
            {JOB_KINDS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </label>
        <label className="field">cron 식<input className="inp" name="cron" required defaultValue={editing?.cron ?? ''} placeholder="예: 0 0 3 * * *" /></label>
        <label className="field wide">매개변수(JSON 객체)<textarea className="ta" name="params" rows={3} defaultValue={editing ? JSON.stringify(editing.params) : '{}'} /></label>
        <label><input type="checkbox" name="enabled" defaultChecked={editing?.enabled ?? true} /> 사용</label>
        <div className="rowend wide">
          {editing && <button type="button" className="btn" onClick={onDone}>수정 취소</button>}
          <button type="submit" className="btn pri">{busy ? '저장 중…' : editing ? '일정 변경' : '일정 등록'}</button>
        </div>
      </fieldset>
    </form>
  )
}

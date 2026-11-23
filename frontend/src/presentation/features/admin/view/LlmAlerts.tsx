import { useState } from 'react'

import { ALERT_FORBIDDEN, ALERT_STATUSES, alertRuleLabel, alertStatusLabel, type Alert } from '../../../../domain/entities/operationsAlert'
import { kstDateTime } from '../../../shared/format'
import { useAlertsViewModel } from '../viewmodel/useAlertsViewModel'
import type { useAdminViewModel } from '../viewmodel/useAdminViewModel'
import { ActionLines, LiveState, Table } from './OperationsPanels'

type VM = ReturnType<typeof useAdminViewModel>
type Alerts = ReturnType<typeof useAlertsViewModel>

/** 운영 경고 목록과 확인·조치 완료(메모). 조회·처리는 llm 또는 jobs 권한이 있어야 해서, 없으면(403) 실패 화면 대신 필요한 권한을 안내합니다. */
export function LlmAlerts({ vm }: { vm: VM }) {
  const d = useAlertsViewModel(vm.live.mutate)
  const rows = d.alerts.data
  return (
    <section className="panel admin-operations" aria-label="운영 경고">
      <div className="table-head">
        <h2 className="panel-title">운영 경고</h2>
      </div>
      <div className="admin-filter">
        <label className="field">
          상태
          <select className="inp" value={d.status ?? ''} onChange={(e) => d.setStatus(ALERT_STATUSES.find(([value]) => value === e.target.value)?.[0] ?? null)}>
            <option value="">전체</option>
            {ALERT_STATUSES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </label>
      </div>
      <LiveState vm={vm} label="경고 목록" state={d.alerts} />
      <ActionLines vm={vm} prefix="alert:" />
      {rows === null && <p className="admin-action-error" role="alert">{ALERT_FORBIDDEN}</p>}
      {rows && (rows.length
        ? (
          <Table label="운영 경고 표">
            <thead>
              <tr>
                <th scope="col">발생</th>
                <th scope="col">규칙</th>
                <th scope="col">내용</th>
                <th scope="col">상태</th>
                <th scope="col">처리 기록</th>
                <th scope="col" className="act">조치</th>
              </tr>
            </thead>
            <tbody>{rows.map((alert) => <AlertRow key={alert.id} alert={alert} d={d} busy={!!vm.actions[`alert:${alert.id}`]?.pending} />)}</tbody>
          </Table>
        )
        : <p className="admin-empty">조건에 맞는 경고가 없어요.</p>)}
      <p className="admin-note">확인·조치 완료는 활동 로그에 남아요.</p>
    </section>
  )
}

function AlertRow({ alert, d, busy }: { alert: Alert; d: Alerts; busy: boolean }) {
  const [note, setNote] = useState('')
  const rule = alertRuleLabel(alert.ruleKey)
  const act = async (status: 'acknowledged' | 'resolved') => { if (await d.updateAlert(alert.id, status, note)) setNote('') }
  return (
    <tr>
      <td className="admin-date">{kstDateTime(alert.createdAt)}</td>
      <td>{rule}</td>
      <td>
        {alert.message}
        {alert.value != null && <span className="small muted"> · 측정값 {alert.value}</span>}
        {alert.targetRef && <span className="small muted"> · 대상 {alert.targetRef}</span>}
      </td>
      <td><span className={`chip ${alert.status === 'open' ? 'wait' : 'ok'}`}>{alertStatusLabel(alert.status)}</span></td>
      <td>
        {alert.actedAt ? <span className="admin-date">{kstDateTime(alert.actedAt)}</span> : '—'}
        {alert.note && <div className="small">{alert.note}</div>}
      </td>
      <td>
        {alert.status === 'resolved'
          ? '—'
          : (
            <div className="admin-inline">
              <input className="inp" aria-label={`${rule} 경고 메모`} placeholder="메모(선택)" value={note} onChange={(e) => setNote(e.target.value)} />
              {alert.status === 'open' && (
                <button type="button" className="btn sm" aria-label={`${rule} 경고 확인`} disabled={busy} onClick={() => void act('acknowledged')}>확인</button>
              )}
              <button type="button" className="btn sm pri" aria-label={`${rule} 경고 조치 완료`} disabled={busy} onClick={() => void act('resolved')}>조치 완료</button>
            </div>
          )}
      </td>
    </tr>
  )
}

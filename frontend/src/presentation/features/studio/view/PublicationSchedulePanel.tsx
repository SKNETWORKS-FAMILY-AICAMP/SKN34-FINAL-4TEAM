import { useId } from 'react'
import type { WritingEpisode } from '../../../../domain/entities/content'
import { publishBlocker } from '../../../../domain/entities/manuscriptLength'
import { toKstDateTimeInput } from '../../../../domain/entities/publicationSchedule'
import { usePublicationScheduleViewModel } from '../viewmodel/usePublicationScheduleViewModel'

const statusLabel = { pending: '대기', published: '발행 완료', failed: '실패', canceled: '취소' }
const formatTime = (instant: string) => new Date(instant).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })

export function PublicationSchedulePanel({ workId, episode }: { workId: string; episode: WritingEpisode }) {
  const vm = usePublicationScheduleViewModel(workId, episode.number)
  const versions = episode.versions.filter(version => version.body.trim())
  const reasonId = useId()
  // 예약 발행도 공개 경로라 고른 저장 버전 본문이 5,000자 이상이어야 한다(UC-10). 예약 취소는 분량과 무관하다.
  const chosen = versions.find(version => version.id === vm.form.versionId)
  const tooShort = chosen ? publishBlocker(chosen.body) : ''
  return <section aria-label={`${episode.number}화 예약 발행`}>
    <h2>{episode.number}화 예약 발행</h2>
    <p className="small muted">예약 시각은 한국 표준시(KST)입니다. 예약 결과와 실제 발행 결과를 각각 확인할 수 있어요.</p>
    <button type="button" className="btn sm" disabled={vm.busy} onClick={() => void vm.reload()}>예약 결과 새로고침</button>
    {vm.busy && <p role="status">{vm.rows === null ? '예약 내역을 불러오고 있어요…' : '예약 발행 요청을 처리하고 있어요…'}</p>}
    {vm.error && <p role="alert">{vm.error}</p>}
    {vm.notice && <p role="status">{vm.notice}</p>}
    {vm.rows && <>
      {vm.rows.length === 0 ? <p>이 회차의 발행 예약 내역이 없어요.</p> : <ul>
        {vm.rows.map(row => <li key={row.id}>
          <strong>{statusLabel[row.status]}</strong> · {formatTime(row.scheduledAt)} · {episode.versions.find(version => version.id === row.versionId)?.title ?? row.versionId}
          {row.completedAt && <small> · 처리 시각 {formatTime(row.completedAt)}</small>}
          {row.failureReason && <p>{row.failureReason}</p>}
        </li>)}
      </ul>}
      {!versions.length && <p>본문이 있는 원고 버전을 저장하면 발행을 예약할 수 있어요.</p>}
      {versions.length > 0 && <form onSubmit={event => { event.preventDefault(); void vm.save() }}>
        <label className="field">예약할 저장 버전
          <select className="inp" required disabled={vm.busy} value={vm.form.versionId} onChange={event => vm.edit({ versionId: event.target.value, rights: false })}>
            <option value="">저장 버전 선택</option>
            {versions.map(version => <option key={version.id} value={version.id}>{version.title} · {formatTime(version.savedAt)}</option>)}
          </select>
        </label>
        <label className="field">발행 시각 (KST)
          <input className="inp" type="datetime-local" required min={toKstDateTimeInput(new Date().toISOString())} disabled={vm.busy} value={vm.form.time} onChange={event => vm.edit({ time: event.target.value })} />
        </label>
        <label className="writing-rights">
          <input type="checkbox" checked={vm.form.rights} disabled={vm.busy} onChange={event => vm.edit({ rights: event.target.checked })} />
          이 저장 원고를 공개할 권리가 있음을 확인합니다.
        </label>
        <button type="submit" className="btn pri" disabled={vm.busy || !vm.form.rights || !vm.form.versionId || !vm.form.time || !!tooShort} aria-describedby={tooShort ? reasonId : undefined}>
          {vm.pending ? '예약 변경' : '발행 예약'}
        </button>
        {tooShort && <small id={reasonId} className="muted writing-publish-reason">{tooShort}</small>}
      </form>}
      {vm.pending && <button type="button" className="btn sm" disabled={vm.busy} onClick={() => void vm.cancel()}>예약 취소</button>}
    </>}
  </section>
}

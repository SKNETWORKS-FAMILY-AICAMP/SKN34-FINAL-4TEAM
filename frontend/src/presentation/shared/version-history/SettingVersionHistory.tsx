import { useEffect, useId, useRef, useState } from 'react'
import type { SavedSetting } from '../../../domain/entities/content'
import './version-history.css'

export function SettingVersionHistory({ history, current, onRestore, busy = false, disabledReason = '' }: {
  history: SavedSetting[]; current: SavedSetting[]; onRestore: (id: string, versionId: string) => void
  busy?: boolean; disabledReason?: string
}) {
  const fieldId = useId()
  const [settingId, setSettingId] = useState('')
  const [versionId, setVersionId] = useState('')
  const [confirm, setConfirm] = useState(false)
  const confirmButton = useRef<HTMLButtonElement>(null)
  const restoreButton = useRef<HTMLButtonElement>(null)
  const region = useRef<HTMLElement>(null)
  const wasConfirming = useRef(false)
  useEffect(() => {
    if (confirm) confirmButton.current?.focus()
    else if (wasConfirming.current) {
      const target = restoreButton.current
      if (target && !target.disabled) target.focus()
      else region.current?.focus()
    }
    wasConfirming.current = confirm
  }, [confirm])
  const items = [...new Map(history.map(s => [s.id, s])).values()]
  const versions = history.filter(s => s.id === settingId)
  const selected = versions.find(s => s.versionId === versionId)
  const latest = current.find(s => s.id === settingId)
  return <section ref={region} tabIndex={-1} className="version-history" aria-label="설정 버전 목록">
    {!history.length ? <p className="muted">아직 확정한 설정 버전이 없어요.</p> : <>
      <div className="version-selectors">
        <label className="field" htmlFor={`${fieldId}-setting`}>설정 항목
          <select className="inp" id={`${fieldId}-setting`} value={items.some(s => s.id === settingId) ? settingId : ''} disabled={busy} onChange={e => { setSettingId(e.target.value); setVersionId(''); setConfirm(false) }}>
            <option value="">설정 선택</option>{items.map(s => <option key={s.id} value={s.id}>{s.name} · {s.category}</option>)}
          </select>
        </label>
        <label className="field" htmlFor={`${fieldId}-version`}>설정 버전
          <select className="inp" id={`${fieldId}-version`} value={selected?.versionId ?? ''} disabled={busy || !versions.length} onChange={e => { setVersionId(e.target.value); setConfirm(false) }}>
            <option value="">버전 선택</option>{versions.map((s, i) => <option key={s.versionId} value={s.versionId}>이력 {i + 1} · {s.name}{s.versionId === latest?.versionId ? ' · 현재 설정' : ''}</option>)}
          </select>
        </label>
      </div>
      {selected ? <article className="setting-version-detail">
        <h3>{selected.name}</h3>
        <p className="small muted">{selected.category} · {selected.visibility === 'public' ? '공개' : '비공개'} · {selected.fromEpisode}화{selected.toEpisode ? `~${selected.toEpisode}화` : '부터'}{selected.versionId === latest?.versionId ? ' · 현재 설정' : ''}</p>
        <p className="version-prose">{selected.content || '(빈 설정)'}</p>
        <dl className="version-metadata">
          <dt>근거·출처</dt><dd>{selected.evidence || '기록 없음'}</dd>
          <dt>알고 있는 인물</dt><dd>{selected.knownBy.join(', ') || '지정 없음'}</dd>
          <dt>태그</dt><dd>{selected.tags.join(', ') || '없음'}</dd>
        </dl>
        <p className="small muted">복원하면 이 내용과 공개 범위·적용 회차가 새 버전으로 저장돼요. 기존 이력은 보존돼요.</p>
        {disabledReason && <p role="status">{disabledReason}</p>}
        {!selected.content && <p className="muted">빈 설정 버전은 복원할 수 없어요.</p>}
        {confirm ? <div className="version-confirm" role="group" aria-label="설정 복원 확인">
          <p>「{selected.name}」의 선택한 이력으로 복원할까요?</p>
          <div className="version-actions">
            <button type="button" className="btn" disabled={busy} onClick={() => setConfirm(false)}>취소</button>
            <button ref={confirmButton} type="button" className="btn pri" disabled={busy || !!disabledReason || !selected.content} onClick={() => { setConfirm(false); onRestore(selected.id, selected.versionId) }}>새 버전으로 복원 확인</button>
          </div>
        </div> : <button ref={restoreButton} type="button" className="btn" disabled={busy || !!disabledReason || !selected.content} onClick={() => setConfirm(true)}>이 설정을 새 버전으로 복원</button>}
      </article> : <p className="muted">설정 항목과 버전을 선택하면 당시 내용을 확인할 수 있어요.</p>}
    </>}
  </section>
}

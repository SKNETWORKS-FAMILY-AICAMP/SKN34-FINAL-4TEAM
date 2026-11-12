import { useEffect, useState } from 'react'

import { WITHDRAWAL_REASON_MAX } from '../../../../domain/entities/withdrawal'
import { kstDateTime } from '../../../shared/format'
import { Sheet } from '../../../shared/Sheet'
import { useWithdrawalViewModel } from '../viewmodel/useWithdrawalViewModel'

/** U30 회원탈퇴: Core 탈퇴 API로 30일 유예 탈퇴를 요청하고, 유예 중이면 복구할 수 있습니다(UC-22 A3). */
export function Withdrawal() {
  const vm = useWithdrawalViewModel()
  const [open, setOpen] = useState(false)
  const close = () => { setOpen(false); vm.clearError() }
  const state = vm.state
  // 다시 읽은 상태가 유예 중이면(다른 곳에서 이미 요청) 요청 시트를 닫아, 나중에 복구했을 때 다시 열리지 않게 합니다.
  useEffect(() => { if (state?.status === 'PENDING') setOpen(false) }, [state])
  return (
    <div className="tcard mecard danger" aria-busy={vm.pending || (!state && !vm.loadError)}>
      <b>회원탈퇴</b>
      {vm.loadError ? <>
        <p role="alert" className="small">탈퇴 상태를 불러오지 못했어요. 다시 시도해 주세요.</p>
        <button type="button" className="btn" onClick={vm.retry}>탈퇴 상태 다시 시도</button>
      </> : !state ? <p role="status" className="small muted">탈퇴 상태를 확인하고 있어요.</p>
        : state.status === 'PENDING' ? <>
          <p className="small" style={{ margin: '6px 0 12px' }}>탈퇴를 요청한 상태예요({kstDateTime(state.requestedAt)} 요청). {kstDateTime(state.dueAt)}까지 탈퇴 요청을 취소하면 계정을 그대로 쓸 수 있어요.</p>
          {vm.error && <p role="alert" className="small">{vm.error}</p>}
          <button type="button" className="btn" disabled={vm.pending} onClick={() => { void vm.restore() }}>{vm.pending ? '취소하는 중…' : '탈퇴 요청 취소'}</button>
        </> : <>
          <p className="small muted" style={{ margin: '6px 0 12px' }}>탈퇴를 요청하면 30일 유예 기간이 시작되고, 그동안 다시 로그인해 취소할 수 있어요.</p>
          <button type="button" className="btn" id="withdrawBtn" onClick={() => setOpen(true)}>회원탈퇴</button>
        </>}
      {open && state?.status === 'NONE' && <WithdrawSheet pending={vm.pending} error={vm.error} onClose={close} onSubmit={vm.request} />}
    </div>
  )
}

function WithdrawSheet({ pending, error, onClose, onSubmit }: { pending: boolean; error: string; onClose: () => void; onSubmit: (password: string, reason: string) => Promise<boolean> }) {
  const [password, setPassword] = useState('')
  const [reason, setReason] = useState('')
  return (
    <Sheet sid="U30" label="회원탈퇴" onClose={pending ? () => {} : onClose}>
      <div className="sh-h"><h3>회원탈퇴</h3><button type="button" className="x" aria-label="닫기" disabled={pending} onClick={onClose}>✕</button></div>
      <form className="auth-form" noValidate aria-busy={pending} onSubmit={(e) => { e.preventDefault(); void onSubmit(password, reason) }}>
        <div className="policy">
          탈퇴를 요청하면 모든 기기에서 로그아웃되고 30일 유예 기간이 시작돼요. 이 기간에 다시 로그인해 탈퇴 요청을 취소하면 계정을 그대로 쓸 수 있어요.
          유예 기간이 지난 뒤의 최종 처리(계정 익명화, 작품·세계관 정리)는 아직 준비 중이에요.
        </div>
        <label className="field">비밀번호<input className="inp" type="password" autoComplete="current-password" required data-autofocus disabled={pending} value={password} onChange={(e) => setPassword(e.target.value)} /></label>
        <label className="field">탈퇴 사유 (선택)<textarea className="ta" rows={3} maxLength={WITHDRAWAL_REASON_MAX} disabled={pending} value={reason} onChange={(e) => setReason(e.target.value)} /></label>
        {error && <p role="alert">{error}</p>}
        <div className="rowend"><button type="button" className="btn" disabled={pending} onClick={onClose}>취소</button><button type="submit" className="btn pri" disabled={pending || !password}>{pending ? '요청하는 중…' : '탈퇴하기'}</button></div>
      </form>
    </Sheet>
  )
}

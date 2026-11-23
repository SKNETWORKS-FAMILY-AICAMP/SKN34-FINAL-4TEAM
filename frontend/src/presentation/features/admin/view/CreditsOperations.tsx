import { useEffect, useRef, useState } from 'react'

import { creditHistoryLabel, creditHistorySign, creditKindLabel } from '../../../../domain/entities/creditLedger'
import type { MemberItem } from '../../../../domain/entities/member'
import { CREDIT_AMOUNT_MAX, CREDIT_REASON_MAX, CREDITS_FORBIDDEN, MEMBER_SEARCH_FORBIDDEN, type CreditChangeKind } from '../../../../domain/entities/operationsCredit'
import { kstDateTime } from '../../../shared/format'
import { MoreVerticalIcon } from '../../../shared/icons'
import { PopMenu } from '../../../shared/PopMenu'
import type { useAdminViewModel } from '../viewmodel/useAdminViewModel'
import { creditKey, useCreditsViewModel } from '../viewmodel/useCreditsViewModel'
import { AdminActionStatus, LiveState, Table } from './OperationsPanels'

type VM = ReturnType<typeof useAdminViewModel>
type Credits = ReturnType<typeof useCreditsViewModel>

const num = (n: number) => n.toLocaleString('ko-KR')

/**
 * 크레딧 탭(DEC-57): 탭을 열면 전체 회원(최신 가입순)과 행별 잔액 → ⋮ 메뉴로 회원 고르기 → 잔액·내역 표 → 지급·회수 폼(확인 대화 뒤 요청, 처리 중 잠금).
 * 정본은 Core이고 운영 서비스가 중계하며, 지급·회수는 사유와 함께 활동 로그에 남는다. 회원 목록은 사용자 탭과 같은 API(`users` 권한)이고 검색은 목록을 좁힌다.
 */
export function CreditsOperations({ vm }: { vm: VM }) {
  const d = useCreditsViewModel(vm.live.mutate)
  // 회원을 고른 횟수. 같은 회원을 다시 골라도 고른 회원(d.member)은 그대로라, 상세 제목으로 초점을 다시 옮기는 때를 이 값으로 안다.
  const [picks, setPicks] = useState(0)
  const rows = d.members.data
  return (
    <section className="panel admin-operations" aria-label="크레딧 운영">
      <form
        className="admin-filter"
        aria-label="회원 찾기"
        onSubmit={(e) => {
          e.preventDefault()
          d.search(String(new FormData(e.currentTarget).get('query') ?? ''))
        }}
      >
        <label className="field field-search">
          회원 검색
          <input className="inp" name="query" type="search" autoComplete="off" placeholder="이름·이메일 (비우면 전체)" />
        </label>
        <button className="btn" type="submit">검색</button>
        <button className="btn" type="button" disabled={d.members.isRefreshing} onClick={() => { d.members.retry(); d.balances.retry() }}>목록 새로고침</button>
      </form>
      <LiveState vm={vm} label="회원 목록" state={d.members} />
      {rows === null && <p className="admin-action-error" role="alert">{MEMBER_SEARCH_FORBIDDEN}</p>}
      {rows && <LiveState vm={vm} label="회원별 잔액" state={d.balances} forbidden={CREDITS_FORBIDDEN} />}
      {rows && (rows.length ? <MemberTable rows={rows} d={d} onPick={(row) => { d.pick(row); setPicks((n) => n + 1) }} /> : <p className="admin-empty">조건에 맞는 회원이 없어요.</p>)}
      {d.member && <MemberCredits key={d.member.id} vm={vm} d={d} member={d.member} picks={picks} />}
      <p className="admin-note">
        지급은 ‘운영자 지급’ 크레딧으로 남고 만료는 보상 크레딧과 같아요. 회수는 쓸 수 있는 잔액 안에서만 되고 만료가 가까운 지급분부터 차감돼요.
        네트워크 오류로 결과를 모르면 잔액·내역을 확인한 뒤 다시 시도해 주세요.
      </p>
    </section>
  )
}

function MemberTable({ rows, d, onPick }: { rows: MemberItem[]; d: Credits; onPick: (row: MemberItem) => void }) {
  return (
    <Table label="회원 검색 결과 표" style={{ marginTop: 10 }}>
      <thead>
        <tr>
          <th scope="col">회원</th>
          <th scope="col">역할</th>
          <th scope="col">보유 크레딧</th>
          <th scope="col" className="act act-menu"><span className="sr-only">조치</span></th>
        </tr>
      </thead>
      <tbody>
        {rows.map((u) => (
          <tr key={u.id} className={d.member?.id === u.id ? 'sel' : undefined}>
            <td>
              <b>{u.nickname}</b>
              <br />
              <span className="small muted">{u.email}</span>
            </td>
            <td>{u.role === 'ADMIN' ? '관리자' : '회원'}</td>
            {/* 서버가 모르는 회원은 잔액 결과에서 빠지고, 읽는 중이거나 권한이 없으면 값이 없다. */}
            <td>{d.balances.data?.[u.id] === undefined ? '—' : num(d.balances.data[u.id])}</td>
            <td className="act-menu">
              <PopMenu className="row-menu" label={`「${u.nickname}」 조치`} icon={<MoreVerticalIcon />}>
                <button type="button" role="menuitem" onClick={() => onPick(u)}>크레딧 보기·조정</button>
              </PopMenu>
            </td>
          </tr>
        ))}
      </tbody>
    </Table>
  )
}

/** 고른 회원의 잔액(지급 종류별)·내역과 지급·회수 폼. 회원이 바뀌면 key로 새로 그려 입력·초점이 이어지지 않는다. */
function MemberCredits({ vm, d, member, picks }: { vm: VM; d: Credits; member: MemberItem; picks: number }) {
  const heading = useRef<HTMLHeadingElement>(null)
  // 회원을 고를 때마다(같은 회원을 다시 골라도) 아래 내용이 화면 밖일 수 있어 제목으로 초점을 옮기고, 초점을 받은 제목은 브라우저가 화면 안으로 스크롤한다(PopMenu가 ⋮로 돌린 초점은 이 효과가 마지막에 덮는다).
  useEffect(() => { heading.current?.focus() }, [picks])
  const data = d.credits.data
  return (
    <div className="credit-member">
      <h3 ref={heading} tabIndex={-1}>{member.nickname} 님의 크레딧</h3>
      <p className="small muted">{member.email}</p>
      <LiveState vm={vm} label="크레딧 내역" state={d.credits} />
      {data === null && <p className="admin-action-error" role="alert">{CREDITS_FORBIDDEN}</p>}
      {data && (
        <>
          <div className="kpi">
            <div>
              <small>보유 크레딧</small>
              <b>{num(data.balance.total)}</b>
              <span className="small muted">소멸이 빠른 크레딧부터 쓰여요</span>
            </div>
          </div>
          <Table label="지급분별 잔액 표" style={{ marginTop: 10 }}>
            <thead>
              <tr>
                <th scope="col">종류</th>
                <th scope="col">남은 양</th>
                <th scope="col">소멸 시각</th>
              </tr>
            </thead>
            <tbody>
              {data.balance.items.length
                ? data.balance.items.map((x, i) => (
                  <tr key={`${x.kind}-${x.expiresAt}-${i}`}>
                    <td>{creditKindLabel(x.kind)}</td>
                    <td>{num(x.remaining)}</td>
                    <td className="admin-date">{kstDateTime(x.expiresAt)}</td>
                  </tr>
                ))
                : <tr><td colSpan={3} className="muted">남은 크레딧이 없어요.</td></tr>}
            </tbody>
          </Table>
          <Table label="크레딧 내역 표" style={{ marginTop: 10 }}>
            <thead>
              <tr>
                <th scope="col">일시</th>
                <th scope="col">구분</th>
                <th scope="col">종류</th>
                <th scope="col">변동</th>
              </tr>
            </thead>
            <tbody>
              {data.history.length
                ? data.history.map((x, i) => (
                  <tr key={`${x.occurredAt}-${x.type}-${x.kind}-${i}`}>
                    <td className="admin-date">{kstDateTime(x.occurredAt)}</td>
                    <td>{creditHistoryLabel[x.type]}</td>
                    <td>{creditKindLabel(x.kind)}</td>
                    <td>{creditHistorySign[x.type]}{num(x.amount)}</td>
                  </tr>
                ))
                : <tr><td colSpan={4} className="muted">지급·사용 내역이 없어요.</td></tr>}
            </tbody>
          </Table>
          <ChangeForm vm={vm} d={d} member={member} />
        </>
      )}
    </div>
  )
}

/**
 * 지급·회수 폼. 금액(정수 1~100,000)과 사유(필수 200자)는 브라우저 검사가 먼저 막고, 통과하면 확인 대화를 거쳐 요청한다.
 * 처리 중에는 입력과 두 버튼을 잠그고, 성공하면 입력을 비우며 실패하면 입력을 그대로 두고 이유를 알린다.
 */
function ChangeForm({ vm, d, member }: { vm: VM; d: Credits; member: MemberItem }) {
  const [amount, setAmount] = useState('')
  const [reason, setReason] = useState('')
  const form = useRef<HTMLFormElement>(null)
  const state = vm.actions[creditKey(member.id)]
  const busy = vm.mutationsBlocked || !!state?.pending
  const submit = (kind: CreditChangeKind) => {
    if (!form.current?.reportValidity()) return
    const n = Number(amount)
    const ask = kind === 'grant'
      ? `${member.nickname} 님에게 크레딧 ${num(n)}만큼 지급할까요? 사유는 활동 로그에 남아요.`
      : `${member.nickname} 님의 크레딧 ${num(n)}만큼 회수할까요? 쓸 수 있는 잔액 안에서만 회수되고, 사유는 활동 로그에 남아요.`
    if (!window.confirm(ask)) return
    void d.change(kind, n, reason).then((done) => { if (done) { setAmount(''); setReason('') } })
  }
  return (
    <form ref={form} aria-label="크레딧 지급·회수" onSubmit={(e) => e.preventDefault()}>
      <h4>지급·회수</h4>
      <fieldset disabled={busy} className="form-grid">
        <label className="field">
          금액
          <input
            className="inp"
            name="amount"
            type="number"
            inputMode="numeric"
            min={1}
            max={CREDIT_AMOUNT_MAX}
            step={1}
            required
            placeholder="1~100,000"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
        </label>
        <label className="field wide">
          사유
          <textarea
            className="ta"
            name="reason"
            rows={3}
            required
            maxLength={CREDIT_REASON_MAX}
            placeholder="활동 로그에 남아요 (200자 이하)"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </label>
        <div className="rowend wide">
          <button type="button" className="btn pri" onClick={() => submit('grant')}>지급</button>
          <button type="button" className="btn danger" onClick={() => submit('revoke')}>회수</button>
        </div>
      </fieldset>
      <AdminActionStatus state={state} />
    </form>
  )
}

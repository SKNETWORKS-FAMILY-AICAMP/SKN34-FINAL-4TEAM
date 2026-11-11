import { creditHistoryLabel, creditKindLabel, type CreditHistoryType } from '../../../../domain/entities/creditLedger'
import { openPolicy } from '../../../shared/events'
import { kstDateTime } from '../../../shared/format'
import type { useAccountViewModel } from '../viewmodel/useAccountViewModel'

type VM = ReturnType<typeof useAccountViewModel>
const num = (n: number) => n.toLocaleString('ko-KR')
const SIGN: Record<CreditHistoryType, string> = { grant: '+', spend: '-', expire: '-' }

/** U33 결제 내역: Core 크레딧 원장의 보유 크레딧·소멸 예정·지급/사용/소멸 내역. 결제·충전·구독은 MVP에서 제외라 지급받은 크레딧만 보입니다. */
export function PayView({ vm }: { vm: VM }) {
  const { data, isLoading, isError, retry } = vm.credit
  const next = data?.balance.items[0]
  return <>
    <h2>결제 내역</h2>
    {isLoading && <p role="status">크레딧을 불러오고 있어요.</p>}
    {isError && !data && <div role="alert"><p>크레딧을 불러오지 못했어요. 잠시 후 다시 시도해 주세요.</p><button type="button" className="btn sm" onClick={retry}>다시 불러오기</button></div>}
    {data && <>
      <div className="kpi" style={{ gridTemplateColumns: 'repeat(2,minmax(0,1fr))' }}>
        <div><small>보유 크레딧</small><b>{num(data.balance.total)}</b><span className="small muted">소멸이 빠른 크레딧부터 사용돼요</span></div>
        <div><small>가장 빠른 소멸 예정</small><b>{next ? kstDateTime(next.expiresAt) : '—'}</b><span className="small muted">{next ? `${creditKindLabel(next.kind)} ${num(next.remaining)}` : '소멸 예정인 크레딧이 없어요'}</span></div>
      </div>
      <div className="tcard mecard" style={{ marginTop: 14 }}>
        <h3 className="st">지급·사용·소멸 내역 {data.history.length}</h3>
        {data.history.length
          ? <div className="list">{data.history.map((x, i) => (
            <div className="rp" key={`${x.occurredAt}-${x.type}-${x.kind}-${i}`}>
              <b>{creditHistoryLabel[x.type]} · {creditKindLabel(x.kind)}</b>
              <span> {SIGN[x.type]}{num(x.amount)}</span>
              <small className="muted"> {kstDateTime(x.occurredAt)}</small>
            </div>
          ))}</div>
          : <p className="muted" style={{ padding: '28px 0', textAlign: 'center' }}>지급·사용 내역이 없어요.</p>}
        <div className="policy">결제·충전·구독은 MVP에서 제외돼 지급받은 크레딧(가입 체험·보상·이벤트)만 보여요. <button type="button" className="btn sm" onClick={openPolicy}>정책 안내</button></div>
      </div>
    </>}
  </>
}

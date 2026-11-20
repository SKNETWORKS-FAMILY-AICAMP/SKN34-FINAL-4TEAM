import { exactBytes, formatBytes, storageKinds, storageTotals, type StorageUsage } from '../../../../domain/entities/storageUsage'
import './storageUsage.css'

const labels = { manuscript: '원고', setting: '세계관 설정', manuscript_image: '원고 이미지' }
const count = new Intl.NumberFormat('ko-KR')
const Bytes = ({ bytes, className = '' }: { bytes: number; className?: string }) =>
  <data className={`storage-usage-bytes ${className}`} value={bytes} title={exactBytes(bytes)}>{formatBytes(bytes)}</data>

export function StorageUsageView({ usage }: { usage: StorageUsage }) {
  const { items } = usage
  const { total, byKind } = storageTotals(items)

  return <>
    <h2>저장 공간</h2>
    <div className="tcard mecard storage-usage" data-storage-summary>
      <div className="storage-usage-head"><h3>현재 사용량</h3><Bytes bytes={total} className="storage-usage-total" /></div>
      <p className="muted">원고 본문, 세계관 설정 본문과 저장된 원고 이미지를 합산해요. 과거 버전, 표지, 세계관 첨부, AI 대화 기록은 포함하지 않아요.</p>
      <dl className="storage-usage-breakdown">
        {storageKinds.map((kind) => <div key={kind}>
          <dt>{labels[kind]}</dt><dd><Bytes bytes={byKind[kind]} /></dd>
        </div>)}
      </dl>
    </div>
    <div className="tcard mecard storage-usage">
      <h3 id="storage-items-title">저장 항목 <span className="muted small">{count.format(items.length)}개</span></h3>
      {items.length ? (
        <ul className="storage-usage-items" role="list" aria-labelledby="storage-items-title">
          {items.map((item) => <li key={`${item.kind}:${item.id}`}>
            <div><b>{item.title}</b><small className="muted">{labels[item.kind]} · {item.parentTitle}</small></div>
            <Bytes bytes={item.bytes} />
          </li>)}
        </ul>
      ) : <p className="muted">원고나 세계관 설정을 저장하면 여기에 표시돼요.</p>}
    </div>
  </>
}

import { storageKinds, type StorageUsage } from '../../../../domain/entities/storageUsage'
import './storageUsage.css'

const labels = { manuscript: '원고', setting: '세계관 설정', manuscript_image: '원고 이미지' }
const number = new Intl.NumberFormat('ko-KR')
const formatBytes = (bytes: number) => `${number.format(bytes)} B`

export function StorageUsageView({ usage }: { usage: StorageUsage }) {
  const { items } = usage
  const bytes = { manuscript: usage.manuscriptBytes, setting: usage.settingBytes, manuscript_image: usage.manuscriptImageBytes }

  return <>
    <h2>저장 공간</h2>
    <div className="tcard mecard storage-usage" data-storage-summary>
      <h3>현재 사용량 <strong className="storage-usage-total storage-usage-bytes">{formatBytes(usage.totalBytes)}</strong></h3>
      <p className="muted">현재 원고 본문, 세계관 설정 본문과 저장된 원고 이미지를 합산해요.</p>
      <dl className="storage-usage-breakdown">
        {storageKinds.map((kind) => <div key={kind}>
          <dt>{labels[kind]}</dt><dd className="storage-usage-bytes">{formatBytes(bytes[kind])}</dd>
        </div>)}
      </dl>
    </div>
    <div className="tcard mecard storage-usage">
      <h3 id="storage-items-title">저장 항목 <span className="muted small">{number.format(items.length)}개</span></h3>
      {items.length ? (
        <ul className="storage-usage-items" role="list" aria-labelledby="storage-items-title">
          {items.map((item) => <li key={`${item.kind}:${item.id}`}>
            <div><b>{item.title}</b><small className="muted">{labels[item.kind]} · {item.parentTitle}</small></div>
            <span className="storage-usage-bytes">{formatBytes(item.bytes)}</span>
          </li>)}
        </ul>
      ) : <p className="muted">저장 항목이 없어요.</p>}
    </div>
  </>
}

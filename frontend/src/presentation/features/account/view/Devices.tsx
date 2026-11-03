import { useState } from 'react'
import { useDevicesViewModel } from '../viewmodel/useDevicesViewModel'

function deviceName(raw: string) {
  // ponytail: UA는 간단한 표시용 추정이며 원문은 상세에 보존합니다. 식별 정확도가 필요하면 서버 계약을 확장합니다.
  const browser = /Edg(?:e|A|iOS)?\//.test(raw) ? 'Edge' : /(?:Chrome|Chromium|CriOS)\//.test(raw) ? 'Chrome' : /(?:Firefox|FxiOS)\//.test(raw) ? 'Firefox' : /Safari\//.test(raw) ? 'Safari' : '알 수 없는 브라우저'
  const os = /iPhone|iPad|iPod/.test(raw) ? 'iOS' : /Android/.test(raw) ? 'Android' : /Windows/.test(raw) ? 'Windows' : /Macintosh|Mac OS X/.test(raw) ? 'macOS' : /Linux/.test(raw) ? 'Linux' : '알 수 없는 운영체제'
  return `${browser} · ${os}`
}

export function Devices() {
  const vm = useDevicesViewModel()
  const [confirmAll, setConfirmAll] = useState(false)
  return <section className="tcard mecard" aria-labelledby="devices-title" aria-busy={vm.pending || (!vm.devices && !vm.loadError)}>
    <h3 id="devices-title">로그인 기기</h3>
    {vm.message && <p role={vm.loadError ? 'alert' : 'status'}>{vm.message}</p>}
    {vm.loadError && <button className="btn" type="button" onClick={vm.retry}>기기 목록 다시 시도</button>}
    {vm.devices && <>{vm.devices.length ? <ul className="device-list">{vm.devices.map((device) => {
      const name = deviceName(device.deviceLabel)
      return <li key={device.id} className="rp">
        {device.current && <span className="chip ok">현재 기기</span>}
        <b>{name}</b><p className="small muted">로그인: {new Date(device.createdAt).toLocaleString('ko-KR')}</p>
        <details className="device-details"><summary>기기 상세 정보</summary><p className="small muted" style={{ overflowWrap: 'anywhere' }}>{device.deviceLabel || '기기 정보가 제공되지 않았어요.'}</p></details>
        <button className="btn" type="button" disabled={vm.pending} onClick={() => void vm.revoke(device)} aria-label={device.current ? '이 기기에서 로그아웃' : `${name} 로그아웃`}>{device.current ? '이 기기에서 로그아웃' : '로그아웃'}</button>
      </li>
    })}</ul> : <p>로그인 기기가 없어요.</p>}
    <button className="btn" type="button" disabled={vm.pending || !vm.devices.length} aria-expanded={confirmAll} aria-controls="logout-all-confirmation" onClick={() => setConfirmAll(true)}>모든 기기 로그아웃</button>
    {confirmAll && <div id="logout-all-confirmation" role="group" aria-label="모든 기기 로그아웃 확인">
      <p>이 기기를 포함한 모든 기기에서 로그아웃돼요. 계속할까요?</p>
      <div className="rowend" style={{ flexWrap: 'wrap', marginTop: 12 }}><button className="btn" type="button" disabled={vm.pending} onClick={() => setConfirmAll(false)}>취소</button><button className="btn" type="button" disabled={vm.pending} onClick={() => void vm.revoke()}>모든 기기에서 로그아웃</button></div>
    </div>}</>}
  </section>
}

import { useState } from 'react'
import { Go } from '../../../shared/Go'
import { useEpisodeWorldBasisViewModel } from '../viewmodel/useEpisodeWorldBasisViewModel'

function EpisodeWorldBasisPanel({ workId, number }: { workId: string; number: number }) {
  const vm = useEpisodeWorldBasisViewModel(workId, number)
  const basis = vm.current?.basis
  return <section aria-label="기준 세계관" aria-busy={vm.busy}>
    <h3>{number}화 기준 세계관</h3>
    <p className="small muted">집필 중 참고할 내 세계관의 확정 버전을 선택하세요.</p>
    {vm.current && <p>{basis ? `현재 기준 · ${basis.name} (${basis.revisionNo}번 버전)` : '선택한 기준 세계관이 없어요.'}</p>}
    {basis && <button type="button" className="btn sm" disabled={vm.busy} aria-expanded={vm.cards !== null} onClick={() => void vm.toggleCards()}>
      {vm.cards ? '기준 버전 설정 닫기' : '기준 버전 설정 보기'}
    </button>}
    {vm.cards && (vm.cards.length > 0 ? <ul>{vm.cards.map(card => <li key={card.id}>
      <details><summary>{card.title}</summary><p className="writing-preview">{card.body}</p></details>
    </li>)}</ul> : <p>이 버전에 저장된 인물·설정이 없어요.</p>)}
    {vm.busy && <p role="status">기준 세계관 요청을 처리하고 있어요…</p>}
    {vm.error && <p role="alert">{vm.error}</p>}
    {vm.notice && <p role="status">{vm.notice}</p>}
    <button type="button" className="btn sm" disabled={vm.busy} onClick={() => void vm.reload()}>기준 세계관 다시 불러오기</button>
    {vm.current && (vm.worlds.length === 0 ? <p>소유한 세계관이 없어요. <Go to="/worldstudio">세계관 작업실 열기</Go></p> : <>
      <label className="field">내 세계관
        <select className="inp" disabled={vm.busy} value={vm.worldId} onChange={event => void vm.chooseWorld(event.target.value)}>
          <option value="">세계관 선택</option>
          {vm.worlds.map(world => <option key={world.id} value={world.id}>{world.name}</option>)}
        </select>
      </label>
      {vm.versions && <>
        {vm.versions.length > 0 ? <label className="field">확정 버전
          <select className="inp" disabled={vm.busy} value={vm.revisionId} onChange={event => vm.chooseVersion(event.target.value)}>
            <option value="">버전 선택</option>
            {vm.versions.map(version => <option key={version.revisionId} value={version.revisionId}>
              {version.revisionNo}번 · {version.name} · {new Date(version.createdAt).toLocaleString('ko-KR')}
            </option>)}
          </select>
        </label> : <p>아직 확정한 버전이 없어요.</p>}
        {vm.world?.relationshipStatus === 'current' && <button type="button" className="btn sm" disabled={vm.busy} onClick={() => void vm.confirm()}>
          저장된 인물·설정을 확정 버전으로 만들기
        </button>}
        {vm.world?.relationshipStatus && vm.world.relationshipStatus !== 'current' && <p>이 세계관은 작업실에서 현재 관계 상태를 확인한 뒤 새 버전을 확정할 수 있어요.</p>}
        <button type="button" className="btn pri" disabled={vm.busy || !vm.revisionId || basis?.revisionId === vm.revisionId} onClick={() => void vm.choose()}>
          {basis ? '기준 버전 변경' : '기준 버전 선택'}
        </button>
      </>}
    </>)}
  </section>
}

export function EpisodeWorldBasisControl({ workId, number }: { workId: string; number: number }) {
  const [open, setOpen] = useState(false)
  return <>
    <button type="button" className="btn sm" aria-expanded={open} onClick={() => setOpen(value => !value)}>기준 세계관 관리</button>
    {open && <EpisodeWorldBasisPanel workId={workId} number={number} />}
  </>
}

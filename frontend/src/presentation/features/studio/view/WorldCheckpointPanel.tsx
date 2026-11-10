import { useWorldCheckpointViewModel } from '../viewmodel/useWorldCheckpointViewModel'

export function WorldCheckpointPanel({ workId }: { workId: string }) {
  const vm = useWorldCheckpointViewModel(workId)
  return <section aria-label="세계관 체크포인트" aria-busy={vm.busy}>
    <h3>세계관 체크포인트</h3>
    <p className="small muted">이 작품에 연결된 저장 설정의 현재 내용을 보관해요. 작성 중인 초안과 인물 관계는 제외해요.</p>
    <button type="button" className="btn sm" disabled={vm.busy} onClick={() => void vm.reload()}>목록 다시 불러오기</button>
    <button type="button" className="btn sm" disabled={vm.busy || vm.rows === null} onClick={() => void vm.create()}>현재 저장 설정으로 체크포인트 만들기</button>
    {vm.busy && <p role="status">세계관 체크포인트를 처리하고 있어요…</p>}
    {vm.error && <p role="alert">{vm.error}</p>}
    {vm.notice && <p role="status">{vm.notice}</p>}
    {vm.rows && (vm.rows.length ? <ol>{vm.rows.map(row => <li key={row.id}>
      <button type="button" className="btn sm" disabled={vm.busy} aria-pressed={vm.detail?.id === row.id} onClick={() => void vm.read(row.id)}>
        {new Date(row.createdAt).toLocaleString('ko-KR')} 체크포인트
      </button>
    </li>)}</ol> : <p>저장한 세계관 체크포인트가 없어요.</p>)}
    {vm.detail && <>
      <h4>저장된 설정 {vm.detail.settings.length}개</h4>
      {vm.detail.settings.map(setting => <details key={setting.id}>
        <summary>{setting.name} · {setting.category} · {setting.visibility === 'public' ? '공개' : '비공개'}</summary>
        <p className="writing-preview">{setting.content}</p>
      </details>)}
    </>}
  </section>
}

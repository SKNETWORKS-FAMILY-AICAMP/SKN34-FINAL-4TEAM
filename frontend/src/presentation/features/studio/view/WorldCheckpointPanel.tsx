import { useWorldCheckpointViewModel } from '../viewmodel/useWorldCheckpointViewModel'

// 번호는 시간순(가장 오래된 것이 1)이다. rows가 최신순이라 호출하는 쪽이 `rows.length - index`로 센다.
const title = (number: number, createdAt: string) => `세계관 체크포인트 ${number} · ${new Date(createdAt).toLocaleString('ko-KR')}`

export function WorldCheckpointPanel({ workId }: { workId: string }) {
  const vm = useWorldCheckpointViewModel(workId)
  const { rows, detail } = vm
  return <section className="writing-checkpoints" aria-label="세계관 체크포인트" aria-busy={vm.busy}>
    <h3>세계관 체크포인트</h3>
    <p className="small muted">이 작품에 연결된 저장 설정의 현재 내용을 보관해요. 작성 중인 초안과 인물 관계는 제외하며, 회차의 발행 체크포인트와는 별개예요.</p>
    <div className="writing-checkpoint-actions">
      <button type="button" className="btn sm" disabled={vm.busy} onClick={() => void vm.reload()}>목록 다시 불러오기</button>
      <button type="button" className="btn sm" disabled={vm.busy || rows === null} onClick={() => void vm.create()}>현재 저장 설정으로 체크포인트 만들기</button>
    </div>
    {vm.busy && <p role="status">세계관 체크포인트를 처리하고 있어요…</p>}
    {vm.error && <p className="ep-alert" role="alert">{vm.error}</p>}
    {vm.notice && <p role="status">{vm.notice}</p>}
    {rows && (rows.length ? <ol>{rows.map((row, index) => <li key={row.id}>
      <button type="button" className="btn sm writing-checkpoint-toggle" disabled={vm.busy} aria-expanded={detail?.id === row.id} onClick={() => void vm.toggle(row.id)}>
        {title(rows.length - index, row.createdAt)}
      </button>
    </li>)}</ol> : <p>저장한 세계관 체크포인트가 없어요.</p>)}
    {rows && detail && <>
      <h4>{title(rows.length - rows.findIndex(row => row.id === detail.id), detail.createdAt)} · 저장된 설정 {detail.settings.length}개</h4>
      {detail.settings.map(setting => <details key={setting.id}>
        <summary>{setting.name} · {setting.category} · {setting.visibility === 'public' ? '공개' : '비공개'} · {setting.fromEpisode}화{setting.toEpisode ? `~${setting.toEpisode}화` : '부터'}</summary>
        <p className="writing-preview" tabIndex={0} role="group" aria-label={`${setting.name} 내용`}>{setting.content}</p>
      </details>)}
    </>}
  </section>
}

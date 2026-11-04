import { SettingVersionHistory } from '../../../shared/version-history/SettingVersionHistory'
import { useSettingHistoryViewModel } from '../viewmodel/useSettingHistoryViewModel'

export function SettingHistoryPanel({ workId }: { workId: string }) {
  const vm = useSettingHistoryViewModel(workId)
  return <section className="setting-history-panel" aria-label="설정 버전 이력" aria-busy={vm.busy}>
    <h2>설정 버전 이력</h2>
    <p className="small muted">확정한 설정을 확인하고, 이전 내용을 새 버전으로 복원할 수 있어요.</p>
    {vm.busy && <p role="status">설정 이력을 처리하고 있어요… 닫으면 요청을 중단하지만, 복원이 이미 처리됐을 수 있어요. 다시 열어 결과를 확인해 주세요.</p>}
    {vm.error && <p role="alert">{vm.error}</p>}
    {vm.notice && <p role="status">{vm.notice}</p>}
    <button type="button" className="btn sm" disabled={vm.busy} onClick={() => void vm.reload()}>설정 이력 다시 불러오기</button>
    {vm.world && <>
      {vm.world.mode === 'following' && <p className="small muted">원작 추종 중이에요. 설정을 복원하면 기존 수정 계약에 따라 독립해요.</p>}
      <SettingVersionHistory history={vm.world.history} current={vm.world.settings} busy={vm.busy}
        disabledReason={vm.world.drafts.length || vm.world.draft ? '작성 중인 설정 초안을 먼저 확정해 주세요.' : ''}
        onRestore={(id, versionId) => { void vm.restore(id, versionId) }} />
    </>}
  </section>
}

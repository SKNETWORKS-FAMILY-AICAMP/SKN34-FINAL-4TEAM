import { useManuscriptExportViewModel } from '../viewmodel/useManuscriptExportViewModel'
import './manuscript-export.css'

/** 집필실 원고 내보내기: 서버에 저장된 초안·발행본을 TXT 또는 EPUB 파일로 받는다. */
export function ManuscriptExportPanel({ workId, episode, inherited, disabled = false }: { workId: string; episode: number; inherited: boolean; disabled?: boolean }) {
  const vm = useManuscriptExportViewModel(workId, inherited ? null : episode)
  return (
    <section className="manuscript-export" aria-label="원고 내보내기">
      <h3>원고 내보내기</h3>
      <fieldset disabled={disabled || vm.busy}>
        <legend className="sr-only">내보내기 선택</legend>
        <label className="field">형식<select className="inp sm" value={vm.format} onChange={(e) => vm.setFormat(e.target.value === 'epub' ? 'epub' : 'txt')}><option value="txt">TXT (.txt)</option><option value="epub">EPUB (.epub)</option></select></label>
        <label className="field">범위<select className="inp sm" value={vm.scope} onChange={(e) => vm.setScope(e.target.value === 'work' ? 'work' : 'episode')}><option value="episode" disabled={inherited}>현재 회차</option><option value="work">작품 전체</option></select></label>
        <label className="field">원본<select className="inp sm" value={vm.source} onChange={(e) => vm.setSource(e.target.value === 'published' ? 'published' : 'draft')}><option value="draft">현재 초안</option><option value="published">발행본</option></select></label>
        <button type="button" className="btn sm" onClick={() => void vm.download()}>{vm.busy ? '내보내는 중이에요…' : '내보내기'}</button>
      </fieldset>
      {vm.busy && <button type="button" className="btn sm" onClick={vm.cancel}>내보내기 취소</button>}
      {vm.error && <p role="alert">{vm.error}</p>}
      {vm.notice && <p role="status">{vm.notice}</p>}
      <p className="small muted">서버에 저장된 원고를 내보내요. 입력 중이거나 저장 중에는 잠시 내보낼 수 없고, 자동 저장이 끝난 뒤에 다시 누르면 돼요. TXT는 글만 담고 이미지는 빠져요. EPUB에는 본문 이미지가 들어가요. 회차 메모·설정은 포함하지 않아요.</p>
      {inherited && <p className="small muted">원작 기준 회차는 내보낼 수 없어요. 작품 전체를 내보내면 내가 쓴 회차만 담겨요.</p>}
    </section>
  )
}

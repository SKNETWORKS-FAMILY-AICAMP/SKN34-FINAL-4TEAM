import { writingModeLabels, type WritingMode } from '../../../../domain/entities/operatingSettings'
import type { EpisodeUseCase } from '../../../../domain/usecases/EpisodeUseCase'
import { useWorkSettingsViewModel } from '../viewmodel/useWorkSettingsViewModel'

const dateTime = new Intl.DateTimeFormat('ko-KR', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Seoul' })

export function WorkSettingsPanel({ workId, useCase }: { workId: string; useCase?: EpisodeUseCase }) {
  const vm = useWorkSettingsViewModel(workId, useCase)
  const settings = vm.settings

  return (
    <section className='ep-reading ep-operating-settings'>
      <h2>운영 설정</h2>
      {vm.error && (
        <div className='ep-alert' role='alert'>
          {vm.error}
          <button type='button' className='btn sm' onClick={vm.reload}>최신 설정 불러오기</button>
        </div>
      )}
      {!settings && !vm.error && <p role='status'>운영 설정을 불러오고 있어요…</p>}
      {settings && (
        <>
          <form onSubmit={(event) => { event.preventDefault(); void vm.save() }}>
            <label>
              집필 방식
              <select value={vm.mode} disabled={vm.saving} onChange={(event) => vm.selectMode(event.target.value as WritingMode | '')}>
                {settings.current.writingMode === null && <option value='' disabled>집필 방식 선택</option>}
                <option value='direct'>{writingModeLabels.direct}</option>
                <option value='assisted'>{writingModeLabels.assisted}</option>
              </select>
            </label>
            <div className='ep-form-footer'>
              <span>AI 협업 집필을 저장하면 넓은 화면에서 집필실과 AI 채팅이 함께 열려요.</span>
              <button className='btn pri sm' disabled={!vm.canSave}>{vm.saving ? '저장 중…' : '집필 방식 저장'}</button>
            </div>
          </form>
          {vm.notice && <p role='status'>{vm.notice}</p>}
          <h3>자동 처리</h3>
          <dl className='ep-settings-rules'>
            <dt>설정 추출</dt><dd>수동</dd>
            <dt>표기 교정</dt><dd>작가 검토</dd>
            <dt>AI 자율 연재</dt><dd>꺼짐</dd>
          </dl>
          <h3>설정 변경 이력</h3>
          {settings.history.length ? (
            <ul className='ep-settings-history'>
              {settings.history.map(({ revision, writingMode, changedAt }) => (
                <li key={revision}><strong>{writingModeLabels[writingMode]}</strong><time dateTime={changedAt}>{dateTime.format(new Date(changedAt))}</time></li>
              ))}
            </ul>
          ) : <p>저장한 집필 방식이 아직 없어요.</p>}
        </>
      )}
    </section>
  )
}

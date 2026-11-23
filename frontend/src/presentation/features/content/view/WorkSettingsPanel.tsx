import { useId } from 'react'
import { writingModeLabels, type WritingMode } from '../../../../domain/entities/operatingSettings'
import type { EpisodeUseCase } from '../../../../domain/usecases/EpisodeUseCase'
import { Sheet } from '../../../shared/Sheet'
import { useWorkSettingsViewModel } from '../viewmodel/useWorkSettingsViewModel'

const dateTime = new Intl.DateTimeFormat('ko-KR', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Seoul' })

const AUTONOMOUS_TITLE = 'AI 자율 집필로 저장할까요?'

/**
 * AI 자율 집필을 새로 저장할 때의 경고 확인 대화 상자(계약 'AI 자율 집필 선택 경고'): 회차 집필이 연결된 세계관의 인물 카드로 인물 시뮬레이션을 돌리므로 세계관 연결과 인물 카드 작성을 안내하고, 없으면 회차 실행이 실패한다고 알린다. 경고일 뿐 저장을 막지 않는다(서버 검사 없음).
 * 처음 초점은 저장이 아닌 안전한 세계관·설정집으로에 두고(Enter를 한 번 더 눌러도 저장되지 않는다), 호출 측이 이동을 잠갔으면(onOpenWorld 없음) 그 버튼도 잠그고 첫 버튼(취소)이 초점을 받는다.
 */
function AutonomousWarning({ onOpenWorld, onProceed, onCancel }: { onOpenWorld?: () => void; onProceed: () => void; onCancel: () => void }) {
  const message = useId()
  return (
    <Sheet sid='U25' label={AUTONOMOUS_TITLE} role='alertdialog' describedBy={message} onClose={onCancel}>
      <h3>{AUTONOMOUS_TITLE}</h3>
      <p id={message}>AI 자율 집필은 연결된 세계관의 인물 카드로 인물 시뮬레이션을 돌려 회차를 씁니다. 세계관을 연결하고 인물 카드(성격·말투·목표·관계)를 꼭 작성해 주세요. 없으면 회차 실행이 실패해요.</p>
      <div className='rowend'>
        <button type='button' className='btn' onClick={onCancel}>취소</button>
        <button type='button' className='btn' onClick={onProceed}>계속 저장</button>
        <button type='button' className='btn pri' disabled={!onOpenWorld} data-autofocus={onOpenWorld ? '' : undefined} onClick={onOpenWorld}>세계관·설정집으로</button>
      </div>
    </Sheet>
  )
}

/**
 * 운영 설정 탭의 집필 방식·자동 처리·설정 변경 이력 카드(분기 정책·포크 정보 카드와 같은 틀). 탭 제목(h2 '운영 설정')은 호출 측(WorkManagement)이 그린다: 서버 없는 시연에서는 이 패널 없이 제목만 남는다.
 * 바깥 껍데기(.ep-operating-settings)는 카드가 아니라 알림·불러오는 중을 담는 틀이다: 호출 측의 카드 격자(.ep-settings-cards)에서는 display:contents로 격자에 끼지 않는다.
 * 집필 방식 카드의 보이는 제목은 카드 머리(h3)이고, select의 라벨은 같은 글을 되풀이하지 않게 숨겨(sr-only) 접근 이름만 유지한다.
 * 자동 처리의 AI 자율 연재는 저장된 집필 방식이 AI 자율 집필이면 켜짐, 아니면 꺼짐이다(고르기만 하고 저장하지 않은 select 값은 보지 않는다).
 * onOpenWorld는 AI 자율 집필 경고의 '세계관·설정집으로'가 부른다(작품 관리의 세계관·설정집 탭으로 옮긴다). 주지 않으면 그 버튼은 잠긴다.
 */
export function WorkSettingsPanel({ workId, useCase, onSaved, onOpenWorld }: { workId: string; useCase?: EpisodeUseCase; onSaved?: () => void; onOpenWorld?: () => void }) {
  const vm = useWorkSettingsViewModel(workId, useCase, onSaved)
  const settings = vm.settings
  const reason = useId()
  // 세 카드(집필 방식·자동 처리·설정 변경 이력)의 제목 id. 카드는 제목으로 이름 붙은 region이다(분기 정책·포크 정보 카드와 같은 틀).
  const modeTitle = useId()
  const autoTitle = useId()
  const historyTitle = useId()
  // 저장 버튼이 잠긴 이유를 버튼 옆에 보인다. 고른 집필 방식이 없을 때만이다: 저장한 값과 같아 잠긴 때는 이미 저장된 상태가 읽혀 같은 말을 되풀이하지 않는다.
  const why = vm.mode ? '' : '집필 방식을 먼저 선택해 주세요.'

  return (
    <section className='ep-reading ep-operating-settings'>
      {vm.error && (
        <div className='ep-alert' role='alert'>
          {vm.error}
          <button type='button' className='btn sm' onClick={vm.reload}>최신 설정 불러오기</button>
        </div>
      )}
      {!settings && !vm.error && <p role='status'>운영 설정을 불러오고 있어요…</p>}
      {settings && (
        <>
          <section className='tcard ep-card' aria-labelledby={modeTitle}>
            <div className='ep-sec-head'><h3 id={modeTitle}>집필 방식</h3></div>
            <form onSubmit={(event) => { event.preventDefault(); void vm.save() }}>
              <label>
                <span className='sr-only'>집필 방식</span>
                <select value={vm.mode} disabled={vm.saving} onChange={(event) => vm.selectMode(event.target.value as WritingMode | '')}>
                  {settings.current.writingMode === null && <option value='' disabled>집필 방식 선택</option>}
                  <option value='direct'>{writingModeLabels.direct}</option>
                  <option value='assisted'>{writingModeLabels.assisted}</option>
                  <option value='autonomous'>{writingModeLabels.autonomous}</option>
                </select>
              </label>
              <div className='ep-form-footer'>
                <span>AI 협업 집필을 저장하면 넓은 화면에서 집필실과 AI 채팅이 함께 열려요.</span>
                <span>AI 자율 집필을 저장하면 1화 발행 뒤 독자 투표와 제안을 모아 AI가 다음 회차를 씁니다. 그동안 1화만 직접 쓸 수 있어요.</span>
                <div className='ep-form-actions'>
                  <button className='btn pri sm' disabled={!vm.canSave} aria-describedby={why ? reason : undefined}>{vm.saving ? '저장 중…' : '집필 방식 저장'}</button>
                  {why && <span id={reason} className='small muted'>{why}</span>}
                </div>
              </div>
            </form>
            {vm.notice && <p role='status'>{vm.notice}</p>}
          </section>
          {vm.confirming && <AutonomousWarning onOpenWorld={onOpenWorld && (() => { vm.cancelConfirm(); onOpenWorld() })} onProceed={() => void vm.confirmSave()} onCancel={vm.cancelConfirm} />}
          <section className='tcard ep-card' aria-labelledby={autoTitle}>
            <div className='ep-sec-head'><h3 id={autoTitle}>자동 처리</h3></div>
            <dl className='ep-facts'>
              <div><dt>설정 추출</dt><dd>수동</dd></div>
              <div><dt>표기 교정</dt><dd>작가 검토</dd></div>
              <div><dt>AI 자율 연재</dt><dd>{settings.current.writingMode === 'autonomous' ? '켜짐' : '꺼짐'}</dd></div>
            </dl>
          </section>
          <section className='tcard ep-card' aria-labelledby={historyTitle}>
            <div className='ep-sec-head'><h3 id={historyTitle}>설정 변경 이력</h3></div>
            {settings.history.length ? (
              <ul className='ep-settings-history'>
                {settings.history.map(({ revision, writingMode, changedAt }) => (
                  <li key={revision}><strong>{writingModeLabels[writingMode]}</strong><time dateTime={changedAt}>{dateTime.format(new Date(changedAt))}</time></li>
                ))}
              </ul>
            ) : <p>저장한 집필 방식이 아직 없어요.</p>}
          </section>
        </>
      )}
    </section>
  )
}

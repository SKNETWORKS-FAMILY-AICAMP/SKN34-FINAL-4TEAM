import { useId } from 'react'

import { BOARD_STATUS, SERIAL_DAYS, SERIAL_DIRECTION_MAX } from '../../../../domain/entities/aiSerial'
import type { SerialUseCase } from '../../../../domain/usecases/SerialUseCase'
import { kstDateTime } from '../../../shared/format'
import { useAiSerialViewModel } from '../viewmodel/useAiSerialViewModel'
import './ai-serial.css'

/**
 * 작품 관리 'AI 집필' 탭([계약](../../../../../../docs/design/ai-serial-contract.md)): 켜기·요일·시각(한국시간)·연재 방향 저장, 지금 마감·실행, 게시판 기록 표.
 * 탭 제목(h2 'AI 집필')은 호출 측(WorkManagement)이 그린다. 서버가 없는 시연(목업)에서는 호출 측이 이 패널을 그리지 않는다.
 * 설정·기록·실행 결과는 모두 서버 응답 그대로이고, 저장·실행의 거절은 서버 문구(또는 코드별 고정 문구)로 알린다.
 */
export function AiSerialPanel({ workId, useCase, onSaved }: { workId: string; useCase?: SerialUseCase; onSaved?: () => void }) {
  const vm = useAiSerialViewModel(workId, useCase, onSaved)
  const { form, boards } = vm
  const saveWhy = useId()
  const offWhy = useId()
  const runWhy = useId()
  const tableTitle = useId()
  return (
    <section className='ep-reading ep-serial'>
      <p className='ep-lead'>
        AI 집필을 켜면 회차마다 독자 의견 게시판이 열려요. 정한 요일·시각(한국시간)에 게시판이 마감되고, 득표 상위 3개 의견을 모아 AI가 다음 회차를 쓰고 검수한 뒤 자동으로 발행해요.
        1화는 직접 써서 발행해 주세요. AI가 회차를 쓸 때는 작품 소유자의 크레딧이 차감되고, 실패하면 차감되지 않아요.
      </p>
      {vm.loadError && (
        <div className='ep-alert' role='alert'>
          {vm.loadError}
          <button type='button' className='btn sm' onClick={vm.reload}>다시 불러오기</button>
        </div>
      )}
      {!form && !vm.loadError && <p role='status'>AI 집필 설정을 불러오고 있어요…</p>}
      {form && (
        <>
          <form onSubmit={(event) => { event.preventDefault(); void vm.save() }}>
            <label className='ep-check'>
              <input type='checkbox' checked={form.enabled} disabled={vm.saving || (!!vm.offBlock && form.enabled)} aria-describedby={vm.offBlock ? offWhy : undefined} onChange={(event) => vm.edit({ enabled: event.target.checked })} /> AI 집필 켜기
            </label>
            {vm.offBlock && <p id={offWhy} className='small muted'>{vm.offBlock}</p>}
            <fieldset disabled={vm.saving}>
              <legend>연재 요일</legend>
              {SERIAL_DAYS.map(([day, name]) => (
                <label key={day} className='ep-check'>
                  <input type='checkbox' checked={form.days.includes(day)} onChange={() => vm.toggleDay(day)} /> {name}
                </label>
              ))}
            </fieldset>
            <label>
              연재 시각 (한국시간, 하루 한 번)
              <input type='time' value={form.time} disabled={vm.saving} onChange={(event) => vm.edit({ time: event.target.value })} />
            </label>
            <label>
              연재 방향 <span className='ep-optional'>선택</span>
              <textarea rows={4} maxLength={SERIAL_DIRECTION_MAX} value={form.direction} disabled={vm.saving} placeholder='예: 밝고 가벼운 분위기로, 주인공의 성장에 집중해 주세요' onChange={(event) => vm.edit({ direction: event.target.value })} />
            </label>
            <div className='ep-form-footer'>
              <span>저장한 값은 다음 마감부터 적용돼요.</span>
              <div className='ep-form-actions'>
                <button className='btn pri sm' disabled={!vm.canSave} aria-describedby={vm.formError ? saveWhy : undefined}>{vm.saving ? '저장 중…' : '설정 저장'}</button>
                {vm.formError && <span id={saveWhy} className='small muted'>{vm.formError}</span>}
              </div>
            </div>
          </form>
          {vm.notice?.ok && <p role='status'>{vm.notice.text}</p>}
          {vm.notice && !vm.notice.ok && <div className='ep-alert' role='alert'>{vm.notice.text}</div>}
          <h3 id={tableTitle}>게시판 기록</h3>
          <div className='ep-form-actions'>
            <button type='button' className='btn pri sm' disabled={!!vm.runBlock || vm.running} aria-describedby={vm.runBlock ? runWhy : undefined} onClick={() => void vm.run()}>{vm.running ? '요청 중…' : '지금 마감·실행'}</button>
            <button type='button' className='btn sm' onClick={() => void vm.refreshBoards()}>기록 새로 고침</button>
            {vm.runBlock && <span id={runWhy} className='small muted'>{vm.runBlock}</span>}
          </div>
          {vm.boardsError && <div className='ep-alert' role='alert'>{vm.boardsError}</div>}
          {!boards && !vm.boardsError && <p role='status'>기록을 불러오고 있어요…</p>}
          {boards?.length === 0 && <p>아직 게시판 기록이 없어요. 1화를 발행하고 AI 집필을 켜면 게시판이 열려요.</p>}
          {!!boards?.length && (
            <div className='ep-serial-scroll' role='region' aria-labelledby={tableTitle} tabIndex={0}>
              <table className='ep-serial-table'>
                <thead>
                  <tr><th>대상 회차</th><th>상태</th><th>발행 회차</th><th>실패 사유</th><th>마감 시각</th></tr>
                </thead>
                <tbody>
                  {boards.map((board) => (
                    <tr key={board.id}>
                      <td>{board.episodeNumber}화</td>
                      <td data-status={board.status}>{BOARD_STATUS[board.status]}</td>
                      <td>{board.publishedEpisodeNumber ? board.publishedEpisodeNumber + '화' : '—'}</td>
                      <td>{board.failureReason ?? '—'}</td>
                      <td>{board.closedAt ? kstDateTime(board.closedAt) : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </section>
  )
}

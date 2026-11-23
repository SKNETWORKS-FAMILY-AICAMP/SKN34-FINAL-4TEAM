import { useId, type KeyboardEvent } from 'react'

import { BOARD_STATUS, SERIAL_DAYS, SERIAL_DIRECTION_MAX } from '../../../../domain/entities/aiSerial'
import type { SerialUseCase } from '../../../../domain/usecases/SerialUseCase'
import { kstDateTime } from '../../../shared/format'
import { useAiSerialViewModel } from '../viewmodel/useAiSerialViewModel'
import './ai-serial.css'

const SUBS = [['settings', '연재 설정'], ['history', '게시판 기록']] as const

/**
 * 작품 관리 'AI 집필' 탭([계약](../../../../../../docs/design/ai-serial-contract.md)): 하위 탭 '연재 설정'(요일·시각(한국시간)·연재 방향 저장)과
 * '게시판 기록'(지금 마감·실행, 기록 새로 고침, 기록 표). 켜기·끄기는 이 탭이 아니라 운영 설정의 집필 방식(AI 자율 집필)이 한다: 꺼져 있으면 그 길을 안내한다.
 * 탭 제목(h2 'AI 집필')은 호출 측(WorkManagement)이 그린다. 서버가 없는 시연(목업)에서는 호출 측이 이 패널을 그리지 않는다.
 * 설정·기록·실행 결과는 모두 서버 응답 그대로이고(기록의 실패 사유도 서버 문구 그대로), 저장·실행의 거절은 서버 문구(또는 코드별 고정 문구)로 알린다.
 */
export function AiSerialPanel({ workId, useCase }: { workId: string; useCase?: SerialUseCase }) {
  const vm = useAiSerialViewModel(workId, useCase)
  const { form, boards } = vm
  const saveWhy = useId()
  const runWhy = useId()
  /** 하위 탭의 방향키·Home·End로 탭을 옮긴다(소설 상세 탭과 같은 키 동작). 선택한 탭만 Tab 순서에 들어간다. */
  const moveSub = (event: KeyboardEvent) => {
    const i = SUBS.findIndex(([k]) => k === vm.sub)
    const to = event.key === 'ArrowRight' ? i + 1 : event.key === 'ArrowLeft' ? i - 1 : event.key === 'Home' ? 0 : event.key === 'End' ? SUBS.length - 1 : null
    if (to === null) return
    event.preventDefault()
    const next = SUBS[(to + SUBS.length) % SUBS.length][0]
    vm.setSub(next)
    document.getElementById('ai-stab-' + next)?.focus()
  }
  return (
    <section className='ep-reading ep-serial'>
      <p className='ep-lead'>
        운영 설정 &gt; 집필 방식에서 AI 자율 집필을 고르면 1화 발행 뒤 회차마다 "다음 회차" 게시판이 열려요. AI가 다음 전개 4지선다를 만들어 독자 투표를 받고, 독자는 제안 게시판에 글을 써요.
        정한 요일·시각(한국시간)에 게시판이 마감되면 1위 선택지와 추천 많은 제안 글로 AI가 다음 회차를 쓰고 검수한 뒤 자동으로 발행해요.
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
          <div className='libtabs' role='tablist' aria-label='AI 집필 하위 탭' onKeyDown={moveSub}>
            {SUBS.map(([k, label]) => (
              <button key={k} type='button' role='tab' id={'ai-stab-' + k} aria-selected={vm.sub === k} aria-controls='ai-spanel' tabIndex={vm.sub === k ? 0 : -1} className={vm.sub === k ? 'on' : ''} onClick={() => vm.setSub(k)}>{label}</button>
            ))}
          </div>
          <div id='ai-spanel' role='tabpanel' aria-labelledby={'ai-stab-' + vm.sub}>
            {vm.notice?.ok && <p role='status'>{vm.notice.text}</p>}
            {vm.notice && !vm.notice.ok && <div className='ep-alert' role='alert'>{vm.notice.text}</div>}
            {vm.sub === 'settings'
              ? (
                <>
                  {!form.enabled && <p className='ep-alert ep-changed'>운영 설정 &gt; 집필 방식에서 AI 자율 집필을 고르면 켜져요.</p>}
                  <form onSubmit={(event) => { event.preventDefault(); void vm.save() }}>
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
                </>
              )
              : (
                <>
                  <div className='ep-form-actions'>
                    <button type='button' className='btn pri sm' disabled={!!vm.runBlock || vm.running} aria-describedby={vm.runBlock ? runWhy : undefined} onClick={() => void vm.run()}>{vm.running ? '요청 중…' : '지금 마감·실행'}</button>
                    <button type='button' className='btn sm' onClick={() => void vm.refreshBoards()}>기록 새로 고침</button>
                    {vm.runBlock && <span id={runWhy} className='small muted'>{vm.runBlock}</span>}
                  </div>
                  {vm.boardsError && <div className='ep-alert' role='alert'>{vm.boardsError}</div>}
                  {!boards && !vm.boardsError && <p role='status'>기록을 불러오고 있어요…</p>}
                  {boards?.length === 0 && <p>아직 게시판 기록이 없어요. AI 자율 집필을 켠 뒤 1화를 발행하면 2화 게시판이 열려요.</p>}
                  {!!boards?.length && (
                    <div className='ep-serial-scroll' role='region' aria-labelledby='ai-stab-history' tabIndex={0}>
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
          </div>
        </>
      )}
    </section>
  )
}

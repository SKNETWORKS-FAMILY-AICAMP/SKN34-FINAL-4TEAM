import { useState } from 'react'
import type { World } from '../../../../domain/entities/content'
import type { EpisodeUseCase } from '../../../../domain/usecases/EpisodeUseCase'
import { MediaPanel } from '../../../shared/media/MediaPanel'
import { useWorldViewModel } from '../viewmodel/useWorldViewModel'

/**
 * 세계관·설정집 탭의 설정집 요약: 작품 설정집의 이름·상태·최초 분기 기준과, 그 아래 설정 첨부(참고 파일·설정 이미지)를 보여 준다.
 * 설정 항목 편집·원작 변경 반영·버전 복원은 이 화면에서 하지 않는다. 내 세계관(WorldStudio)과의 연결은 같은 탭의 `LinkedWorldPanel`이 맡는다.
 * ponytail: 설정집 읽기는 useWorldViewModel을 그대로 쓴다.
 */
export function WorldPanel({ workId, useCase, locked = false, onMediaBusy }: { workId: string; useCase?: EpisodeUseCase; locked?: boolean; onMediaBusy?: (busy: boolean) => void }) {
  const vm = useWorldViewModel(workId, useCase)
  const w = vm.world
  if (!w) {
    return (
      <section className='ep-card'>
        <p role={vm.error ? 'alert' : 'status'} className={vm.error ? 'ep-alert' : undefined}>{vm.error || '설정집을 불러오고 있어요…'}</p>
        {vm.error && (
          <div className='ep-card-actions'>
            <button type='button' className='btn sm' disabled={vm.busy} onClick={vm.reload}>설정집 다시 불러오기</button>
          </div>
        )}
      </section>
    )
  }
  return (
    <>
      <section className='ep-card' aria-label='세계관 설정집'>
        <h2>{w.name}</h2>
        <p>
          {w.mode === 'following'
            ? '원작 추종 중 · 첫 설정 수정 시 전체 공개 설정이 독립해요.'
            : w.mode === 'independent'
            ? '독립 세계관 · 원작 변경은 선택해서 반영해요.'
            : '내 작품의 세계관 · 확정 설정만 문맥에 사용해요.'}
        </p>
        {w.basis && <p>{`최초 분기 기준: ${w.basis.episode}화 · 원고 버전 ${w.basis.version} · 설정 ${w.basis.settings.length}개`}</p>}
      </section>
      <SettingFiles workId={workId} world={w} locked={locked} onBusy={onMediaBusy} />
    </>
  )
}

/**
 * 설정 첨부(참고 파일·설정 이미지): 확정했거나 저장한 초안인 설정 하나를 골라 그 설정의 첨부를 올리고 내려받고 이름을 바꾸고 지운다.
 * 원작을 따라가는 설정집은 내 설정이 없어 붙일 수 없고, 설정이 없으면 빈 상태를 알린다.
 */
function SettingFiles({ workId, world: w, locked, onBusy }: { workId: string; world: World; locked: boolean; onBusy?: (busy: boolean) => void }) {
  const rows = [...w.settings, ...w.drafts.filter((draft) => !w.settings.some((setting) => setting.id === draft.id))]
  const [picked, setPicked] = useState('')
  const row = rows.find((setting) => setting.id === picked) ?? rows[0]
  return (
    <section className='ep-card' aria-label='설정 첨부'>
      <h2>설정 첨부 파일</h2>
      {w.mode === 'following'
        ? <p className='ep-muted'>원작을 따라가는 설정에는 파일을 붙일 수 없어요.</p>
        : !row
        ? <p className='ep-muted'>첨부할 설정이 아직 없어요.</p>
        : (
          <>
            <label>
              첨부할 설정
              <select value={row.id} disabled={locked} onChange={(e) => setPicked(e.target.value)}>
                {rows.map((setting) => <option key={setting.id} value={setting.id}>{setting.name}</option>)}
              </select>
            </label>
            <MediaPanel key={row.id} target={{ kind: 'setting', workId, settingId: row.id }} onBusy={onBusy} disabled={locked} />
          </>
        )}
    </section>
  )
}

import { useState } from 'react'
import { useNavigate } from 'react-router'
import type { World } from '../../../../domain/entities/content'
import type { EpisodeUseCase } from '../../../../domain/usecases/EpisodeUseCase'
import { Go } from '../../../shared/Go'
import { MediaPanel } from '../../../shared/media/MediaPanel'
import { useWorldViewModel } from '../viewmodel/useWorldViewModel'

type Props = {
  workId: string
  useCase?: EpisodeUseCase
  locked?: boolean
  onMediaBusy?: (busy: boolean) => void
  /** 이 소설에 연결된 내 세계관(WorldStudio) id다. 독립해 연결된 설정집은 설정 카드를 고치는 그 세계관을 안내한다. */
  linkedWorldId?: string | null
  /** 따라가던 설정을 내 세계관의 카드로 복사해 독립한다(#737). 새 세계관 id를 돌려주면(취소·실패는 null) 그 관리 화면으로 간다. 주면 원작을 따라가는 설정집에 `내 세계관으로 만들어 수정하기`를 보인다. */
  onDetach?: () => Promise<string | null>
  /** 이 화면에서 보낸 독립 요청의 실패 사유(독립 버튼 아래에 보인다) */
  detachError?: string
}

/**
 * 세계관·설정집 탭의 설정집 요약: 작품 설정집의 이름·상태·최초 분기 기준과, 그 아래 설정 첨부(참고 파일·설정 이미지)를 보여 준다.
 * 설정 항목 편집·원작 변경 반영·버전 복원은 이 화면에서 하지 않는다. 내 세계관(WorldStudio)과의 연결은 같은 탭의 `LinkedWorldPanel`이 맡는다.
 * 옛 작품 설정집 방식 Fork(원작을 따라가고 따라가던 설정이 있음)는 `내 세계관으로 만들어 수정하기`로 그 공개 설정 전체를 내 세계관의 카드로 복사해 독립하고(#737) 새 세계관 관리 화면으로 간다.
 * 원작에 세계관이 있는 Fork는 `LinkedWorldPanel`의 이어받는 세계관 카드가 같은 일을 하고, 독립해 세계관이 연결되면 옛 설정집에는 설정이 남지 않으므로 그 세계관을 안내한다.
 * ponytail: 설정집 읽기는 useWorldViewModel을 그대로 쓴다. 원작에 옛 설정과 세계관이 모두 있는 Fork는 두 카드에 같은 버튼이 보인다(서버는 세계관 이어받기가 우선이다).
 */
export function WorldPanel({ workId, useCase, locked = false, onMediaBusy, linkedWorldId, onDetach, detachError }: Props) {
  const vm = useWorldViewModel(workId, useCase)
  const navigate = useNavigate()
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
  const canDetach = !!onDetach && w.mode === 'following' && w.settings.length > 0
  const detach = async () => {
    const id = await onDetach?.()
    if (id) navigate('/worldstudio/' + id)
  }
  return (
    <>
      <section className='ep-card' aria-label='세계관 설정집'>
        <h3>{w.name}</h3>
        <p>
          {w.mode === 'following'
            ? '원작 추종 중 · 내 세계관으로 만들어 수정하면 공개 설정 전체가 내 세계관의 카드로 복사되어 독립해요.'
            : w.mode === 'independent'
            ? '독립 세계관 · 원작이 바뀌어도 따라오지 않아요.'
            : '내 작품의 세계관 · 확정 설정만 문맥에 사용해요.'}
        </p>
        {w.mode === 'independent' && linkedWorldId && <p>설정 카드는 연결된 세계관에서 보고 고쳐요. <Go to={`/worldstudio/${linkedWorldId}`}>연결된 세계관 열기</Go></p>}
        {w.basis && <p>{`최초 분기 기준: ${w.basis.episode}화 · 원고 버전 ${w.basis.version} · 설정 ${w.basis.settings.length}개`}</p>}
        {canDetach && (
          <>
            <div className='ep-card-actions'>
              <button type='button' className='btn pri sm' disabled={locked} onClick={detach}>내 세계관으로 만들어 수정하기</button>
            </div>
            {detachError && <p className='ep-alert' role='alert'>{detachError}</p>}
          </>
        )}
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
      <h3>설정 첨부 파일</h3>
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

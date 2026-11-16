import { PUBLIC_WORLD_GENRES } from '../../../../domain/entities/publicWorld'
import type { WorldPublicationInput, WorldVisibility } from '../../../../domain/entities/studioWorld'
import { genreLabel, UNSET_GENRE } from '../../../shared/worldGenres'
import { publicCardCount, publishAllCards } from '../viewmodel/cardVisibility'
import type { useWorldStudioViewModel } from '../viewmodel/useWorldStudioViewModel'

/**
 * 세계관 단위 공개 범위(비공개/공개) 토글과 장르 선택. 값과 변경은 부르는 쪽이 정한다:
 * 작성 모드의 기본 정보 단계는 바꾸는 즉시 적용하고, 관리 모드의 정보 편집 패널은 저장할 때 적용한다.
 */
export function PublishFields({ value, onChange }: { value: WorldPublicationInput; onChange: (change: Partial<WorldPublicationInput>) => void }) {
  return (
    <>
      <div className="field">
        공개 범위
        <div className="seg" role="group" aria-label="공개 범위">
          {(['private', 'public'] as const).map((visibility) => (
            <button key={visibility} type="button" className={value.visibility === visibility ? 'on' : ''} aria-pressed={value.visibility === visibility} onClick={() => onChange({ visibility })}>{visibility === 'public' ? '공개' : '비공개'}</button>
          ))}
        </div>
      </div>
      <label className="field">
        장르
        <select className="inp" value={value.genre ?? ''} onChange={(e) => onChange({ genre: PUBLIC_WORLD_GENRES.find((code) => code === e.target.value) ?? null })}>
          <option value="">{UNSET_GENRE}</option>
          {PUBLIC_WORLD_GENRES.map((code) => <option key={code} value={code}>{genreLabel(code)}</option>)}
        </select>
      </label>
    </>
  )
}

/**
 * 공개 세계관(또는 공개로 바꾸려는 세계관)인데 초안에 공개로 둔 설정이 하나도 없을 때의 경고와 `전체 공개`. 공개 세계관 화면에는 공개 카드만 보이므로(DEC-46) 이대로면 설정이 하나도 보이지 않는다.
 * 관리 헤더(공개 세계관), 정보 편집 패널(고른 공개 범위), 작성 모드 공개 설정이 함께 쓴다. 공개 설정 자체는 막지 않는다.
 * `전체 공개`는 설정집의 카드를 모두 공개로 바꾸는 초안 변경이라 세계관 저장과 확정 버전을 거쳐야 공개 화면에 반영된다(집필 메모·관계는 건드리지 않는다).
 */
export function PublicCardsNotice({ vm, visibility }: { vm: ReturnType<typeof useWorldStudioViewModel>; visibility: WorldVisibility }) {
  const settings = vm.editing?.settings ?? []
  if (visibility !== 'public' || publicCardCount(settings) > 0) return null
  const all = publishAllCards(settings)
  return (
    <p role="status" className="world-notice">
      <span>공개로 둔 설정이 없어요. 세계관을 공개해도 공개 화면에는 설정이 보이지 않아요.</span>
      {all !== settings && <button type="button" className="btn sm" disabled={vm.busy} onClick={() => vm.patch({ settings: all })}>전체 공개</button>}
    </p>
  )
}

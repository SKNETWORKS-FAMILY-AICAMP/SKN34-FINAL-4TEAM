import { PUBLIC_WORLD_GENRES } from '../../../../domain/entities/publicWorld'
import type { WorldPublicationInput } from '../../../../domain/entities/studioWorld'
import { genreLabel, UNSET_GENRE } from '../../../shared/worldGenres'

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

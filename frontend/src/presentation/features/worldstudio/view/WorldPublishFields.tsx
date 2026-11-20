import { genreNameOf } from '../../../../domain/entities/genre'
import type { WorldPublicationInput, WorldVisibility } from '../../../../domain/entities/studioWorld'
import { useGenres } from '../../../shared/useGenres'
import { UNSET_GENRE } from '../../../shared/worldGenres'
import { publicCardCount, publishAllCards } from '../viewmodel/cardVisibility'
import type { useWorldStudioViewModel } from '../viewmodel/useWorldStudioViewModel'

/**
 * 세계관 단위 공개 범위(비공개/공개) 토글과 장르 선택. 값과 변경은 부르는 쪽이 정한다:
 * 작성 모드의 기본 정보 단계는 바꾸는 즉시 적용하고, 관리 모드의 정보 편집 패널은 저장할 때 적용한다.
 * 장르 선택지는 운영이 관리하는 공개 장르 목록(활성 장르, DEC-56)이다. 읽지 못하면 빈 목록으로 채우지 않고 실패와 다시 불러오기를 보이며 읽는 동안·실패했을 때는 선택을 잠근다.
 * 이미 숨긴 장르가 붙은 세계관은 이름을 알 수 없어 '미지정'처럼 보이지만 값은 바꾸지 않는 한 그대로 저장된다.
 */
export function PublishFields({ value, onChange }: { value: WorldPublicationInput; onChange: (change: Partial<WorldPublicationInput>) => void }) {
  const genres = useGenres()
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
        <select className="inp" value={value.genre ?? ''} disabled={!genres.data} onChange={(e) => onChange({ genre: genres.data?.find((genre) => genre.code === e.target.value)?.code ?? null })}>
          <option value="">{UNSET_GENRE}</option>
          {(genres.data ?? []).map((genre) => <option key={genre.code} value={genre.code}>{genre.name}</option>)}
        </select>
      </label>
      {genres.isError && !genres.data && <p role="alert" className="world-notice"><span>장르 목록을 불러오지 못했어요.</span><button type="button" className="btn sm" onClick={genres.retry}>다시 불러오기</button></p>}
    </>
  )
}

/**
 * 공개 세계관(또는 공개로 바꾸려는 세계관)인데 초안에 공개로 둔 설정이 하나도 없을 때의 경고와 `전체 공개`. 공개 세계관 화면에는 공개된 카드만 보이므로(DEC-46·53) 이대로면 설정이 하나도 보이지 않는다.
 * 관리 헤더(공개 세계관), 정보 편집 패널(고른 공개 범위), 작성 모드 공개 설정이 함께 쓴다. 공개 설정 자체는 막지 않는다.
 * `전체 공개`는 설정집의 카드를 모두 1화부터 공개로 바꾸는 초안 변경이라 세계관 저장과 확정 버전을 거쳐야 공개 화면에 반영된다(집필 메모·관계는 건드리지 않는다). 다른 회차는 설정집 게시판의 일괄 공개가 회차를 입력받아 정한다.
 */
export function PublicCardsNotice({ vm, visibility }: { vm: ReturnType<typeof useWorldStudioViewModel>; visibility: WorldVisibility }) {
  const settings = vm.editing?.settings ?? []
  if (visibility !== 'public' || publicCardCount(settings) > 0) return null
  const all = publishAllCards(settings, 1)
  return (
    <p role="status" className="world-notice">
      <span>공개로 둔 설정이 없어요. 세계관을 공개해도 공개 화면에는 설정이 보이지 않아요.</span>
      {all !== settings && <button type="button" className="btn sm" disabled={vm.busy} onClick={() => vm.patch({ settings: all })}>전체 공개</button>}
    </p>
  )
}

/** 세계관 헤더의 장르 칩. 이름은 공개 장르 목록에서 찾고, 숨긴 장르(목록에 없음)와 읽는 동안·읽지 못했을 때는 칩을 그리지 않는다(코드를 보이지 않고 장르 없음처럼). */
export function GenreChip({ code }: { code: string }) {
  const name = genreNameOf(useGenres().data ?? [], code)
  return name ? <span className="chip">{name}</span> : null
}

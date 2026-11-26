import { useId } from 'react'
import { genreOptions } from '../../../../domain/entities/genre'
import { useGenres } from '../../../shared/useGenres'

type Props = {
  genre1: string
  genre2: string
  hashtags: string
  onGenre1: (value: string) => void
  onGenre2: (value: string) => void
  onHashtags: (value: string) => void
  /** 둘러싼 fieldset이 없으면 요청 중 입력을 잠그는 데 쓴다. */
  disabled?: boolean
  /** 첫 장르를 꼭 고르게 한다. 작품 등록에서만 켠다 — 장르가 없던 옛 작품도 정보 수정에서 제목만 고칠 수 있어야 한다. */
  genreRequired?: boolean
  /** 사용법 투어(#971)가 장르 칸을 가리킬 `data-tour` 이름 */
  tour?: string
}

/**
 * 작품 등록과 작품 정보 수정이 함께 쓰는 장르(1~2개)·해시태그(쉼표, 10개까지) 입력이다. 선택지와 안내가 한 곳에 있다.
 * 장르 선택지는 운영이 관리하는 공개 장르 목록(DEC-56)이고, 읽지 못하면 빈 목록으로 채우지 않고 실패와 다시 불러오기를 보인다.
 * 이미 고른 값(숨긴 장르 포함)은 목록에 없어도 그대로 보인다(새로 붙이는 것만 막는다).
 */
export function TaxonomyFields({ genre1, genre2, hashtags, onGenre1, onGenre2, onHashtags, disabled, genreRequired, tour }: Props) {
  // 입력 이름은 '해시태그'로 두고, 형식 안내(쉼표로 구분·10개까지)는 설명으로 이어 스크린리더도 읽게 한다.
  const hashtagHint = useId()
  const genres = useGenres()
  const unavailable = genres.isError && !genres.data
  const catalog = genres.data ?? []
  return (
    <>
      <div className='ep-field-row' data-tour={tour}>
        <label>
          장르<select aria-label='장르' value={genre1} onChange={(e) => { onGenre1(e.target.value); if (e.target.value === genre2) onGenre2('') }} required={genreRequired} disabled={disabled || unavailable}>
            <option value=''>장르를 선택해 주세요</option>
            {genreOptions(catalog, [genre1]).map((g) => <option key={g} value={g}>{g}</option>)}
          </select>
        </label>
        <label>
          두 번째 장르 <span className='ep-optional'>선택</span><select aria-label='두 번째 장르' value={genre2} onChange={(e) => onGenre2(e.target.value)} disabled={disabled || unavailable}>
            <option value=''>선택 안 함</option>
            {genreOptions(catalog, [genre2]).filter((g) => g !== genre1).map((g) => <option key={g} value={g}>{g}</option>)}
          </select>
        </label>
      </div>
      {unavailable && <div className='ep-alert' role='alert'>장르 목록을 불러오지 못했어요. <button type='button' className='btn sm' onClick={genres.retry}>다시 불러오기</button></div>}
      <label>
        해시태그 <span id={hashtagHint} className='ep-optional'>선택 · 쉼표로 구분 · 10개까지</span><input
          aria-label='해시태그'
          aria-describedby={hashtagHint}
          value={hashtags}
          onChange={(e) => onHashtags(e.target.value)}
          placeholder='#회귀, #성장'
          disabled={disabled}
        />
      </label>
    </>
  )
}

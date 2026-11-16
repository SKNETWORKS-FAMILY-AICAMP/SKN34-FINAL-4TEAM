import { useId } from 'react'
import { NOVEL_GENRES } from '../../../../domain/usecases/LibraryUseCase'

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
}

/** 작품 등록과 작품 정보 수정이 함께 쓰는 장르(1~2개)·해시태그(쉼표, 10개까지) 입력이다. 선택지와 안내가 한 곳에 있다. */
export function TaxonomyFields({ genre1, genre2, hashtags, onGenre1, onGenre2, onHashtags, disabled, genreRequired }: Props) {
  // 입력 이름은 '해시태그'로 두고, 형식 안내(쉼표로 구분·10개까지)는 설명으로 이어 스크린리더도 읽게 한다.
  const hashtagHint = useId()
  return (
    <>
      <div className='ep-field-row'>
        <label>
          장르<select aria-label='장르' value={genre1} onChange={(e) => { onGenre1(e.target.value); if (e.target.value === genre2) onGenre2('') }} required={genreRequired} disabled={disabled}>
            <option value=''>장르를 선택해 주세요</option>
            {NOVEL_GENRES.map((g) => <option key={g} value={g}>{g}</option>)}
          </select>
        </label>
        <label>
          두 번째 장르 <span className='ep-optional'>선택</span><select aria-label='두 번째 장르' value={genre2} onChange={(e) => onGenre2(e.target.value)} disabled={disabled}>
            <option value=''>선택 안 함</option>
            {NOVEL_GENRES.filter((g) => g !== genre1).map((g) => <option key={g} value={g}>{g}</option>)}
          </select>
        </label>
      </div>
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

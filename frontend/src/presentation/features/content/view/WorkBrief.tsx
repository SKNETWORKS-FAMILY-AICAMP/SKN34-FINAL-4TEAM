import { workKindLabel, type Work } from '../../../../domain/entities/content'
import type { MediaTarget } from '../../../../domain/entities/media'
import { StoredImage } from '../../../shared/media/MediaPanel'
import { useMediaViewModel } from '../../../shared/media/useMediaViewModel'

/**
 * 개요 밖 탭 위의 짧은 작품 요약(세계관 관리 헤더와 같은 모양): 72px 표지 썸네일·제목·칩·회차 수만 보이고 편집 버튼은 없다.
 * 작품 정보·표지 편집은 개요 탭의 WorkOverview에서만 한다.
 */
export function WorkBrief({ work: w, draftCount }: { work: Work; draftCount?: number | null }) {
  const target: MediaTarget = { kind: 'cover', workId: w.id }
  const media = useMediaViewModel(target)
  const current = media.items[0]
  const kind = workKindLabel(w)
  return (
    <section className='whero ep-brief'>
      <div className='cover ep-cover'>
        {current
          ? <StoredImage target={target} id={current.id} alt='작품 표지' revision={media.revision} />
          : !media.busy && !media.error && <img className='stored-image' src='/default-work-cover.svg' alt='기본 작품 표지' />}
      </div>
      <div>
        <h1>{w.title}</h1>
        <div className='ep-chips'>
          {!!w.genres?.length && <span className='g'>{w.genres.join(' · ')}</span>}
          {kind && <span className='chip'>{kind}</span>}
          <span className={'chip ' + (w.visibility === 'public' ? 'ok' : '')}>
            {w.visibility === 'private' ? '비공개 작품' : w.episodes.length ? '공개 중' : '공개 회차 없음'}
          </span>
        </div>
        <div className='stats'>
          <span>공개 회차 <b>{w.episodes.length}</b>화</span>
          {typeof draftCount === 'number' && <span>작성 중인 초안 <b>{draftCount}</b>개</span>}
        </div>
      </div>
    </section>
  )
}

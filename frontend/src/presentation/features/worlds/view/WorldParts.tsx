import type { ReactNode } from 'react'

import type { PublicWorldRef, PublicWorldSummary } from '../../../../domain/entities/publicWorld'
import { Art } from '../../../shared/art'
import { Go } from '../../../shared/Go'
import { genreLabel, worldLook } from '../../../shared/worldGenres'

/** 공개 세계관 목록·상세·설정 카드 페이지가 함께 쓰는 작은 표시 조각: 데모 안내, 불러오는 중·실패, 표지, 세계관 링크, 정보 상자 행. 계보 줄은 개요 탭(`WorldOverview`)에 있다. */

/** 메모리 데모(`--mode mockup`) 응답일 때만 그린다. 실제 모드에는 없다. */
export const DemoNotice = () => <p className="muted small worlds-demo">데모 · 공개 세계관과 세계관 지도는 서버 연결 전이에요</p>

/** 불러오는 중 안내. 실제 조회가 끝날 때까지만 보인다. */
export const WorldLoading = ({ what }: { what: string }) => <p className="muted worlds-state" role="status">{what}을 불러오고 있어요.</p>

/** 조회 실패 안내와 다시 시도. 실제 조회 결과 그대로 알리고 빈 목록·찾을 수 없음으로 바꾸지 않는다. */
export const LoadFailed = ({ what, onRetry }: { what: string; onRetry: () => void }) => (
  <div className="worlds-state" role="alert">
    <p>{what}을 불러오지 못했어요.</p>
    <button type="button" className="btn" onClick={onRetry}>다시 시도</button>
  </div>
)

/** 나무위키 정보 상자(`nw-info`)의 한 행 */
export const InfoRow = ({ k, children }: { k: string; children: ReactNode }) => <tr><th scope="row">{k}</th><td>{children}</td></tr>

/**
 * 홈 `Cov`와 같은 표지: 소유자가 올린 표지(`hasCover`, 공개 cover 주소를 `<img>`로 직접)이거나 장르별 테마 아트, 그리고 왼쪽 위 장르 태그. `k`는 한 화면 안에서 SVG id가 겹치지 않게 자리마다 다르게 준다.
 * `badge`가 있으면 홈 표지의 오른쪽 아래 알약(`.lk`)으로 보인다(연결된 세계관의 '원본'·'파생'·'조합', 작품의 '데모 작품').
 */
export function WorldCover({ w, k, badge }: { w: Pick<PublicWorldSummary, 'id' | 'genre' | 'hasCover'>; k: string; badge?: string }) {
  return (
    <div className="cov">
      {w.hasCover
        ? <img src={`/api/v1/public/world-studios/${w.id}/cover`} alt="" loading="lazy" />
        : <Art theme={worldLook(w.genre).theme} w={300} h={400} seed={w.id + k} />}
      <div className="tg"><span className="tag dk">{genreLabel(w.genre)}</span></div>
      {badge && <span className="lk">{badge}</span>}
    </div>
  )
}

export const WorldLink = ({ w }: { w: Pick<PublicWorldRef, 'id' | 'name'> }) => <Go to={`/worlds/${w.id}`}>{w.name}</Go>

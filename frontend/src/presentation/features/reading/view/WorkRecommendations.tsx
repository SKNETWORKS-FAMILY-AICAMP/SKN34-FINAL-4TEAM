import type { Work } from '../../../../domain/entities/work'
import { useWorkRecommendationsViewModel } from '../viewmodel/useWorkRecommendationsViewModel'
import { WCard } from './ExplorePages'

type Section = { items: Work[]; failed: boolean }
const visible = (s: Section) => s.failed || s.items.length > 0

/** 추천 한 줄: 비면 숨기고, 실패는 빈 목록으로 숨기지 않고 작은 안내와 다시 불러오기로 보입니다. 카드는 검색·랭킹이 쓰는 WCard입니다. */
function RecSection({ title, section, retry }: { title: string; section: Section; retry: () => void }) {
  if (!visible(section)) return null
  return (
    <section>
      <div className="sec-h"><h2>{title}</h2></div>
      {section.failed ? (
        <div className="muted small"><p role="alert">추천 소설을 불러오지 못했어요. 잠시 후 다시 시도해 주세요.</p><button type="button" className="btn sm" onClick={retry}>다시 불러오기</button></div>
      ) : (
        <div className="rgrid">{section.items.map((w, i) => <WCard key={w.id} w={w} i={i} />)}</div>
      )}
    </section>
  )
}

/** 소설 상세 아래의 추천: 같은 작가의 다른 작품, 첫 장르의 비슷한 작품(해시태그 겹침 순). 새 서버 경로 없이 공개 검색을 씁니다(세계관 추천은 공개 세계관 둘러보기 이후). */
export function WorkRecommendations({ work }: { work: Work }) {
  const { recommendations: rec, retry } = useWorkRecommendationsViewModel(work)
  if (!rec) return <p className="muted small wrecs">추천 소설을 불러오고 있어요…</p>
  if (!visible(rec.sameAuthor) && !visible(rec.similar)) return null
  return (
    <div className="wrecs">
      <RecSection title="이 작가의 다른 작품" section={rec.sameAuthor} retry={retry} />
      <RecSection title="비슷한 작품" section={rec.similar} retry={retry} />
    </div>
  )
}

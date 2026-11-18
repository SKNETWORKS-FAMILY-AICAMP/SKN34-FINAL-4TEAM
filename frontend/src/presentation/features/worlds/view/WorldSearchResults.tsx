import type { PublicWorldCardHit, PublicWorldSummary } from '../../../../domain/entities/publicWorld'
import { Go } from '../../../shared/Go'
import { KindChip } from '../../../shared/KindChip'
import { PublicCardImage } from '../../../shared/PublicCardImage'
import { CARD_KIND } from '../../../shared/worldBoard'
import { cardImageSrc, cardPath, typeLabel } from '../worldDetail'
import { WorldCard } from './WorldParts'

/** `/search` 세계관 탭의 결과: `/worlds` 모아 보기와 같은 세계관 카드 격자이고 카드를 누르면 `/worlds/:id`다. */
export const WorldHits = ({ worlds }: { worlds: readonly PublicWorldSummary[] }) => (
  <div className="grid6">{worlds.map((w) => <WorldCard key={w.id} w={w} />)}</div>
)

/**
 * `/search` 설정 카드 탭의 결과: 설정집 게시판(`worldBoard.css`)과 같은 표다. 제목 링크가 카드 페이지(`/worlds/:worldId/cards/:cardId`)로, 세계관 링크가 그 세계관으로 간다.
 * 대표 이미지(`imageId`)가 있는 카드는 제목 앞에 작은 썸네일이 붙고 읽지 못하면 감춘다. 별칭·태그는 찾은 이유를 보이는 칸이며 좁은 화면에서는 게시판처럼 숨는다.
 */
export function CardHits({ hits }: { hits: readonly PublicWorldCardHit[] }) {
  return (
    <div className="calm">
      <table className="worlds-board-table">
        <caption className="sr-only">설정 카드 검색 결과</caption>
        <thead>
          <tr><th scope="col" className="col-kind">분류</th><th scope="col" className="col-title">설정 카드</th><th scope="col">세계관</th><th scope="col" className="col-sum">별칭·태그</th></tr>
        </thead>
        <tbody>
          {hits.map((hit) => (
            <tr key={`${hit.worldId}/${hit.cardId}`}>
              <td className="col-kind"><KindChip kind={CARD_KIND[hit.cardType]} label={typeLabel(hit.cardType)} /></td>
              <td className="col-title">
                {hit.imageId && <PublicCardImage className="board-thumb" src={cardImageSrc(hit.worldId, hit.imageId)} title={hit.title} />}
                <Go to={cardPath(hit.worldId, hit.cardId)}>{hit.title}</Go>
              </td>
              <td><Go to={`/worlds/${hit.worldId}`}>{hit.worldName}</Go></td>
              <td className="col-sum">{[...hit.aliases, ...hit.tags.map((tag) => `#${tag}`)].join(' · ')}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

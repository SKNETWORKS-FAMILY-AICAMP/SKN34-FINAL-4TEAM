import { Fragment, type CSSProperties } from 'react'

import type { PublicWorld, PublicWorldRef } from '../../../../domain/entities/publicWorld'
import { genreLabel } from '../../../shared/worldGenres'
import { GENRE_COLORS } from '../worldAtlas'
import { InfoRow, WorldCover, WorldLink } from './WorldParts'
import '../../reading/view/publicWiki.css'

type Ref = Pick<PublicWorldRef, 'id' | 'name'>
/** 세계관 링크를 `sep`으로 이은 줄(조합 원본은 ' + ', 파생·조합된 세계관은 ', ') */
const WorldLinks = ({ worlds, sep }: { worlds: readonly Ref[]; sep: string }) => worlds.map((w, i) => <Fragment key={w.id}>{i > 0 && sep}<WorldLink w={w} /></Fragment>)

/**
 * 공개 세계관 상세의 개요 탭(`/worlds/:id?tab=overview`): 세계관 설명과 나무위키 정보 상자(장르 색 띠 아래 세계관 이름·표지, 장르·작가·설정 카드 수)를 보인다.
 * 계보가 있는 데모는 정보 상자에 파생·조합 출처가, 설명 아래에 출처 한 줄('○○에서 파생'·'○○ + △△ 조합')과 이 세계관에서 파생·조합된 세계관 줄이 붙는다(서버 응답에는 계보가 없다).
 * 작품 설정 위키(`PublicWikiArticle`)와 같은 `nw-*` 클래스를 쓰고 그 CSS가 읽는 읽기 화면 색 토큰은 `.calm`이 준다. 읽기 전용이고 설명이 비어 있으면 없다고 알린다.
 */
export function WorldOverview({ world }: { world: PublicWorld }) {
  const { lineage } = world
  const genre = genreLabel(world.genre)
  const children = lineage?.children ?? []
  const combined = lineage?.combinedFrom ?? []
  return (
    <div className="calm">
      <article className="tcard nw worlds-overview">
        <div className="nw-doc">
          <table className="nw-info" style={{ '--cat': GENRE_COLORS[genre] } as CSSProperties}>
            <caption>{world.name}</caption>
            <tbody>
              <tr><td colSpan={2} className="nw-cover"><WorldCover w={world} k="b" /></td></tr>
              <InfoRow k="장르">{genre}</InfoRow>
              <InfoRow k="작가">{world.authorNickname}</InfoRow>
              <InfoRow k="설정 카드">{world.cards.length}개</InfoRow>
              {lineage?.derivedFrom && <InfoRow k="파생 원본"><WorldLink w={lineage.derivedFrom} /></InfoRow>}
              {combined.length > 0 && <InfoRow k="조합 원본"><WorldLinks worlds={combined} sep=" + " /></InfoRow>}
              {children.length > 0 && <InfoRow k="파생·조합된 세계관">{children.length}개</InfoRow>}
            </tbody>
          </table>
          {world.description.trim() ? <p>{world.description}</p> : <p className="muted">아직 세계관 설명이 없어요.</p>}
          {(lineage?.derivedFrom || combined.length > 0 || children.length > 0) && (
            <div className="worlds-lineage">
              {lineage?.derivedFrom && <p><WorldLink w={lineage.derivedFrom} />에서 파생</p>}
              {combined.length > 0 && <p><WorldLinks worlds={combined} sep=" + " /> 조합</p>}
              {children.length > 0 && <p className="muted small">이 세계관에서 파생·조합된 세계관 {children.length}개 · <WorldLinks worlds={children} sep=", " /></p>}
            </div>
          )}
        </div>
      </article>
    </div>
  )
}

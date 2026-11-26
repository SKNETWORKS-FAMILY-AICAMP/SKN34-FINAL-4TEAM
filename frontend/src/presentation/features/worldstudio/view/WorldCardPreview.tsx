import type { ReactNode } from 'react'

import { cardTypeOf, isCard, settingAreas } from '../../../../domain/entities/studioCards'
import { cardRevealEpisode, type StudioSetting } from '../../../../domain/entities/studioWorld'
import { CardMarkdown, type CardLinkRender } from '../../../shared/CardMarkdown'
import { CardRelationMap } from '../../../shared/CardRelationMap'
import { CardWikiBody, InfoRow, WikiInfoBox } from '../../../shared/cardWiki'
import { wikiSections, type WikiRelation } from '../../../shared/cardWikiSections'
import { KindChip } from '../../../shared/KindChip'
import { relationAnchor } from '../../../shared/relationParagraph'
import { kindOf, type BoardRow } from '../../../shared/worldBoard'
import { cardRelationEntries } from '../viewmodel/cardRelationEntries'
import { revealBadge } from '../viewmodel/cardVisibility'
import { KNOWLEDGE_KINDS } from '../viewmodel/relationView'
import { useCardImageUrl, type CardImages } from '../viewmodel/useCardImages'
import '../../reading/view/publicWiki.css'

/** 정보 상자의 대표 이미지: 읽는 동안·읽지 못하면 비워 둔다(CSS가 이미지 없는 행을 감춘다. 이유는 편집 화면의 개요가 알린다). */
function PreviewImage({ images, imageId, title }: { images: CardImages; imageId: string; title: string }) {
  const { url } = useCardImageUrl(images, imageId)
  return url ? <img src={url} alt={`${title} 이미지`} /> : null
}

/**
 * 게시판 미리보기의 본문: 공개 카드 페이지(`WorldCardPage`)와 같은 나무위키식 문서(`shared/cardWiki`의 정보 상자·번호 목차·접이식 문단, `CardRelationMap`)를 지금 초안의 카드 한 장으로 그린다.
 * 공개 화면이 아니라 작가의 초안이라 공개 여부로 거르지 않고(작가 전용 카드도 그대로) 정보 상자에 공개 범위(`작가 전용`·`17화부터 공개`, 소설이 연결되지 않은 세계관은 저장값과 상관없이 `공개`,
 * 연결된 소설에 없는 회차는 `작가 전용 · 193화는 아직 없어요`)를 보인다. 모두 `revealBadge` 한 곳의 글이다.
 * 정보 상자: 유형·설정 영역·내 분류(편집 화면 개요의 두 분류 칸)·별칭·공개 범위·관계(인물)/연결 수·태그·대표 이미지. 이어서 카드별 관계도(간단 목록·함께한 사건)와 번호 목차·첫머리·본문 문단이고, 이 카드를 끝점으로 하는 승인된 관계마다 `상대 — 관계 이름` 문단이 `관계` 아래 있으며 접힌 `관계 자세히 보기 (N)` 안이다.
 * 본문의 설정 링크·관계도의 이웃·관계 문단의 상대는 모두 그 카드의 편집 화면을 연다(편집기의 설정 링크와 같은 규칙, [onOpen]). 설정집에 없는 카드의 링크는 글자만 남는다.
 * 높이는 CSS가 제한하고(긴 설정은 안에서 스크롤) 이 덩어리는 키보드로 스크롤할 수 있게 초점을 받는다.
 */
export function CardWikiPreview({ settings, setting, row, linked, limit, images, onOpen }: {
  settings: readonly StudioSetting[]; setting: StudioSetting; row: BoardRow; linked: boolean; limit?: number; images: CardImages; onOpen: (id: string) => void
}) {
  const { item } = setting
  const title = item.title || '이름 없는 설정'
  const kind = kindOf(cardTypeOf(item))
  const reach = cardRevealEpisode(setting)
  const entries = cardRelationEntries(settings, item.id)
  const cards = new Set(settings.filter((s) => isCard(s.item)).map((s) => s.item.id))
  const open = (id: string, label: ReactNode) => <button type="button" className="card-relmap-link" onClick={() => onOpen(id)}>{label}</button>
  const cardLink: CardLinkRender = (id, label) => (cards.has(id) ? open(id, label) : undefined)
  const relations = entries.filter((e) => !e.id.startsWith('link:')).map((e): WikiRelation => {
    const { name, body } = e.steps[0]
    return { id: relationAnchor(item.id, e.id), title: `${e.otherTitle} — ${name}`, heading: <>{open(e.otherId, e.otherTitle)} — {name}</>, body: body && <CardMarkdown text={body} cardLink={cardLink} /> }
  })
  const { lead, sections } = wikiSections(item.text, relations, [], cardLink)
  return (
    <div className="nw world-preview-doc" role="group" aria-label={`${title} 문서`} tabIndex={0}>
      <WikiInfoBox kind={kind} title={title} image={setting.imageId ? <PreviewImage images={images} imageId={setting.imageId} title={title} /> : undefined}>
        <InfoRow k="유형"><KindChip kind={kind} label={row.type} /></InfoRow>
        <InfoRow k="설정 영역">{settingAreas.find((area) => area.id === item.category)?.label ?? item.category}</InfoRow>
        {setting.userCategory && <InfoRow k="내 분류">{setting.userCategory}</InfoRow>}
        {!!setting.aliases?.length && <InfoRow k="별칭">{setting.aliases.join(', ')}</InfoRow>}
        <InfoRow k="공개 범위">{revealBadge(reach, linked, limit)}</InfoRow>
        <InfoRow k={row.kind === '인물' ? '관계' : '연결'}>{row.badge}개</InfoRow>
        {setting.tags.length > 0 && <InfoRow k="태그"><ul className="worlds-tags">{setting.tags.map((tag) => <li key={tag} className="chip">{tag}</li>)}</ul></InfoRow>}
      </WikiInfoBox>
      <CardRelationMap center={{ id: item.id, title, kind }} entries={entries} revealEpisode={linked ? (reach ?? null) : null} onOpen={onOpen} quietKinds={KNOWLEDGE_KINDS} />
      {!item.text.trim() && <p className="nw-empty">본문을 아직 쓰지 않았어요.</p>}
      <CardWikiBody lead={lead} sections={sections} fold={['nw-s-relations']} foldCount={relations.length} cardLink={cardLink} />
    </div>
  )
}

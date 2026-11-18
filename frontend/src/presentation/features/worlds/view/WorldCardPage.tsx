import { useId, useState, type CSSProperties, type ReactNode } from 'react'
import { useParams } from 'react-router'

import type { PublicWorld } from '../../../../domain/entities/publicWorld'
import { CardMarkdown, type CardLinkRender } from '../../../shared/CardMarkdown'
import { PublicCardImage } from '../../../shared/PublicCardImage'
import { numberCardSections, splitCardSections } from '../../../shared/cardSections'
import { Go } from '../../../shared/Go'
import { Jump } from '../../../shared/Jump'
import { KindChip } from '../../../shared/KindChip'
import { useScreenId } from '../../../shared/screenIds'
import { Footer, Gnb } from '../../../shared/shell/Gnb'
import { useDocumentTitle } from '../../../shared/useDocumentTitle'
import { CARD_COLORS } from '../../../shared/worldBoard'
import { PageControls } from '../../../shared/PageControls'
import { pageItems } from '../../../shared/pageItems'
import { useAppSelector } from '../../../../app/store'
import { useWorldImport } from '../viewmodel/useWorldImport'
import { useWorldCardViewModel } from '../viewmodel/useWorldsViewModel'
import { bookPath, cardImageSrc, cardPath, type CardPage, type CardRef } from '../worldDetail'
import { ImportOutcomeNotice, WorldAddMenu } from './WorldImportMenu'
import { DemoNotice, InfoRow, LoadFailed, WorldLink, WorldLoading } from './WorldParts'
import '../../reading/view/publicWiki.css'
import './worlds.css'

/** 다른 카드 페이지로 가는 링크와 그 연관의 라벨(`제목 · 라벨`) */
const CardLink = ({ worldId, r }: { worldId: string; r: CardRef }) => <><Go to={cardPath(worldId, r.cardId)}>{r.title}</Go>{r.label && ` · ${r.label}`}{r.category && ` · ${r.category === 'emotional' ? '감정 관계' : r.category === 'identity' ? '동일 인물' : '구조 관계'}`}{r.direction !== undefined && ` · ${r.direction === 'directed' ? `단방향: ${r.sourceFirst ? `이 설정 → ${r.title}` : `${r.title} → 이 설정`}` : r.direction === 'symmetric' ? '대칭 관계' : '방향 미상'}`}{r.polarity === 'denied' && ' · 부정된 관계'}{r.polarity === 'asserted' && ' · 확인된 관계'}{r.sourceFirst !== undefined && r.direction !== 'directed' && ` · 기록 순서: ${r.sourceFirst ? `이 설정 → ${r.title}` : `${r.title} → 이 설정`}`}{r.body && <p className="world-prose" style={{ whiteSpace: 'pre-wrap' }}>{r.body}</p>}</>

/** 카드 목록. 묶음이 섞인 목록(연관·가리키는 설정)은 항목마다 유형 칩을 단다. */
function CardList({ worldId, refs, withType }: { worldId: string; refs: readonly CardRef[]; withType: boolean }) {
  const [page, setPage] = useState(0)
  const paged = pageItems(refs, page, 50)
  return (
    <><ul>{paged.items.map((r, i) => (
      <li key={r.relationId ?? `${r.cardId}:${i}`}>{withType && <><KindChip kind={r.kind} label={r.type} />{' '}</>}<CardLink worldId={worldId} r={r} /></li>
    ))}</ul><PageControls page={paged.page} pages={paged.pages} onPage={setPage} /></>
  )
}

/** 나무위키 정보 상자(오른쪽): 유형 색 띠 아래 카드 이름, 대표 이미지가 있으면 그 이미지(읽지 못하면 감춘다), 맨 위에 유형 칩, 별칭(쉼표로)이 있으면 이어서. 인물은 소속(이어진 조직)·관계 수, 그 밖은 연결 수, 태그(칩)가 있으면 그 뒤에 보인다. 응답에 있는 값만 쓰고 비어 있으면 그 행은 없다. */
function CardInfoBox({ world, page }: { world: PublicWorld; page: CardPage }) {
  const { card, affiliations, relations, links, backlinks, additionalRelations } = page
  return (
    <table className="nw-info" style={{ '--cat': CARD_COLORS[card.kind] } as CSSProperties}>
      <caption>{card.title}</caption>
      <tbody>
        {card.imageId && <tr className="nw-info-image"><td colSpan={2}><PublicCardImage src={cardImageSrc(world.id, card.imageId)} title={card.title} /></td></tr>}
        <InfoRow k="유형"><KindChip kind={card.kind} label={card.type} /></InfoRow>
        {card.aliases.length > 0 && <InfoRow k="별칭">{card.aliases.join(', ')}</InfoRow>}
        {card.kind === '인물' ? (
          <>
            {affiliations.length > 0 && <InfoRow k="소속"><CardList worldId={world.id} refs={affiliations} withType={false} /></InfoRow>}
            <InfoRow k="관계">{world.relationshipStatus === 'unavailable' ? '불러오지 못함' : `${relations.length + additionalRelations.filter((r) => r.kind === '인물').length}개`}</InfoRow>
          </>
        ) : <InfoRow k="연결">{world.relationshipStatus === 'unavailable' ? '불러오지 못함' : `${links.length + backlinks.length + additionalRelations.length}개`}</InfoRow>}
        {card.tags.length > 0 && <InfoRow k="태그"><ul className="worlds-tags">{card.tags.map((tag) => <li key={tag} className="chip">{tag}</li>)}</ul></InfoRow>}
        <InfoRow k="세계관"><WorldLink w={world} /></InfoRow>
      </tbody>
    </table>
  )
}

type Section = { id: string; no: string; depth: number; title: string; body: ReactNode; children: Section[] }

/**
 * 문단: 본문(마크다운)의 `#`·`##`·`###` 제목마다 한 문단(단계대로 `1`·`1.1`·`1.1.1`, 하위 문단은 상위 문단 안) → 관계(인물) → 연관 설정 → 이 카드를 가리키는 설정 → 같은 유형의 다른 설정(최상위 번호를 이어 받음).
 * 목차는 이 문단들이고 본문 쪽은 작가가 쓴 제목 그대로다. 첫 제목 앞의 글은 제목 없는 첫머리(`lead`)라 목차·번호에 넣지 않는다(개요를 지어 붙이지 않는다).
 * `####` 이하는 문단 본문 안의 소제목이다. 내용이 없는 연결 문단은 빠진다. 본문을 어떻게 나누는지는 독자 설정 위키와 같은 `splitCardSections`가 정한다. 본문의 설정 링크는 [cardLink]로 그린다.
 */
function sectionsOf(page: CardPage, worldId: string, cardLink: CardLinkRender): { lead: string; sections: Section[] } {
  const lists = [
    ['relations', '관계', page.relations, false],
    ['links', '연관 설정', page.links, true],
    ['backlinks', '이 카드를 가리키는 설정', page.backlinks, true],
    ['additional', '같은 설정 사이의 다른 관계', page.additionalRelations, true],
    ['same', '같은 유형의 다른 설정', page.sameType, false],
  ] as const
  const parts = splitCardSections(page.card.text)
  const text = numberCardSections(parts)
  const top = text.filter((s) => s.depth === 1).length
  const flat: Section[] = [
    ...text.map(({ title, body, no, depth }, i) => ({ id: `text-${i}`, no, depth, title, body: body && <CardMarkdown text={body} cardLink={cardLink} />, children: [] })),
    ...lists.filter(([, , refs]) => refs.length > 0).map(([id, title, refs, withType], i) => ({ id, no: String(top + i + 1), depth: 1, title, body: <CardList worldId={worldId} refs={refs} withType={withType} />, children: [] })),
  ]
  // 단계(depth)대로 앞 문단의 하위로 넣는다. 번호를 매길 때 단계가 한 칸씩만 깊어지므로 부모는 늘 바로 앞 단계다.
  const sections: Section[] = []
  const path: Section[] = []
  for (const s of flat) {
    path.length = s.depth - 1
    ;(path.at(-1)?.children ?? sections).push(s)
    path.push(s)
  }
  return { lead: parts[0]?.level === 0 ? parts[0].body : '', sections }
}

/** 목차 한 단계: 하위 문단은 안쪽 목록으로 들여 쓴다. */
const TocList = ({ sections }: { sections: Section[] }) => (
  <ol>{sections.map((s) => (
    <li key={s.id}><Jump to={`nw-s-${s.id}`}><span className="nw-no">{s.no}.</span> {s.title}</Jump>{s.children.length > 0 && <TocList sections={s.children} />}</li>
  ))}</ol>
)

/** 접이식 문단. 하위 문단을 안에 두어 상위를 접으면 함께 접힌다. 제목 단계는 h2(1단계)·h3·h4다. */
function SectionView({ s }: { s: Section }) {
  const Heading = s.depth === 1 ? 'h2' : s.depth === 2 ? 'h3' : 'h4'
  return (
    <details className="nw-sec" open>
      <summary id={`nw-s-${s.id}`}><Heading><span className="nw-no">{s.no}.</span> {s.title}</Heading></summary>
      {s.body && <div className="nw-doc">{s.body}</div>}
      {s.children.map((c) => <SectionView key={c.id} s={c} />)}
    </details>
  )
}

/**
 * '이 설정 가져오기'(로그인한 회원): 내 세계관을 고르면 이 카드 하나를 그 세계관 초안에 바로 더하고(관계 제외) 진행·결과를 버튼 아래에 알린다. 화면은 옮기지 않는다.
 */
function CardImport({ world, cardId }: { world: PublicWorld; cardId: string }) {
  const member = useAppSelector((s) => !!s.session.role)
  const direct = useWorldImport(world)
  if (!member) return null
  return (
    <div className="worlds-import-row">
      <WorldAddMenu
        sourceWorldId={world.id} label="이 설정 가져오기" note="이 설정을 고른 세계관의 초안에 바로 추가해요. 관계는 함께 오지 않아요." saving={direct.saving}
        onAdd={(target) => { void direct.add(target, [cardId]) }}
      />
      <ImportOutcomeNotice outcome={direct.outcome} onRetry={() => { void direct.retry() }} />
    </div>
  )
}

/**
 * 설정 카드 한 장의 공개 페이지(`/worlds/:id/cards/:cardId`). 작품 설정 위키(`PublicWikiArticle`)와 같은 `nw-*` 나무위키 형식 문서 한 편이다:
 * 빵부스러기 → 분류 상자 → 문서 제목 → 오른쪽 정보 상자 → 번호 목차(본문 `#`·`##`·`###` 제목과 연결 문단) → 첫머리 글(제목 없음) → 번호 매긴 접이식 문단. 아래에 설정집 순서의 이전·다음 카드와 세계관으로 돌아가기가 있다.
 * 내용 구성(어떤 문단이 있고 어떤 순서인지)은 `cardPage`가 정하고 이 화면은 그대로 그린다. 로그인 없이 볼 수 있고 읽기 전용이다.
 * 로그인한 회원에게는 빵부스러기 아래에 '이 설정 가져오기'(`CardImport`)가 보이고 고른 내 세계관 초안에 이 카드를 바로 더한다.
 */
export function WorldCardPage() {
  const { id, cardId } = useParams()
  const { world, page, isLoading, isError, retry } = useWorldCardViewModel(id, cardId)
  const heading = useId()
  // 본문의 설정 링크는 응답에 있는(서버가 보이는 카드로만 남긴) 카드의 페이지로 간다. 응답에 없는 카드는 글자만 보인다.
  const shown = new Set(world?.cards.map((c) => c.id))
  const cardLink: CardLinkRender = (cardId, label) => (world && shown.has(cardId) ? <Go to={cardPath(world.id, cardId)}>{label}</Go> : undefined)
  const { lead, sections } = world && page ? sectionsOf(page, world.id, cardLink) : { lead: '', sections: [] }
  useScreenId('W04')
  useDocumentTitle(world && page ? `${page.card.title} · ${world.name}` : world ? '찾을 수 없는 설정' : isLoading || isError ? '세계관' : '찾을 수 없는 세계관')
  return (
    <>
      <Gnb on="worlds" />
      <main className="wrap worlds" id="main" tabIndex={-1}>
        {isLoading ? <WorldLoading what="세계관" /> : isError ? <LoadFailed what="세계관" onRetry={retry} /> : !world ? (
          <>
            <h1>찾을 수 없는 세계관</h1>
            <p className="muted worlds-note">주소가 바뀌었거나 공개가 중단된 세계관일 수 있어요.</p>
            <Go to="/worlds" className="btn">공개 세계관 보러 가기</Go>
          </>
        ) : !page ? (
          <>
            <h1>찾을 수 없는 설정</h1>
            <p className="muted worlds-note">주소가 바뀌었거나 공개가 중단된 설정 카드일 수 있어요.</p>
            <Go to={bookPath(world.id)} className="btn">세계관으로 돌아가기</Go>
          </>
        ) : (
          <>
            {world.demo && <DemoNotice />}
            {world.relationshipStatus === 'unavailable' && <p role="status">관계를 불러오지 못했어요. 연결 정보를 확인하려면 잠시 뒤 다시 열어 주세요.</p>}
            {page.additionalRelations.some((r) => r.direction !== 'directed') && <p className="small muted">관계의 기록 순서는 관계의 방향이나 대칭 여부를 뜻하지 않아요.</p>}
            <nav className="worlds-crumbs" aria-label="현재 위치">
              <ol>
                <li><Go to={`/worlds/${world.id}`}>{world.name}</Go></li>
                <li><Go to={bookPath(world.id, page.card.kind)}>{page.card.kind}</Go></li>
                <li><Go to={cardPath(world.id, page.card.cardId)} aria-current="page">{page.card.title}</Go></li>
              </ol>
            </nav>
            <CardImport key={page.card.cardId} world={world} cardId={page.card.cardId} />
            <div className="calm">
              <article className="tcard nw" aria-labelledby={heading}>
                <p className="nw-cat"><b>분류</b><Go to={`/worlds/${world.id}`}>{world.name}</Go><Go to={bookPath(world.id, page.card.kind)}>{page.card.kind}</Go></p>
                <header className="nw-head"><h1 id={heading}>{page.card.title}</h1></header>
                <CardInfoBox world={world} page={page} />
                {sections.length > 0 && <nav className="nw-toc" id="nw-toc" tabIndex={-1} aria-label="목차">
                  <b>목차</b>
                  <TocList sections={sections} />
                </nav>}
                {lead && <div className="nw-doc nw-lead"><CardMarkdown text={lead} cardLink={cardLink} /></div>}
                {sections.map((s) => <SectionView key={s.id} s={s} />)}
              </article>
              <nav className="worlds-cardnav" aria-label="이전·다음 설정">
                {page.prev && <Go to={cardPath(world.id, page.prev.cardId)} rel="prev"><small>이전 설정</small>{' '}<b>{page.prev.title}</b></Go>}
                {page.next && <Go to={cardPath(world.id, page.next.cardId)} rel="next" className="next"><small>다음 설정</small>{' '}<b>{page.next.title}</b></Go>}
              </nav>
            </div>
            <Go to={bookPath(world.id)} className="btn worlds-back">← 세계관으로 돌아가기</Go>
          </>
        )}
      </main>
      <Footer />
    </>
  )
}

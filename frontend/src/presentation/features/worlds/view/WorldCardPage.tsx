import { useEffect, useId, useState } from 'react'
import { useLocation, useParams } from 'react-router'

import type { PublicWorld } from '../../../../domain/entities/publicWorld'
import { CardMarkdown, type CardLinkRender } from '../../../shared/CardMarkdown'
import { CardRelationMap } from '../../../shared/CardRelationMap'
import { PublicCardImage } from '../../../shared/PublicCardImage'
import { CardWikiBody, InfoRow, WikiInfoBox } from '../../../shared/cardWiki'
import { wikiSections, type WikiList, type WikiRelation } from '../../../shared/cardWikiSections'
import { Go } from '../../../shared/Go'
import { jumpTo } from '../../../shared/jumpTo'
import { KindChip } from '../../../shared/KindChip'
import { relationAnchor, relationHistoryLine, relationNote } from '../../../shared/relationParagraph'
import { useScreenId } from '../../../shared/screenIds'
import { Footer, Gnb } from '../../../shared/shell/Gnb'
import { useDocumentTitle } from '../../../shared/useDocumentTitle'
import { PageControls } from '../../../shared/PageControls'
import { pageItems } from '../../../shared/pageItems'
import { useAppSelector } from '../../../../app/store'
import { useWorldImport } from '../viewmodel/useWorldImport'
import { useWorldCardViewModel } from '../viewmodel/useWorldsViewModel'
import { publicCardEntries } from '../cardRelationEntries'
import { bookPath, cardImageSrc, cardPath, type CardPage, type CardRef } from '../worldDetail'
import { ImportOutcomeNotice, WorldAddMenu } from './WorldImportMenu'
import { DemoNotice, LoadFailed, WorldLink, WorldLoading } from './WorldParts'
import '../../reading/view/publicWiki.css'
import './worlds.css'

/**
 * 카드 목록. 한 줄에 상대 카드로 가는 링크 하나이고 관계명이 있으면 `상대(관계명)`으로 이어 쓴다(관계 설명·부가 표시는 관계 문단이 보인다). 묶음이 섞인 목록은 항목마다 유형 칩을 단다.
 * [toRelation]이면 받는 쪽 링크라서 관계 id가 있는 항목은 보내는 쪽 카드 페이지의 그 관계 문단(앵커)으로 간다(DEC-54).
 */
function CardList({ worldId, refs, withType, toRelation = false }: { worldId: string; refs: readonly CardRef[]; withType: boolean; toRelation?: boolean }) {
  const [page, setPage] = useState(0)
  const paged = pageItems(refs, page, 50)
  return (
    <><ul>{paged.items.map((r, i) => (
      <li key={r.relationId ?? `${r.cardId}:${i}`}>
        {withType && <><KindChip kind={r.kind} label={r.type} />{' '}</>}
        <Go to={cardPath(worldId, r.cardId) + (toRelation && r.relationId ? `#${relationAnchor(r.cardId, r.relationId)}` : '')}>{r.title}{r.label && `(${r.label})`}</Go>
      </li>
    ))}</ul><PageControls page={paged.page} pages={paged.pages} onPage={setPage} /></>
  )
}

/** 나무위키 정보 상자(오른쪽): 유형 색 띠 아래 카드 이름, 대표 이미지가 있으면 그 이미지(읽지 못하면 감춘다), 맨 위에 유형 칩, 별칭(쉼표로)이 있으면 이어서. 인물은 소속(이어진 조직)·관계 수, 그 밖은 연결 수, 태그(칩)가 있으면 그 뒤에 보인다. 응답에 있는 값만 쓰고 비어 있으면 그 행은 없다. */
function CardInfoBox({ world, page }: { world: PublicWorld; page: CardPage }) {
  const { card, affiliations, relations, backlinks } = page
  const related = [...relations, ...backlinks] // 관계 문단과 받는 쪽 링크(본문 링크로 가리킨 카드 포함)
  return (
    <WikiInfoBox kind={card.kind} title={card.title} image={card.imageId && <PublicCardImage src={cardImageSrc(world.id, card.imageId)} title={card.title} />}>
        <InfoRow k="유형"><KindChip kind={card.kind} label={card.type} /></InfoRow>
        {card.aliases.length > 0 && <InfoRow k="별칭">{card.aliases.join(', ')}</InfoRow>}
        {card.kind === '인물' ? (
          <>
            {affiliations.length > 0 && <InfoRow k="소속"><CardList worldId={world.id} refs={affiliations} withType={false} /></InfoRow>}
            <InfoRow k="관계">{world.relationshipStatus === 'unavailable' ? '불러오지 못함' : `${related.filter((r) => r.relationId).length}개`}</InfoRow>
          </>
        ) : <InfoRow k="연결">{world.relationshipStatus === 'unavailable' ? '불러오지 못함' : `${related.length}개`}</InfoRow>}
        {card.tags.length > 0 && <InfoRow k="태그"><ul className="worlds-tags">{card.tags.map((tag) => <li key={tag} className="chip">{tag}</li>)}</ul></InfoRow>}
        <InfoRow k="세계관"><WorldLink w={world} /></InfoRow>
    </WikiInfoBox>
  )
}

/**
 * 정보 상자 아래에는 카드별 관계도(`CardRelationMap`: 이 카드는 이렇게 연관됩니다, 회차 탭은 응답의 `history` 회차)가 있고, 긴 관계 문단은 `관계 자세히 보기 (N)`으로 접혀 있다(앵커 이동은 펼친다, DEC-54).
 * 문단: 본문(마크다운)의 `#`·`##`·`###` 제목마다 한 문단(단계대로 `1`·`1.1`·`1.1.1`, 하위 문단은 상위 문단 안) → 관계(이 카드에 문단으로 보이는 관계마다 `상대 — 관계명` 하위 문단과 관계 설명, DEC-54)
 * → 이 설정을 가리키는 관계(받는 쪽 링크) → 같은 유형의 다른 설정(최상위 번호를 이어 받음).
 * 목차는 이 문단들이고 본문 쪽은 작가가 쓴 제목 그대로다. 첫 제목 앞의 글은 제목 없는 첫머리(`lead`)라 목차·번호에 넣지 않는다(개요를 지어 붙이지 않는다).
 * `####` 이하는 문단 본문 안의 소제목이다. 내용이 없는 문단은 빠진다. 본문을 어떻게 나누는지는 독자 설정 위키와 같은 `splitCardSections`가 정한다. 본문과 관계 설명의 설정 링크는 [cardLink]로 그린다.
 */
function sectionsOf(page: CardPage, worldId: string, cardLink: CardLinkRender) {
  const relations = page.relations.map((r): WikiRelation => {
    const note = relationNote(r), history = relationHistoryLine(r.category, r.history)
    return {
      id: relationAnchor(page.card.cardId, r.relationId), title: r.label ? `${r.title} — ${r.label}` : r.title,
      heading: <><Go to={cardPath(worldId, r.cardId)}>{r.title}</Go>{r.label && ` — ${r.label}`}{note && <>{' '}<small>{note}</small></>}</>,
      body: (history || r.body) && <>{history && <p className="nw-relhist">{history}</p>}{r.body && <CardMarkdown text={r.body} cardLink={cardLink} />}</>,
    }
  })
  const lists = ([
    ['backlinks', '이 설정을 가리키는 관계', page.backlinks, true, true],
    ['same', '같은 유형의 다른 설정', page.sameType, false, false],
  ] as const).filter(([, , refs]) => refs.length > 0).map(([id, title, refs, withType, toRelation]): WikiList => ({ id, title, body: <CardList worldId={worldId} refs={refs} withType={withType} toRelation={toRelation} /> }))
  return wikiSections(page.card.text, relations, lists, cardLink)
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
 * 빵부스러기 → 분류 상자 → 문서 제목 → 오른쪽 정보 상자 → 번호 목차(본문 `#`·`##`·`###` 제목과 관계·가리키는 관계 문단) → 첫머리 글(제목 없음) → 번호 매긴 접이식 문단. 아래에 설정집 순서의 이전·다음 카드와 세계관으로 돌아가기가 있다.
 * 내용 구성(어떤 문단이 있고 어떤 순서인지)은 `cardPage`가 정하고 이 화면은 그대로 그린다. 로그인 없이 볼 수 있고 읽기 전용이다.
 * 로그인한 회원에게는 빵부스러기 아래에 '이 설정 가져오기'(`CardImport`)가 보이고 고른 내 세계관 초안에 이 카드를 바로 더한다.
 */
export function WorldCardPage() {
  const { id, cardId } = useParams()
  const { world, page, isLoading, isError, retry } = useWorldCardViewModel(id, cardId)
  const heading = useId()
  // 받는 쪽 링크로 들어온 주소(#관계 문단 앵커)는 카드가 그려지면 그 문단으로 이동해 강조한다(DEC-54). 같은 주소로 다시 와도 이동한다(key).
  const { hash, key } = useLocation()
  useEffect(() => { if (hash && page) jumpTo(hash.slice(1), true) }, [hash, key, page])
  // 본문의 설정 링크는 응답에 있는(서버가 보이는 카드로만 남긴) 카드의 페이지로 간다. 응답에 없는 카드는 글자만 보인다.
  const shown = new Set(world?.cards.map((c) => c.id))
  const cardLink: CardLinkRender = (cardId, label) => (world && shown.has(cardId) ? <Go to={cardPath(world.id, cardId)}>{label}</Go> : undefined)
  const { lead, sections } = world && page ? sectionsOf(page, world.id, cardLink) : { lead: '', sections: [] }
  // 긴 관계 문단('관계'와 하위 문단, 이 설정을 가리키는 관계)은 기본으로 접는다(`CardWikiBody`의 fold): 관계도가 한눈에 보이고, 앵커(#관계 문단)로 들어오면 `jumpTo`가 접힌 문단을 펼친다.
  const relationTotal = page ? page.relations.length + page.backlinks.length : 0
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
                {world.relationshipStatus !== 'unavailable' && <CardRelationMap center={{ id: page.card.cardId, title: page.card.title, kind: page.card.kind }} entries={publicCardEntries(page)} hrefOf={(to) => cardPath(world.id, to)} />}
                <CardWikiBody lead={lead} sections={sections} fold={['nw-s-relations', 'nw-s-backlinks']} foldCount={relationTotal} cardLink={cardLink} />
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

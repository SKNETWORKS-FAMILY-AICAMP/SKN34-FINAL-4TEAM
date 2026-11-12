import { Fragment, useId, type CSSProperties, type ReactNode } from 'react'
import { useParams } from 'react-router'

import type { PublicWorld } from '../../../../domain/entities/publicWorld'
import { CardMarkdown } from '../../../shared/CardMarkdown'
import { splitCardSections } from '../../../shared/cardSections'
import { Go } from '../../../shared/Go'
import { Jump } from '../../../shared/Jump'
import { KindChip } from '../../../shared/KindChip'
import { useScreenId } from '../../../shared/screenIds'
import { Footer, Gnb } from '../../../shared/shell/Gnb'
import { useDocumentTitle } from '../../../shared/useDocumentTitle'
import { CARD_COLORS } from '../../../shared/worldBoard'
import { useWorldCardViewModel } from '../viewmodel/useWorldsViewModel'
import { bookPath, cardPath, type CardPage, type CardRef } from '../worldDetail'
import { DemoNotice, InfoRow, LoadFailed, WorldLink, WorldLoading } from './WorldParts'
import '../../reading/view/publicWiki.css'
import './worlds.css'

/** 다른 카드 페이지로 가는 링크와 그 연관의 라벨(`제목 · 라벨`) */
const CardLink = ({ worldId, r }: { worldId: string; r: CardRef }) => <><Go to={cardPath(worldId, r.cardId)}>{r.title}</Go>{r.label && ` · ${r.label}`}</>

/** 카드 목록. 묶음이 섞인 목록(연관·가리키는 설정)은 항목마다 유형 칩을 단다. */
function CardList({ worldId, refs, withType }: { worldId: string; refs: readonly CardRef[]; withType: boolean }) {
  return (
    <ul>{refs.map((r) => (
      <li key={r.cardId}>{withType && <><KindChip kind={r.kind} label={r.type} />{' '}</>}<CardLink worldId={worldId} r={r} /></li>
    ))}</ul>
  )
}

/** 나무위키 정보 상자(오른쪽): 유형 색 띠 아래 카드 이름, 맨 위에 유형 칩, 별칭(쉼표로)이 있으면 이어서. 인물은 소속(이어진 조직)·관계 수, 그 밖은 연결 수, 태그(칩)가 있으면 그 뒤에 보인다. 응답에 있는 값만 쓰고 비어 있으면 그 행은 없다. */
function CardInfoBox({ world, page }: { world: PublicWorld; page: CardPage }) {
  const { card, affiliations, relations, links, backlinks } = page
  return (
    <table className="nw-info" style={{ '--cat': CARD_COLORS[card.kind] } as CSSProperties}>
      <caption>{card.title}</caption>
      <tbody>
        <InfoRow k="유형"><KindChip kind={card.kind} label={card.type} /></InfoRow>
        {card.aliases.length > 0 && <InfoRow k="별칭">{card.aliases.join(', ')}</InfoRow>}
        {card.kind === '인물' ? (
          <>
            {affiliations.length > 0 && <InfoRow k="소속">{affiliations.map((r, i) => <Fragment key={r.cardId}>{i > 0 && ', '}<CardLink worldId={world.id} r={r} /></Fragment>)}</InfoRow>}
            <InfoRow k="관계">{relations.length}개</InfoRow>
          </>
        ) : <InfoRow k="연결">{links.length + backlinks.length}개</InfoRow>}
        {card.tags.length > 0 && <InfoRow k="태그"><ul className="worlds-tags">{card.tags.map((tag) => <li key={tag} className="chip">{tag}</li>)}</ul></InfoRow>}
        <InfoRow k="세계관"><WorldLink w={world} /></InfoRow>
      </tbody>
    </table>
  )
}

type Section = { id: string; title: string; body: ReactNode }

/**
 * 문단: 본문(마크다운)의 `## 제목`마다 한 문단(`##`가 없으면 개요 하나) → 관계(인물) → 연관 설정 → 이 카드를 가리키는 설정 → 같은 유형의 다른 설정.
 * 내용이 없는 문단은 빠지고 번호는 화면이 연속으로 매긴다. 본문을 어떻게 나누는지는 편집 화면 미리보기와 같은 `splitCardSections`가 정한다.
 */
function sectionsOf(page: CardPage, worldId: string): Section[] {
  const lists = [
    ['relations', '관계', page.relations, false],
    ['links', '연관 설정', page.links, true],
    ['backlinks', '이 카드를 가리키는 설정', page.backlinks, true],
    ['same', '같은 유형의 다른 설정', page.sameType, false],
  ] as const
  return [
    ...splitCardSections(page.card.text).map(({ title, body }, i) => ({ id: `text-${i}`, title, body: <CardMarkdown text={body} /> })),
    ...lists.filter(([, , refs]) => refs.length > 0).map(([id, title, refs, withType]) => ({ id, title, body: <CardList worldId={worldId} refs={refs} withType={withType} /> })),
  ]
}

/**
 * 설정 카드 한 장의 공개 페이지(`/worlds/:id/cards/:cardId`). 작품 설정 위키(`PublicWikiArticle`)와 같은 `nw-*` 나무위키 형식 문서 한 편이다:
 * 빵부스러기 → 분류 상자 → 문서 제목 → 오른쪽 정보 상자 → 번호 목차 → 번호 매긴 접이식 문단. 아래에 설정집 순서의 이전·다음 카드와 세계관으로 돌아가기가 있다.
 * 내용 구성(어떤 문단이 있고 어떤 순서인지)은 `cardPage`가 정하고 이 화면은 그대로 그린다. 로그인 없이 볼 수 있고 읽기 전용이다.
 */
export function WorldCardPage() {
  const { id, cardId } = useParams()
  const { world, page, isLoading, isError, retry } = useWorldCardViewModel(id, cardId)
  const heading = useId()
  const sections = world && page ? sectionsOf(page, world.id) : []
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
            <nav className="worlds-crumbs" aria-label="현재 위치">
              <ol>
                <li><Go to={`/worlds/${world.id}`}>{world.name}</Go></li>
                <li><Go to={bookPath(world.id, page.card.kind)}>{page.card.kind}</Go></li>
                <li><Go to={cardPath(world.id, page.card.cardId)} aria-current="page">{page.card.title}</Go></li>
              </ol>
            </nav>
            <div className="calm">
              <article className="tcard nw" aria-labelledby={heading}>
                <p className="nw-cat"><b>분류</b><Go to={`/worlds/${world.id}`}>{world.name}</Go><Go to={bookPath(world.id, page.card.kind)}>{page.card.kind}</Go></p>
                <header className="nw-head"><h1 id={heading}>{page.card.title}</h1></header>
                <CardInfoBox world={world} page={page} />
                <nav className="nw-toc" id="nw-toc" tabIndex={-1} aria-label="목차">
                  <b>목차</b>
                  <ol>{sections.map((s, i) => (
                    <li key={s.id}><Jump to={`nw-s-${s.id}`}><span className="nw-no">{i + 1}.</span> {s.title}</Jump></li>
                  ))}</ol>
                </nav>
                {sections.map((s, i) => (
                  <details key={s.id} className="nw-sec" open>
                    <summary id={`nw-s-${s.id}`}><h2><span className="nw-no">{i + 1}.</span> {s.title}</h2></summary>
                    <div className="nw-doc">{s.body}</div>
                  </details>
                ))}
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

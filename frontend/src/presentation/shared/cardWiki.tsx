import type { CSSProperties, ReactNode } from 'react'
import { CardMarkdown, type CardLinkRender } from './CardMarkdown'
import { Jump } from './Jump'
import type { WikiSection } from './cardWikiSections'
import { CARD_COLORS, type CardKind } from './worldBoard'

/*
 * 설정 카드 위키 문서(나무위키식 `nw-*`)의 본문 틀(컴포넌트): 공개 카드 페이지(`WorldCardPage`)와 작가 게시판 미리보기(`CardWikiPreview`)가 함께 쓴다.
 * 어떤 문단이 있고 어떤 링크를 그릴지는 쓰는 쪽이 정하고(링크는 공개 페이지는 주소, 미리보기는 그 카드 편집 화면), 문단 트리는 `cardWikiSections.tsx`의 `wikiSections`가 만든다. 이 파일은 정보 상자·목차·접이식 문단·접힌 묶음만 그린다.
 */

/** 정보 상자의 한 행. */
export const InfoRow = ({ k, children }: { k: string; children: ReactNode }) => <tr><th scope="row">{k}</th><td>{children}</td></tr>

/** 나무위키 정보 상자(`nw-info`, 오른쪽에 뜬다): 유형 색 띠 아래 카드 이름, 대표 이미지가 있으면 맨 위 행(읽지 못해 비면 CSS가 감춘다), 그 아래 [children]의 `InfoRow`들이다. 어떤 행을 둘지는 쓰는 화면이 정한다. */
export function WikiInfoBox({ kind, title, image, children }: { kind: CardKind; title: string; image?: ReactNode; children: ReactNode }) {
  return (
    <table className="nw-info" style={{ '--cat': CARD_COLORS[kind] } as CSSProperties}>
      <caption>{title}</caption>
      <tbody>
        {image && <tr className="nw-info-image"><td colSpan={2}>{image}</td></tr>}
        {children}
      </tbody>
    </table>
  )
}

/** 목차 한 단계: 하위 문단은 안쪽 목록으로 들여 쓴다. */
const TocList = ({ sections }: { sections: WikiSection[] }) => (
  <ol>{sections.map((s) => (
    <li key={s.id}><Jump to={s.id}><span className="nw-no">{s.no}.</span> {s.title}</Jump>{s.children.length > 0 && <TocList sections={s.children} />}</li>
  ))}</ol>
)

/** 접힌 묶음: 기본으로 접혀 있다(`관계 자세히 보기 (N)`). 안의 문단은 그대로고 목차·앵커 이동이 이 묶음을 펼친다. */
function RelationDetails({ count, children }: { count: number; children: ReactNode }) {
  return (
    <details className="nw-rels" id="nw-rels">
      <summary><h2>관계 자세히 보기 ({count})</h2></summary>
      {children}
    </details>
  )
}

/** 접이식 문단. 하위 문단을 안에 두어 상위를 접으면 함께 접힌다. 제목 단계는 h2(1단계)·h3·h4다. */
function SectionView({ s }: { s: WikiSection }) {
  const Heading = s.depth === 1 ? 'h2' : s.depth === 2 ? 'h3' : 'h4'
  return (
    <details className="nw-sec" open>
      <summary id={s.id}><Heading><span className="nw-no">{s.no}.</span> {s.heading ?? s.title}</Heading></summary>
      {s.body && <div className="nw-doc">{s.body}</div>}
      {s.children.map((c) => <SectionView key={c.id} s={c} />)}
    </details>
  )
}

/**
 * 번호 목차(`nw-toc`)·첫머리 글·접이식 문단. [fold]에 든 최상위 문단들(긴 관계 문단)은 `관계 자세히 보기 ([foldCount])` 한 묶음으로 접힌다(첫 문단 자리에 묶음 하나).
 */
export function CardWikiBody({ lead, sections, fold, foldCount, cardLink }: { lead: string; sections: WikiSection[]; fold: readonly string[]; foldCount: number; cardLink: CardLinkRender }) {
  const folded = sections.filter((s) => fold.includes(s.id))
  return (
    <>
      {sections.length > 0 && (
        <nav className="nw-toc" id="nw-toc" tabIndex={-1} aria-label="목차">
          <b>목차</b>
          <TocList sections={sections} />
        </nav>
      )}
      {lead && <div className="nw-doc nw-lead"><CardMarkdown text={lead} cardLink={cardLink} /></div>}
      {sections.map((s) => (folded.includes(s) ? (s === folded[0] ? <RelationDetails key="nw-rels" count={foldCount}>{folded.map((d) => <SectionView key={d.id} s={d} />)}</RelationDetails> : null) : <SectionView key={s.id} s={s} />))}
    </>
  )
}

import { Fragment, useId } from 'react'

import { characterDocText } from '../../../../domain/entities/characterDocs'
import { cardTypeOf, isCard } from '../../../../domain/entities/studioCards'
import type { StudioSetting } from '../../../../domain/entities/studioWorld'
import { CardMarkdown, type CardLinkRender } from '../../../shared/CardMarkdown'
import { Go } from '../../../shared/Go'
import { BackChev, StrokeIcon } from '../../../shared/icons'
import { KindChip } from '../../../shared/KindChip'
import { PageControls } from '../../../shared/PageControls'
import { CardWikiPreview } from '../../worldstudio/view/WorldCardPreview'
import type { StudioWorldBook } from '../viewmodel/useStudioWorldBookViewModel'
import './studio-book.css'

/** 메뉴 아이콘(24 격자 선 아이콘): 회차=쪽, 설정집=책. */
const ICONS = {
  episodes: <><path d="M7 3h7l5 5v13H7z" /><path d="M14 3v5h5M10.5 13h6M10.5 17h6" /></>,
  book: <><rect x="5" y="3" width="14" height="18" rx="2" /><path d="M9 3v18M12.5 8h3.5" /></>,
}

/**
 * 집필실 왼쪽 맨 앞의 세로 메뉴(세계관 카드 편집 화면의 활동 막대와 같은 모양, 아이콘 아래 짧은 글): `회차`(기본)·`설정집`이 왼쪽 패널을 바꾼다. 지금 보이는 쪽은 `aria-pressed`다.
 * 연결된 세계관을 알기 전(확인 중·실패·연결 없음)에는 `설정집`을 `aria-disabled`로 잠그고 이유를 `StudioBookNote`에 이어 둔다(`disabled`가 되면 키보드로 이유를 읽을 수 없다).
 */
export function StudioMenu({ book }: { book: StudioWorldBook }) {
  const locked = book.state !== 'ready'
  const tab = (label: string, icon: keyof typeof ICONS, on: boolean, props: { onClick: () => void; 'aria-disabled'?: true; 'aria-describedby'?: string }) => (
    <button type="button" className="writing-menu-tab" aria-pressed={on} {...props}>
      <span className="writing-menu-icon"><StrokeIcon size={20}>{ICONS[icon]}</StrokeIcon></span>
      <span className="writing-menu-label">{label}</span>
    </button>
  )
  return (
    <div className="writing-menu" role="group" aria-label="집필실 메뉴" data-tour="studio-rail">
      {tab('회차', 'episodes', book.view === 'episodes', { onClick: () => book.show('episodes') })}
      {tab('설정집', 'book', book.view === 'book', { onClick: () => book.show('book'), 'aria-disabled': locked || undefined, 'aria-describedby': locked ? book.noteId : undefined })}
    </div>
  )
}

/**
 * `설정집`이 잠긴 이유(회차 패널 머리 아래). 열 수 있으면 아무것도 그리지 않는다. 운영자 열람 모드는 연결을 권하지 않고 찾지 못했다고만 알린다(남의 작품은 내 세계관 목록에 없다).
 * 데모(`--mode mockup`)의 세계관 저장소에는 소설 연결이 없어 연결을 권하지 않고 지원하지 않는다고 알린다.
 */
export function StudioBookNote({ book, workId, viewOnly }: { book: StudioWorldBook; workId: string; viewOnly: boolean }) {
  const mockup = import.meta.env.MODE === 'mockup'
  if (book.state === 'ready') return null
  return (
    <p id={book.noteId} className="writing-book-note small muted" role={book.state === 'failed' ? 'alert' : 'status'}>
      {book.state === 'loading' ? '연결된 세계관을 확인하고 있어요…'
        : book.state === 'failed' ? <>연결된 세계관을 확인하지 못했어요. <button type="button" className="btn sm" onClick={book.retryLink}>다시 시도</button></>
        : mockup ? '설정집 보기는 데모에서는 지원하지 않아요.'
        : viewOnly ? '연결된 세계관을 찾지 못했어요.'
        : <>설정집은 연결된 세계관이 있어야 볼 수 있어요. <Go to={`/content?work=${encodeURIComponent(workId)}`}>작품 관리에서 세계관을 연결하세요</Go></>}
    </p>
  )
}

/**
 * `설정집` 패널(왼쪽): 검색(제목·본문·별칭·태그)·분류 칩(장수가 있는 묶음, 개수)·게시판형 목록(줄마다 분류 칩·제목·한 줄 요약, 공개 범위를 정하지 않았거나 소설에 없는 회차인 카드는 `작가 전용` 칩, 50개씩 쪽)이다.
 * 읽는 중·실패(이미 읽은 목록은 그대로 두고 알린다)·카드 0장·걸러 낸 결과 없음을 실제 결과대로 알린다. 숨기기만 해(`hidden`) 한 번 연 뒤에는 `회차`로 돌아가도 검색어·분류·고른 카드가 남는다.
 */
export function StudioBookList({ book, hidden }: { book: StudioWorldBook; hidden: boolean }) {
  const { read, paged } = book
  const name = read.world?.name.trim()
  return (
    <div className="writing-rail writing-book" hidden={hidden}>
      <div className="writing-rail-head"><h2>설정집</h2></div>
      {name && <p className="writing-book-name small muted">{name}</p>}
      {read.isError && <p role="alert" className="ep-alert writing-book-alert">설정집을 불러오지 못했어요. <button type="button" className="btn sm" onClick={read.retry}>다시 시도</button></p>}
      {book.categories.isError && <p role="alert" className="ep-alert writing-book-alert">카드 분류를 불러오지 못했어요. <button type="button" className="btn sm" onClick={book.categories.retry}>다시 시도</button></p>}
      {read.isLoading && <p role="status" className="small muted writing-book-empty">설정집을 불러오고 있어요…</p>}
      {read.world && !book.total && <p className="small muted writing-book-empty">이 세계관에는 아직 설정 카드가 없어요.</p>}
      {!!book.total && <>
        <div className="writing-book-tools">
          <label className="sr-only" htmlFor={`${book.noteId}-q`}>설정 검색</label>
          <input id={`${book.noteId}-q`} type="search" className="inp" placeholder="제목·별칭·본문 검색" value={book.query} onChange={(e) => book.setQuery(e.target.value)} />
          <div className="writing-book-kinds" role="group" aria-label="설정 분류">
            <button type="button" aria-pressed={!book.kind} onClick={() => book.pickKind()}>전체 {book.total}</button>
            {book.counts.map(({ kind, count }) => <button key={kind} type="button" aria-pressed={book.kind === kind} onClick={() => book.pickKind(kind)}>{kind} {count}</button>)}
          </div>
          {/* 검색·분류가 걸린 동안에만 결과 수를 알린다. */}
          <p className="small muted" role="status">{book.query.trim() || book.kind ? `설정 ${book.rows.length}개` : ''}</p>
        </div>
        <div className="writing-rail-split">
          <nav ref={book.listRef} className="seps writing-episodes writing-book-list" aria-label="설정 카드 목록">
            {paged.items.map((row) => {
              const on = book.card?.item.id === row.cardId, only = book.authorOnly.has(row.cardId)
              return (
                <button key={row.cardId} type="button" data-card={row.cardId} className={`writing-episode writing-book-row${on ? ' on' : ''}`} aria-pressed={on} aria-label={`${row.title} ${row.type}${only ? ' 작가 전용' : ''}`} onClick={() => book.openCard(row.cardId)}>
                  <span className="writing-book-line"><KindChip kind={row.kind} label={row.type} /><strong>{row.title}</strong>{only && <span className="chip">작가 전용</span>}</span>
                  {row.text && <small>{row.text}</small>}
                </button>
              )
            })}
            {!book.rows.length && <p className="small muted writing-book-empty">조건에 맞는 설정이 없어요.</p>}
          </nav>
          <PageControls label="설정 카드" page={paged.page} pages={paged.pages} onPage={book.setPage} />
        </div>
      </>}
    </div>
  )
}

/** 인물 문서(작가만 보는 SOUL.md·GOAL.md): 본문(IDENTITY.md)은 위의 문서가 이미 보인다. 회차 기억은 세계관 관리에서만 본다. */
function CharacterDocs({ setting, cardLink }: { setting: StudioSetting; cardLink: CardLinkRender }) {
  const heading = useId()
  return (
    <section className="studio-book-docs" aria-labelledby={heading}>
      <h3 id={heading}>인물 문서</h3>
      <p className="small muted">성격·말투와 목표는 작가만 보는 문서예요. 독자에게는 공개되지 않아요.</p>
      {([['성격·말투', 'soul'], ['목표', 'goal']] as const).map(([label, doc]) => {
        const text = characterDocText(setting, doc)
        return <Fragment key={doc}><h4>{label}</h4>{text.trim() ? <CardMarkdown text={text} cardLink={cardLink} /> : <p className="small muted">아직 쓰지 않았어요.</p>}</Fragment>
      })}
    </section>
  )
}

/**
 * 설정 상세(가운데 원고 자리): 세계관 관리 게시판 미리보기와 같은 문서(`CardWikiPreview` 재사용: 정보 상자·카드별 관계도·본문·관계 문단)에 인물 문서를 덧붙인 읽기 전용 화면이다.
 * 맨 위 `원고로 돌아가기`(원고 편집기는 숨겨져 있었을 뿐이라 그대로다)와 `세계관에서 편집`(새 탭, DEC-36: 고치는 일은 세계관 관리가 한다). 본문의 설정 링크·관계도의 이웃·관계 문단의 상대는 그 카드의 상세로 바뀐다.
 */
export function StudioBookDetail({ book }: { book: StudioWorldBook }) {
  const heading = useId()
  const { card, row, read } = book
  if (!card || !row || !read.world) return null
  const world = read.world, title = card.item.title || '이름 없는 설정'
  const known = new Set(world.settings.filter((s) => isCard(s.item)).map((s) => s.item.id))
  const cardLink: CardLinkRender = (id, label) => (known.has(id) ? <button type="button" className="card-relmap-link" onClick={() => book.openCard(id)}>{label}</button> : undefined)
  return (
    <section className="editor writing-editor studio-book-detail" aria-labelledby={heading}>
      <div className="studio-book-bar">
        <button type="button" className="btn sm" onClick={book.back}><BackChev />원고로 돌아가기</button>
        <a className="btn sm" href={`/worldstudio/${encodeURIComponent(world.id)}?card=${encodeURIComponent(card.item.id)}`} target="_blank" rel="noreferrer">세계관에서 편집</a>
      </div>
      <h2 id={heading} ref={book.headingRef} tabIndex={-1} className="sr-only">{title} 설정 상세</h2>
      {(world.relationshipStatus === 'incomplete' || world.relationshipStatus === 'migration_required') && <p role="status" className="small muted">관계 정보가 완전하지 않아 관계도에 빠진 연결이 있을 수 있어요.</p>}
      <CardWikiPreview settings={world.settings} setting={card} row={row} linked limit={book.limit} images={book.images} onOpen={book.openCard} />
      {cardTypeOf(card.item) === 'character' && <CharacterDocs setting={card} cardLink={cardLink} />}
    </section>
  )
}

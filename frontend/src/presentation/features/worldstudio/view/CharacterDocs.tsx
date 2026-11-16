import { type FormEvent, type ReactNode, useEffect, useId, useRef, useState } from 'react'

import { characterDocName, type CharacterDocKey, episodeDocFile } from '../../../../domain/entities/characterDocs'
import type { useCharacterDocs } from '../viewmodel/useCharacterDocs'

/** 문서마다 무엇을 쓰는지 한 줄 안내 */
const GUIDES = {
  identity: '누구인가: 이름·나이·소속·외형·역할.',
  soul: '어떻게 생각하고 말하는가: 성격·가치관·말투·욕망·두려움.',
  goal: '무엇을 원하고 하려는가: 이 인물의 목표·동기·하려는 일.',
} as const
/** 0회차 기억(`00회차.md`)이 무엇인지: 회차 기억 추가 폼 아래 안내와 그 문서의 작성 안내가 함께 쓴다(DEC-47). */
const START_NOTE = '이야기 시작 전부터 아는 것(비밀·과거)'
const FLAGS = { missing: '정리 필요', over: '3,000자 초과' } as const
/** 탭: 작가의 말 라벨이 주이고 파일 이름은 보조 글씨다. 공개 세계관·독자 설정 위키에 나가는 글은 IDENTITY.md뿐이라 그 탭만 `공개`, 나머지는 `작가만`이다. */
const TABS = [['identity', '정체성', '공개'], ['soul', '성격·말투', '작가만'], ['goal', '목표', '작가만']] as const

/**
 * 인물 문서(편집 화면의 인물 카드): 설명 편집기 자리에 문서 탭 줄과 고른 문서의 편집기(`children`)를 둔다. 탭 줄은 편집기 바로 위이고 그 사이에는 고른 문서의 안내 한 줄뿐이다.
 * - 탭은 `정체성`·`성격·말투`·`목표`·`회차 기억 (N)`이다. 라벨 아래 줄에 파일 이름(`IDENTITY.md`·`SOUL.md`·`GOAL.md`, 문서 저장 이름은 그대로)과 공개 범위(`공개`·`작가만`)를 작게 보인다. 문서 저장 형식·파일 이름은 바꾸지 않고 화면 라벨만 다르다.
 *   버튼으로 옮겨 다니고 고른 문서는 `aria-current`다. 비어 있는 정체성·성격·목표에는 `정리 필요`(알리기만 한다), 3,000자를 넘은 문서에는 `3,000자 초과`(저장 영역이 막는다)를 탭 안의 글로 붙인다.
 * - `회차 기억 (N)`은 펼침 버튼(`aria-expanded`)이다. 펼치면 회차별 문서 버튼(`NN회차.md`, 고른 것은 `aria-current`)과 회차 번호(숫자만) + `추가`가 보인다: 이미 있는 회차면 그 문서를 고르고 없으면 만들어 고른다.
 *   0회차는 이야기 시작 전부터 아는 것이라고 폼 아래에서 알린다(옛 MEMORY.md가 옮겨 오는 자리다). 그 문서를 고른 동안은 편집기 위 안내가 같은 말을 하므로 되풀이하지 않는다.
 *   회차 문서를 고르면 접혀 있어도 이 탭에 그 파일 이름이 남고 고른 문서 모양이 된다. `회차 기억 삭제`는 회차별 기억을 고른 동안에만 편집기 아래에 있고 확인을 받은 뒤 지운다: 누른 버튼이 사라지므로 초점은 돌아온 문서(정체성) 탭으로 옮긴다.
 * - `.md 파일 불러오기`는 제목 줄 오른쪽 `⋯`(인물 문서 더보기) 메뉴 안에 있다. 여러 파일을 받아 파일 이름으로 문서를 정한다. 기본 파일 입력은 숨기지 않고 라벨 버튼 위에 투명하게 덮어(`.ep-file-pick`) 키보드로 닿는다.
 *   `<details>`는 ⋯를 다시 눌러야만 닫혀 열린 채 뒤의 탭을 덮으므로, 메뉴 밖을 누르거나 밖으로 초점이 가면(`pointerdown`·`focusin`, PopMenu와 같은 방식) 닫고 Esc는 닫고 초점을 ⋯로 돌려준다.
 *   파일을 고르면 메뉴를 닫아 결과(제목 줄 아래 상태 문구)를 가리지 않는다.
 */
export function CharacterDocs({ docs, children }: { docs: ReturnType<typeof useCharacterDocs>; children: ReactNode }) {
  const [episode, setEpisode] = useState('') // 추가할 회차 번호(숫자만)
  const [memory, setMemory] = useState(false) // 회차 기억 펼침
  const list = useRef<HTMLElement>(null)
  const more = useRef<HTMLDetailsElement>(null)
  const startHint = useId()
  const [removed, setRemoved] = useState(0)
  useEffect(() => {
    if (removed) list.current?.querySelector<HTMLElement>('[aria-current]')?.focus()
  }, [removed])
  useEffect(() => {
    const away = (e: Event) => { if (more.current?.open && !more.current.contains(e.target as Node)) more.current.open = false }
    document.addEventListener('pointerdown', away)
    document.addEventListener('focusin', away)
    return () => { document.removeEventListener('pointerdown', away); document.removeEventListener('focusin', away) }
  }, [])
  const closeMore = () => {
    if (more.current) more.current.open = false
    more.current?.querySelector<HTMLElement>('summary')?.focus() // 사라질 입력 대신 ⋯로 초점을 돌려준다
  }
  const flag = (key: CharacterDocKey) => {
    const mark = docs.flagOf(key)
    return mark && <> <span className="world-doc-flag" data-flag={mark}>{FLAGS[mark]}</span></>
  }
  const button = (key: CharacterDocKey, label: ReactNode, className?: string) => (
    <button key={key} type="button" className={className} aria-current={docs.doc === key ? 'true' : undefined} onClick={() => docs.select(key)}>{label}</button>
  )
  const episodeDoc = typeof docs.doc === 'number' ? episodeDocFile(docs.doc) : undefined
  // 번호가 비어 있으면 입력의 required가 제출을 막는다.
  const add = (e: FormEvent) => {
    e.preventDefault()
    docs.addEpisode(Number(episode))
    setEpisode('')
  }
  return (
    <section className="world-docs" aria-label="인물 문서">
      <div className="world-docs-head">
        <h4>인물 문서</h4>
        <details ref={more} className="world-docs-more" onKeyDown={(e) => { if (e.key === 'Escape') closeMore() }}>
          <summary aria-label="인물 문서 더보기">⋯</summary>
          <div className="world-docs-menu">
            <label className="btn sm ep-file-pick">
              .md 파일 불러오기
              <input type="file" accept=".md,text/markdown" multiple onChange={(e) => {
                const input = e.currentTarget
                const files = Array.from(input.files ?? [])
                input.value = ''
                closeMore() // 메뉴가 결과 문구를 가리지 않게 닫는다
                void docs.importFiles(files)
              }} />
            </label>
          </div>
        </details>
      </div>
      {docs.notice.length > 0 && <div role="status" className="world-notice world-doc-notice">{docs.notice.map((line) => <p key={line}>{line}</p>)}</div>}
      <nav ref={list} className="world-doc-list" aria-label="인물 문서 목록">
        <div className="world-rail-kinds">
          {TABS.map(([key, label, scope]) => button(key, <>
            <span className="world-doc-name">{label}</span> <small className="world-doc-file">{characterDocName(key)}</small> <small className="world-doc-scope">{scope}</small>{flag(key)}
          </>, 'world-doc-tab'))}
          <button type="button" className="world-doc-tab" aria-expanded={memory} data-current={episodeDoc ? 'true' : undefined} onClick={() => setMemory(!memory)}>
            <span className="world-doc-name">회차 기억 ({docs.episodes.length}) <span aria-hidden="true">{memory ? '▴' : '▾'}</span></span> <small className="world-doc-file">{episodeDoc ?? 'memory/'}</small> <small className="world-doc-scope">작가만</small>
          </button>
        </div>
        {memory && (
          <div className="world-doc-memory">
            <div className="world-rail-kinds" role="group" aria-label="회차별 기억">
              {docs.episodes.map((n) => button(n, <>{episodeDocFile(n)}{flag(n)}</>))}
              {!docs.episodes.length && <span className="small muted">아직 회차 기억이 없어요.</span>}
            </div>
            <form className="world-doc-add" onSubmit={add}>
              <label>
                회차 번호
                {/* 15자리까지면 늘 안전한 정수다(그보다 큰 수는 회차 번호로 다시 읽지 못한다). */}
                <input className="inp" type="text" inputMode="numeric" pattern="[0-9]*" autoComplete="off" required maxLength={15} aria-describedby={docs.doc === 0 ? undefined : startHint} value={episode} onChange={(e) => setEpisode(e.target.value.replace(/\D/g, ''))} />
              </label>
              <button type="submit" className="btn sm" aria-label="회차 기억 추가">추가</button>
            </form>
            {docs.doc !== 0 && <p id={startHint} className="small muted">0회차는 {START_NOTE}이에요.</p>}
          </div>
        )}
      </nav>
      <p className="small muted world-doc-guide"><strong>{docs.name}</strong> {typeof docs.doc !== 'number' ? GUIDES[docs.doc] : docs.doc === 0 ? `${START_NOTE}.` : `${docs.doc}화에서 겪은 일과 알게 된 사실.`}</p>
      {children}
      {typeof docs.doc === 'number' && (
        <div className="world-doc-tools">
          <button type="button" className="btn sm world-danger" onClick={() => { if (docs.removeEpisode()) setRemoved((n) => n + 1) }}>회차 기억 삭제</button>
        </div>
      )}
    </section>
  )
}

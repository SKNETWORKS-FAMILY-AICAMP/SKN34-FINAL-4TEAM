import { type FormEvent, type ReactNode, useEffect, useRef, useState } from 'react'

import { characterDocName, type CharacterDocKey, episodeDocFile } from '../../../../domain/entities/characterDocs'
import type { useCharacterDocs } from '../viewmodel/useCharacterDocs'

/** 문서마다 무엇을 쓰는지 한 줄 안내 */
const GUIDES = {
  identity: '누구인가: 이름·나이·소속·외형·역할.',
  soul: '어떻게 생각하고 말하는가: 성격·가치관·말투·욕망·두려움.',
  memory: '이야기 전체에 걸쳐 유지되는 핵심 기억·관계·비밀.',
} as const
const FLAGS = { missing: '정리 필요', over: '3,000자 초과' } as const

/**
 * 인물 문서(편집 화면의 인물 카드): 설명 편집기 자리에 문서 목록과 고른 문서의 편집기(`children`)를 둔다.
 * - 문서 목록은 파일 이름 그대로다: `IDENTITY.md`(카드 본문) · `SOUL.md` · `MEMORY.md`, 그리고 `memory/` 아래 회차별 기억 `NN회차.md`. 버튼으로 옮겨 다니고 고른 문서는 `aria-current`다.
 *   비어 있는 IDENTITY·SOUL·MEMORY에는 `정리 필요`(알리기만 한다), 3,000자를 넘은 문서에는 `3,000자 초과`(저장 영역이 막는다)를 글로 붙인다.
 * - `회차 기억 추가`는 회차 번호(숫자만)를 받아 그 문서를 만들어 고르고, 이미 있으면 그 문서를 고른다. `회차 기억 삭제`는 회차별 기억을 고른 동안에만 있고 확인을 받은 뒤 지운다:
 *   누른 버튼이 사라지므로 초점은 돌아온 문서(IDENTITY.md)의 버튼으로 옮긴다.
 * - `.md 파일 불러오기`는 여러 파일을 받아 파일 이름으로 문서를 정한다. 기본 파일 입력은 숨기지 않고 라벨 버튼 위에 투명하게 덮어(`.ep-file-pick`) 키보드로 닿는다. 결과는 그 아래 상태 문구로 남는다.
 * SOUL.md·MEMORY.md·회차별 기억은 작가용이라 공개 세계관·독자 설정 위키에 나가지 않는다는 것을 한 줄로 알린다.
 */
export function CharacterDocs({ docs, children }: { docs: ReturnType<typeof useCharacterDocs>; children: ReactNode }) {
  const [episode, setEpisode] = useState('') // 추가할 회차 번호(숫자만)
  const list = useRef<HTMLElement>(null)
  const [removed, setRemoved] = useState(0)
  useEffect(() => {
    if (removed) list.current?.querySelector<HTMLElement>('[aria-current]')?.focus()
  }, [removed])
  const button = (key: CharacterDocKey, label: string) => {
    const flag = docs.flagOf(key)
    return (
      <button key={key} type="button" aria-current={docs.doc === key ? 'true' : undefined} onClick={() => docs.select(key)}>
        {label}{flag && <> <span className="world-doc-flag" data-flag={flag}>{FLAGS[flag]}</span></>}
      </button>
    )
  }
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
        <label className="btn sm ep-file-pick">
          .md 파일 불러오기
          <input type="file" accept=".md,text/markdown" multiple onChange={(e) => { const files = Array.from(e.target.files ?? []); e.target.value = ''; void docs.importFiles(files) }} />
        </label>
      </div>
      <p className="small muted">공개 세계관과 독자 설정 위키에 나가는 글은 IDENTITY.md뿐이에요. SOUL.md·MEMORY.md·회차별 기억은 작가만 봐요.</p>
      {docs.notice.length > 0 && <div role="status" className="world-notice world-doc-notice">{docs.notice.map((line) => <p key={line}>{line}</p>)}</div>}
      <nav ref={list} className="world-doc-list" aria-label="인물 문서 목록">
        <div className="world-rail-kinds">
          {(['identity', 'soul', 'memory'] as const).map((key) => button(key, characterDocName(key)))}
        </div>
        <div className="world-rail-kinds" role="group" aria-label="회차별 기억 (memory/)">
          <span className="world-doc-dir" aria-hidden="true">memory/</span>
          {docs.episodes.map((n) => button(n, episodeDocFile(n)))}
          {!docs.episodes.length && <span className="small muted">아직 회차 기억이 없어요.</span>}
        </div>
      </nav>
      <form className="world-doc-add" onSubmit={add}>
        {/* 15자리까지면 늘 안전한 정수다(그보다 큰 수는 회차 번호로 다시 읽지 못한다). */}
        <input className="inp" type="text" inputMode="numeric" pattern="[0-9]*" autoComplete="off" required maxLength={15} aria-label="추가할 회차 번호" value={episode} onChange={(e) => setEpisode(e.target.value.replace(/\D/g, ''))} />
        <span aria-hidden="true">회차</span>
        <button type="submit" className="btn sm">회차 기억 추가</button>
      </form>
      <p className="small muted world-doc-guide"><strong>{docs.name}</strong> {typeof docs.doc === 'number' ? `${docs.doc}화에서 겪은 일과 알게 된 사실.` : GUIDES[docs.doc]}</p>
      {children}
      {typeof docs.doc === 'number' && (
        <div className="world-doc-tools">
          <button type="button" className="btn sm world-danger" onClick={() => { if (docs.removeEpisode()) setRemoved((n) => n + 1) }}>회차 기억 삭제</button>
        </div>
      )}
    </section>
  )
}

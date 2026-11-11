import { useState, type KeyboardEvent } from 'react'
import type { Work } from '../../../../domain/entities/content'
import { Go } from '../../../shared/Go'
import { useStoredImage } from '../../../shared/media/useMediaViewModel'
import { paginate } from '../viewmodel/paginate'
import { useServerWorks } from '../viewmodel/useServerWorks'
import { Pager } from './Pager'
import './server-writing.css'

/** 서버에 올린 표지를 이어 읽기 카드와 같은 3:4 썸네일로 보인다. 표지가 없거나 불러오지 못하면 기본 표지를 둔다. */
// ponytail: 카드마다 표지를 따로 요청한다(없으면 404). 작품이 많아지면 작품 목록 응답에 표지 유무를 실어 요청을 줄인다.
function Cover({ id }: { id: string }) {
  const { url, error } = useStoredImage({ kind: 'cover', workId: id }, '')
  // 요청이 끝나기 전에는 비워 둔다. 표지가 있는 작품이 기본 표지에서 실제 표지로 바뀌며 깜빡이지 않게 한다.
  return <div className="th">{url || error ? <img className="cimg" src={url || '/default-work-cover.svg'} alt="" /> : null}</div>
}

const TABS = [['all', '전체'], ['original', '원작'], ['fork', '포크 작품']] as const
type Kind = (typeof TABS)[number][0]
const KEEP: Record<Kind, (work: Work) => boolean> = { all: () => true, original: work => !work.source, fork: work => !!work.source }

/** 팀 서재의 카드와 진입 경로를 사용하되 데모 데이터와 합치지 않는다. Fork 관리는 작품 관리 페이지(/content)가 맡는다. */
export function ServerWritingList() {
  const vm = useServerWorks()
  const [kind, setKind] = useState<Kind>('all')
  const [page, setPage] = useState(1)
  const view = paginate(vm.works.filter(KEEP[kind]), page)
  const pick = (next: Kind) => { setKind(next); setPage(1) }
  // 선택한 탭이 곧 포커스를 가진 탭이다. 좌우 화살표·Home·End로 옮기면 바로 선택한다(끝에서 처음으로 이어짐, 소설 상세 탭과 같은 방식).
  const move = (event: KeyboardEvent<HTMLDivElement>) => {
    const at = TABS.findIndex(([key]) => key === kind)
    const to = event.key === 'ArrowRight' ? at + 1 : event.key === 'ArrowLeft' ? at - 1 : event.key === 'Home' ? 0 : event.key === 'End' ? TABS.length - 1 : null
    if (to === null) return
    event.preventDefault()
    const next = (to + TABS.length) % TABS.length
    pick(TABS[next][0])
    event.currentTarget.querySelectorAll<HTMLElement>('[role="tab"]')[next]?.focus()
  }
  return <section className="server-writing" aria-label="집필 중인 작품" aria-busy={vm.loading}>
    <div className="sec-h"><h2>집필 중인 작품</h2></div>
    {vm.error ? <div className="server-writing-error"><p role="alert">{vm.error}</p><button type="button" className="btn sm" onClick={vm.reload}>다시 시도</button></div>
      : vm.loading && !vm.works.length ? <p role="status">작품을 불러오고 있어요…</p>
      : !vm.works.length ? <p className="note2">아직 서버에 저장된 작품이 없어요. {import.meta.env.MODE === 'mockup' ? '아래 새 소설 등록은 현재 데모이며 서버 등록 연결은 준비 중이에요.' : '아래에서 새 소설을 시작해 보세요.'}</p>
      : <>
        <div className="libtabs" role="tablist" aria-label="작품 구분" onKeyDown={move}>{TABS.map(([key, label]) =>
          <button key={key} type="button" role="tab" id={`server-writing-tab-${key}`} className={kind === key ? 'on' : ''} aria-selected={kind === key} aria-controls="server-writing-panel" tabIndex={kind === key ? 0 : -1} onClick={() => pick(key)}>{label} {vm.works.filter(KEEP[key]).length}</button>)}
        </div>
        <div role="tabpanel" id="server-writing-panel" aria-labelledby={`server-writing-tab-${kind}`}>
          {view.items.length ? <div className="list">{view.items.map(work => <article className="li" key={work.id}>
            <Cover id={work.id} />
            <div className="server-writing-content"><h3>{work.title}</h3>
              <div className="m">{work.visibility === 'public' ? '공개 중' : '비공개'}{work.source && ` · Fork · 「${work.source.title}」 ${work.source.episode}화에서`}</div>
              {work.summary && <p className="m server-summary">{work.summary}</p>}
            </div>
            <div className="acts">
              <Go className="btn sm" to={`/content?work=${work.id}`} aria-label={`${work.title} 수정하기`}>수정하기</Go>
              <Go className="btn sm pri" to={`/studio/${work.id}`} aria-label={`${work.title} 회차 작성하기`}>회차 작성하기</Go>
            </div>
          </article>)}</div>
            : <p className="note2">{kind === 'fork' ? '아직 만든 포크가 없어요.' : '아직 만든 원작이 없어요.'}</p>}
          <Pager page={view.page} pages={view.pages} onPage={setPage} />
        </div>
      </>}
  </section>
}

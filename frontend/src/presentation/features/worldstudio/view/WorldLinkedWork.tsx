import { useEffect, useId, useRef } from 'react'

import { Go } from '../../../shared/Go'
import { Sheet } from '../../../shared/Sheet'
import { useLinkedForks, useLinkedWork, useNovelLink } from '../viewmodel/useWorldNovelLink'
import type { useWorldStudioViewModel } from '../viewmodel/useWorldStudioViewModel'

type VM = ReturnType<typeof useWorldStudioViewModel>

/** 연결 상태 한 줄의 글. 정보만이다(링크·버튼 없음): `연결된 소설: 제목`·`연결된 소설이 없어요.`·확인 중·제목 읽기 실패. */
const linkedText = (linked: string | null, title: string | undefined, isLoading: boolean) =>
  !linked ? '연결된 소설이 없어요.' : title ? `연결된 소설: ${title}` : isLoading ? '연결된 소설을 확인하고 있어요…' : '연결된 소설의 제목을 불러오지 못했어요.'

/**
 * 작성 모드(마법사) 헤더의 연결 상태 줄(DEC-46: 세계관과 소설은 1:1). 정보만 보인다: `연결된 소설: 제목` 또는 `연결된 소설이 없어요.`
 * 이동·연결은 아래 행동 줄의 소설 버튼 한 자리(`WorldNovelButton`)가 맡아, 같은 곳으로 가는 링크를 두 개 두지 않는다. 관리 모드는 이 줄을 헤더에 두지 않고 '소설 연결' 탭(`WorldNovelTab`)이 보인다.
 * 제목은 내 소설 목록에서 찾고 연결돼 있을 때만 읽으며, 읽지 못하면 그렇다고 알린다. 서버가 없는 데모(mockup)에는 연결이 없어 그리지 않는다.
 */
export function WorldLinkedLine({ vm }: { vm: VM }) {
  const demo = import.meta.env.MODE === 'mockup'
  const linked = demo ? null : vm.linkedWorkId
  const { title, isLoading } = useLinkedWork(linked)
  if (demo) return null
  return <p className={`small world-linked${title ? '' : ' muted'}`}>{linkedText(linked, title, isLoading)}</p>
}

/**
 * 소설 버튼 한 자리(작성 모드는 헤더 행동 줄, 관리 모드는 '소설 연결' 탭). 연결된 소설이 있으면 그 작품 관리로 가는 `소설 작성하기`, 없으면 같은 자리에 `소설 연결하기`다(서버가 없는 데모는 연결 없이 새 소설 폼으로 가는 `소설 작성하기`).
 * `소설 연결하기`는 내 소설 중 아직 세계관에 연결되지 않은 것만 고르는 시트를 열고, 고르면 서버에 바로 연결한다(초안 저장과 별개). 연결되면 이 자리가 `소설 작성하기`로 바뀌고 초점도 거기로 간다.
 * 시트에는 새로 쓰려는 사람을 위해 작품 만들기(`/content`)로 가는 `새 소설 만들기`가 늘 있다(만든 소설은 돌아와서 연결한다). 목록 조회·연결이 실패하면 서버가 준 이유를 그대로 알린다.
 * 내 소설 목록은 시트를 열 때만 읽는다. 연결 해제는 작품 관리 화면이 맡는다. 조회·연결은 `useNovelLink`(ViewModel)가 한다.
 */
export function WorldNovelButton({ vm }: { vm: VM }) {
  const demo = import.meta.env.MODE === 'mockup'
  const writeId = useId()
  // 연결하면 누른 버튼이 사라지므로 같은 자리에 생긴 `소설 작성하기`로 초점을 옮긴다.
  const justLinked = useRef(false)
  const novel = useNovelLink(vm.saved?.id, (workId) => {
    justLinked.current = true
    vm.setLinkedWork(workId)
  })
  useEffect(() => {
    if (!justLinked.current || !vm.linkedWorkHref) return
    justLinked.current = false
    document.getElementById(writeId)?.focus()
  }, [vm.linkedWorkHref, writeId])
  if (demo || vm.linkedWorkHref) return <Go id={writeId} to={vm.linkedWorkHref ?? '/new'} className="btn sm">소설 작성하기</Go>
  return (
    <>
      <button type="button" className="btn sm" aria-haspopup="dialog" onClick={novel.openSheet}>소설 연결하기</button>
      {novel.open && (
        <Sheet sid="W01" label="소설 연결하기" panelClass="sheet world-sheet" onClose={novel.close}>
          <div className="world-sheet-head"><h3>소설 연결하기</h3><button type="button" className="btn sm" onClick={novel.close}>닫기</button></div>
          <p className="small muted">세계관은 소설 하나에만 연결돼요.</p>
          {novel.problem && <p role="alert" className="world-error">{novel.problem}</p>}
          {novel.isLoading ? <p role="status">내 소설을 불러오고 있어요…</p>
            : novel.failed ? <p role="alert">내 소설을 불러오지 못했어요. <button type="button" className="btn sm" onClick={novel.retry}>다시 시도</button></p>
            : novel.free.length ? (
              <ul className="world-pick-list">
                {novel.free.map((work) => (
                  <li key={work.id}>
                    <button type="button" disabled={novel.linking} onClick={() => void novel.link(work)}>
                      <strong>{work.title}</strong>
                      <small>{work.episodes.length ? `${work.episodes.length}화 발행` : '발행한 회차 없음'}</small>
                    </button>
                  </li>
                ))}
              </ul>
            )
            : <p className="muted">연결할 수 있는 소설이 없어요.</p>}
          <p className="small muted world-sheet-more">소설을 새로 쓰려면 <Go to="/content">새 소설 만들기</Go>에서 만든 뒤 여기서 연결하세요.</p>
        </Sheet>
      )}
    </>
  )
}

/**
 * '소설 연결' 탭(관리 모드, 주소 `?view=novel`): 연결된 소설과 그 Fork 소설을 함께 본다. 헤더에 있던 연결 상태 줄·소설 버튼이 이리로 옮겨 왔다(소설 버튼은 여전히 한 자리).
 * - 연결됨: 원작 행(제목 + `원작`, Fork 행과 같은 모양의 링크로 그 소설 상세 `/work/<id>`)과 `소설 작성하기`(그 작품 관리). 제목을 읽는 중이거나 읽지 못했으면 그렇다고 알리는 글(정보만)이 원작 행 자리에 온다. 연결되지 않았으면 `연결된 소설이 없어요.`와 `소설 연결하기`(시트·초점 이동은 `WorldNovelButton` 그대로)뿐이고 Fork는 읽지 않는다.
 * - `Fork 소설 N편`: 연결된 소설에서 갈라진 **공개 Fork만**(숨김·비공개가 아니고 자체 회차가 1개 이상, `ReadingUseCase.forksOf` = 소설 상세·`/ifs`와 같은 목록, 새 API 없음)이다. 0편이면 그 기준을 문구로 알리고, 읽지 못하면 실패와 `다시 시도`를 보인다.
 *   행은 그 Fork 소설(`/work/<id>`)로 가고 보조 글에 작가·분기 회차·자체 회차를 적는다(같은 목록이 이 탭에 다 보여 모아 보기 링크는 두지 않는다).
 * 소설 목록·Fork 목록은 이 탭을 열 때만 읽는다. 서버가 없는 데모(mockup)는 `소설 작성하기`(→ `/new`)만 두고 Fork는 그리지 않는다.
 */
export function WorldNovelTab({ vm }: { vm: VM }) {
  const demo = import.meta.env.MODE === 'mockup'
  const linked = demo ? null : vm.linkedWorkId
  const work = useLinkedWork(linked)
  const forks = useLinkedForks(linked)
  return (
    <section className="world-novel" aria-label="소설 연결">
      <h2>연결된 소설</h2>
      {!demo && (linked && work.title
        ? <ul className="world-fork-list"><li><Go to={`/work/${encodeURIComponent(linked)}`} className="world-card-link">{work.title}<small>원작</small></Go></li></ul>
        : <p className="small world-linked muted">{linkedText(linked, work.title, work.isLoading)}</p>)}
      <div className="ep-card-actions" data-tour="world-novel-link">
        <WorldNovelButton vm={vm} />
      </div>
      {linked && (
        <div className="world-forks" data-tour="world-novel-forks">
          <h2>{forks.data ? `Fork 소설 ${forks.data.length}편` : 'Fork 소설'}</h2>
          {forks.isLoading ? <p role="status" className="small muted">Fork 소설을 불러오고 있어요…</p>
            : !forks.data ? <p role="alert">Fork 소설을 불러오지 못했어요. <button type="button" className="btn sm" onClick={forks.retry}>다시 시도</button></p>
            : !forks.data.length ? <p className="muted">아직 공개된 Fork 소설이 없어요. 회차를 하나 이상 발행한 공개 Fork만 보여요.</p>
            : (
              <>
                <ul className="world-fork-list">
                  {forks.data.map((fork) => (
                    <li key={fork.id}>
                      <Go to={`/work/${encodeURIComponent(fork.id)}`} className="world-card-link">
                        {fork.title}
                        <small>{[fork.author, fork.forkAt ? `${fork.forkAt}화에서 분기` : null, `자체 ${fork.eps.length}화`].filter(Boolean).join(' · ')}</small>
                      </Go>
                    </li>
                  ))}
                </ul>
              </>
            )}
        </div>
      )}
    </section>
  )
}

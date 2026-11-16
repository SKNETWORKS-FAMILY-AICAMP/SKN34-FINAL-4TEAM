import { useEffect, useId, useRef } from 'react'

import { Go } from '../../../shared/Go'
import { Sheet } from '../../../shared/Sheet'
import { useLinkedWorkTitle, useNovelLink } from '../viewmodel/useWorldNovelLink'
import type { useWorldStudioViewModel } from '../viewmodel/useWorldStudioViewModel'

type VM = ReturnType<typeof useWorldStudioViewModel>

/**
 * 헤더의 연결 상태 줄(DEC-46: 세계관과 소설은 1:1). 정보만 보인다: `연결된 소설: 제목` 또는 `연결된 소설이 없어요.`
 * 이동·연결은 아래 행동 줄의 소설 버튼 한 자리(`WorldNovelButton`)가 맡아, 같은 곳으로 가는 링크를 두 개 두지 않는다.
 * 제목은 내 소설 목록에서 찾고 연결돼 있을 때만 읽으며, 읽지 못하면 그렇다고 알린다. 서버가 없는 데모(mockup)에는 연결이 없어 그리지 않는다.
 */
export function WorldLinkedLine({ vm }: { vm: VM }) {
  const demo = import.meta.env.MODE === 'mockup'
  const linked = demo ? null : vm.linkedWorkId
  const { title, isLoading } = useLinkedWorkTitle(linked)
  if (demo) return null
  return (
    <p className={`small world-linked${title ? '' : ' muted'}`}>
      {!linked ? '연결된 소설이 없어요.' : title ? `연결된 소설: ${title}` : isLoading ? '연결된 소설을 확인하고 있어요…' : '연결된 소설의 제목을 불러오지 못했어요.'}
    </p>
  )
}

/**
 * 헤더 행동 줄의 소설 버튼 한 자리. 연결된 소설이 있으면 그 작품 관리로 가는 `소설 작성하기`, 없으면 같은 자리에 `소설 연결하기`다(서버가 없는 데모는 연결 없이 새 소설 폼으로 가는 `소설 작성하기`).
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
          <p className="small muted">세계관 하나는 소설 하나에만 연결해요. 연결하면 설정마다 독자 공개 회차를 정해 그 소설의 독자 설정 위키에 보일 수 있어요.</p>
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
            : <p className="muted">연결할 수 있는 소설이 없어요. 다른 세계관에 연결되지 않은 내 소설만 고를 수 있어요.</p>}
          <p className="small muted world-sheet-more">소설을 새로 쓰려면 <Go to="/content">새 소설 만들기</Go>에서 만든 뒤 여기서 연결하세요.</p>
        </Sheet>
      )}
    </>
  )
}

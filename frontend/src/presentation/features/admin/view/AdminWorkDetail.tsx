import { useEffect, useRef } from 'react'

import { publicationStatusLabel, rightsLabel, type OperationsEpisode, type OperationsWork } from '../../../../domain/entities/operationsWork'
import { isListedWorld, WORLDS_FORBIDDEN, worldStatusLabel } from '../../../../domain/entities/operationsWorld'
import type { useAdminViewModel } from '../viewmodel/useAdminViewModel'
import { episodeKey, useWorkDetailViewModel } from '../viewmodel/useWorkDetailViewModel'
import { AdminActionStatus, LiveState, Table } from './OperationsPanels'

type VM = ReturnType<typeof useAdminViewModel>
type Detail = ReturnType<typeof useWorkDetailViewModel>

/**
 * 작품 상세 드로어(결정 C): 작품 표의 행을 누르거나 ⋮ 메뉴의 '상세'를 고르면 화면 오른쪽에 열린다. 회차 번호·제목·발행 상태·제한 상태·상속 여부와
 * 회차 제한·해제 버튼, 연결된 세계관을 보인다. 열면 제목으로 초점이 가고 Esc나 닫기로 닫는다(모달이 아니라 뒤 화면은 그대로 쓸 수 있다).
 * 회차 제한은 독자 열람·조회수 기록·댓글만 막고 작가 집필은 그대로이며, 상속 회차는 원작 회차를 제한해야 해서 버튼을 잠근다(결정 A).
 */
export function AdminWorkDetail({ vm, work, onClose }: { vm: VM; work: OperationsWork; onClose: () => void }) {
  const d = useWorkDetailViewModel(work.workId, vm.live.mutate)
  const heading = useRef<HTMLHeadingElement>(null)
  useEffect(() => { heading.current?.focus() }, [work.workId])
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      // 한글 조합 중 Esc는 조합을 취소하는 키다.
      if (e.key === 'Escape' && !e.isComposing && e.keyCode !== 229) onClose()
    }
    document.addEventListener('keydown', key)
    return () => document.removeEventListener('keydown', key)
  }, [onClose])
  const episodes = d.episodes.data
  const prefix = `episode:${work.workId}:`
  const targetOf = (key: string) => `${key.slice(prefix.length)}화`
  return (
    <aside className="admin-drawer" aria-label={`「${work.title}」 작품 상세`}>
      <div className="admin-drawer-head">
        <div>
          <h2 ref={heading} tabIndex={-1}>{work.title}</h2>
          <p className="small muted">{work.authorName} · {work.originKind === 'fork' ? '포크' : '원작'} · {rightsLabel(work)}</p>
        </div>
        <button type="button" className="btn sm" onClick={onClose}>닫기</button>
      </div>
      <p>
        <span className={`chip ${work.restricted ? 'wait' : 'ok'}`}>{work.restricted ? '작품 운영 제한' : work.visibility === 'public' ? '공개' : '비공개'}</span>
      </p>
      <h3>연결 세계관</h3>
      <LinkedWorld d={d} workId={work.workId} />
      <h3>회차{episodes ? ` ${episodes.length}개` : ''}</h3>
      <LiveState vm={vm} label="회차 목록" state={d.episodes} />
      {episodes && (
        <Table label="회차 표">
          <thead>
            <tr>
              <th scope="col">회차</th>
              <th scope="col">제목</th>
              <th scope="col">발행</th>
              <th scope="col">제한</th>
              <th scope="col">상속</th>
              <th scope="col" className="act"><span className="sr-only">조치</span></th>
            </tr>
          </thead>
          <tbody>
            {episodes.length
              ? episodes.map((episode) => <EpisodeRow key={episode.number} vm={vm} d={d} workId={work.workId} episode={episode} />)
              : <tr><td colSpan={6} className="muted">회차가 없어요.</td></tr>}
          </tbody>
        </Table>
      )}
      {Object.entries(vm.actions)
        .filter(([key, state]) => key.startsWith(prefix) && (state.pending || state.error))
        .map(([key, state]) => <AdminActionStatus key={key} state={{ ...state, message: '' }} target={targetOf(key)} />)}
      {vm.lastSuccessKey.startsWith(prefix) && vm.lastSuccess && <p className="admin-note" role="status">{vm.lastSuccess}</p>}
      <p className="admin-note">
        회차를 제한하면 독자 열람·조회수 기록·댓글이 막혀요(404). 작가의 집필은 그대로예요. 이 회차를 상속한 Fork의 회차도 함께 숨겨지고, 제한한 회차를 기준으로 새 Fork를 만들 수 없어요.
        상속 회차는 직접 제한할 수 없어요. 원작 작품의 같은 회차를 제한해 주세요.
      </p>
    </aside>
  )
}

function LinkedWorld({ d, workId }: { d: Detail; workId: string }) {
  const state = d.worlds
  const worlds = state.data
  if (state.isError) {
    return (
      <div className="admin-action-error" role="alert">
        <p>연결 세계관을 불러오지 못했어요.</p>
        <button type="button" className="btn sm" onClick={state.retry}>다시 불러오기</button>
      </div>
    )
  }
  if (worlds === undefined) return <p role="status">연결 세계관을 불러오고 있어요.</p>
  if (worlds === null) return <p className="admin-action-error" role="alert">{WORLDS_FORBIDDEN}</p>
  const world = worlds.find((candidate) => candidate.linkedWorkId === workId)
  if (!world) return <p className="muted">연결된 세계관이 없어요.</p>
  return (
    <p>
      <b>{world.name}</b>{' '}
      <span className={`chip ${isListedWorld(world) ? 'ok' : 'wait'}`}>{worldStatusLabel(world)}</span>
      {world.ownerName && <span className="small muted"> · {world.ownerName}</span>}
    </p>
  )
}

function EpisodeRow({ vm, d, workId, episode }: { vm: VM; d: Detail; workId: string; episode: OperationsEpisode }) {
  const key = episodeKey(workId, episode.number)
  const busy = vm.mutationsBlocked || !!vm.actions[key]?.pending
  const label = `${episode.number}화`
  return (
    <tr>
      <td>{label}</td>
      <td>{episode.title}</td>
      <td>{publicationStatusLabel(episode.publicationStatus)}</td>
      <td><span className={`chip ${episode.restricted ? 'wait' : 'ok'}`}>{episode.restricted ? '제한' : '정상'}</span></td>
      <td>{episode.inherited ? '원작에서 상속' : '—'}</td>
      <td>
        <button
          type="button"
          className="btn sm"
          aria-label={`${label} ${episode.restricted ? '제한 해제' : '운영 제한'}`}
          disabled={busy || episode.inherited}
          title={episode.inherited ? '원작 작품의 같은 회차를 제한해 주세요' : undefined}
          onClick={() => {
            if (episode.restricted || window.confirm(`${label}를 제한할까요? 독자 열람·조회수 기록·댓글이 막히고 이 회차를 상속한 Fork의 회차도 숨겨져요. 작가 집필은 그대로예요.`)) {
              void d.restrict(episode, !episode.restricted)
            }
          }}
        >
          {episode.restricted ? '제한 해제' : '운영 제한'}
        </button>
      </td>
    </tr>
  )
}

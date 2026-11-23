import { useState } from 'react'

import { isListedWorld, WORLDS_FORBIDDEN, worldStatusLabel, type OperationsWorld } from '../../../../domain/entities/operationsWorld'
import { kstDateTime } from '../../../shared/format'
import { MoreVerticalIcon } from '../../../shared/icons'
import { PopMenu } from '../../../shared/PopMenu'
import type { useAdminViewModel } from '../viewmodel/useAdminViewModel'
import { useWorldsViewModel } from '../viewmodel/useWorldsViewModel'
import { AdminActionStatus, LiveState, Table } from './OperationsPanels'

type VM = ReturnType<typeof useAdminViewModel>

const STATUSES = [['all', '전체'], ['listed', '공개 중'], ['restricted', '운영 제한'], ['unlisted', '비공개·미공개']] as const
type StatusFilter = (typeof STATUSES)[number][0]
const matches = (world: OperationsWorld, status: StatusFilter) =>
  status === 'all' || (status === 'listed' ? isListedWorld(world) : status === 'restricted' ? world.restricted : !world.restricted && !isListedWorld(world))
const has = (query: string, ...texts: (string | null)[]) => !query || texts.filter(Boolean).join(' ').toLocaleLowerCase().includes(query.toLocaleLowerCase())

/**
 * `콘텐츠 관리 > 세계관`(결정 B): 지우지 않은 전체 세계관을 최신순으로 보여 주고 공개 경로 제한·해제를 한다.
 * 제한은 공개 세계관 목록·상세·카드 검색·이미지·가져오기만 막고, 연결된 소설의 설정 위키와 Fork 이어받기는 그대로다(작품은 작품 제한으로).
 * 조회·변경은 `works` 권한이 필요해서, 없으면(403) 표 없이 필요한 권한만 안내한다. 검색·상태 필터는 받은 전체 목록에서 화면이 계산한다.
 */
export function AdminWorlds({ vm }: { vm: VM }) {
  const d = useWorldsViewModel(vm.live.mutate)
  const rows = d.worlds.data
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState<StatusFilter>('all')
  const shown = (rows ?? []).filter((world) => matches(world, status) && has(query, world.name, world.ownerName))
  const worldActions = Object.entries(vm.actions).filter(([key]) => key.startsWith('world:'))
  const nameOf = (key: string) => {
    const world = rows?.find((candidate) => candidate.worldId === key.slice('world:'.length))
    return world && `「${world.name}」`
  }
  return (
    <section className="panel admin-operations" aria-label="세계관 관리">
      <div className="table-head">
        <h2 className="panel-title">세계관 목록</h2>
        <button type="button" className="btn sm" onClick={d.worlds.retry} disabled={d.worlds.isRefreshing}>목록 새로고침</button>
      </div>
      <LiveState vm={vm} label="세계관 목록" state={d.worlds} />
      {rows === null && <p className="admin-action-error" role="alert">{WORLDS_FORBIDDEN}</p>}
      {rows && (
        <>
          <form
            className="admin-filter"
            aria-label="세계관 찾기"
            onSubmit={(e) => {
              e.preventDefault()
              setQuery(String(new FormData(e.currentTarget).get('query') ?? '').trim())
            }}
          >
            <label className="field field-search">
              세계관 검색
              <input className="inp" name="query" defaultValue={query} autoComplete="off" placeholder="세계관 이름·작가" />
            </label>
            <label className="field">
              상태
              <select className="inp" value={status} onChange={(e) => setStatus(STATUSES.find(([value]) => value === e.target.value)?.[0] ?? 'all')}>
                {STATUSES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
            </label>
            <button type="submit" className="btn pri">검색</button>
          </form>
          {worldActions.filter(([, state]) => state.pending || state.error).map(([key, state]) => <AdminActionStatus key={key} state={{ ...state, message: '' }} target={nameOf(key)} />)}
          {vm.lastSuccessKey.startsWith('world:') && vm.lastSuccess && <p className="admin-note" role="status">{vm.lastSuccess}</p>}
          <Table label="세계관 관리 표" style={{ marginTop: 10 }}>
            <thead>
              <tr>
                <th scope="col">세계관</th>
                <th scope="col">작가</th>
                <th scope="col">공개 상태</th>
                <th scope="col">연결 작품</th>
                <th scope="col">만든 날</th>
                <th scope="col" className="act act-menu"><span className="sr-only">조치</span></th>
              </tr>
            </thead>
            <tbody>
              {shown.length
                ? shown.map((world) => {
                  const pending = vm.mutationsBlocked || !!vm.actions[`world:${world.worldId}`]?.pending
                  return (
                    <tr key={world.worldId}>
                      <td><b>{world.name}</b></td>
                      <td>{world.ownerName ?? '—'}</td>
                      <td><span className={`chip ${isListedWorld(world) ? 'ok' : 'wait'}`}>{worldStatusLabel(world)}</span></td>
                      <td>{world.linkedWorkId ? d.workTitle(world.linkedWorkId) ?? '연결됨' : '—'}</td>
                      <td className="admin-date">{kstDateTime(world.createdAt)}</td>
                      <td className="act-menu">
                        <PopMenu className="row-menu" label={`「${world.name}」 조치`} icon={<MoreVerticalIcon />}>
                          <button
                            type="button"
                            role="menuitem"
                            className={world.restricted ? undefined : 'danger'}
                            disabled={pending}
                            onClick={() => {
                              if (world.restricted || window.confirm(`「${world.name}」 세계관을 제한할까요? 공개 세계관 목록·상세·카드 검색·이미지·가져오기에서 보이지 않아요. 연결된 소설의 설정 위키와 Fork 이어받기는 그대로예요.`)) {
                                void d.restrict(world, !world.restricted)
                              }
                            }}
                          >
                            {world.restricted ? '제한 해제' : '운영 제한'}
                          </button>
                        </PopMenu>
                      </td>
                    </tr>
                  )
                })
                : <tr><td colSpan={6} className="muted">{rows.length ? '조건에 맞는 세계관이 없어요.' : '세계관이 없어요.'}</td></tr>}
            </tbody>
          </Table>
        </>
      )}
      <p className="admin-note">
        운영 제한은 공개 세계관 목록·상세·카드 검색·이미지·가져오기에서만 세계관을 감춰요. 이미 연결된 소설의 설정 위키와 Fork의 원작 세계관 이어받기는 그대로라, 작품을 막으려면 작품 탭에서 제한해 주세요.
        작가의 세계관 편집에는 영향이 없어요. 조치는 활동 로그에 기록돼요.
      </p>
    </section>
  )
}

import { Fragment, useEffect, useRef, useState, type FormEvent } from 'react'

import { GENRE_EMOJI_MAX, GENRE_FORBIDDEN, GENRE_NAME_MAX, HOME_GENRE_LIMIT, type GenrePatch, type OperationsGenre } from '../../../../domain/entities/genre'
import { PopMenu } from '../../../shared/PopMenu'
import type { useAdminViewModel } from '../viewmodel/useAdminViewModel'
import { useGenresViewModel } from '../viewmodel/useGenresViewModel'
import { AdminActionStatus, LiveState, Table } from './OperationsPanels'

type VM = ReturnType<typeof useAdminViewModel>
type Genres = ReturnType<typeof useGenresViewModel>

const COLUMNS = 8
const count = (n: number) => n.toLocaleString('ko-KR')

/**
 * `콘텐츠 관리 > 장르`(DEC-56): 작품과 공개 세계관이 함께 쓰는 장르 목록을 관리한다. 장르 추가 폼, 장르 표(순서·아이콘·이름·상태·홈 노출·사용 수), 행마다 ⋮ 조치 메뉴
 * (이름·아이콘 수정은 행 아래 인라인 폼, 숨기기/다시 보이기는 확인 뒤, 홈 노출 켜기/끄기, 위·아래로 옮기기)를 둔다. 삭제는 없다(작품·세계관이 참조한다).
 * 조회·변경은 `works` 권한이 필요해서, 없으면(403) 폼·표 없이 필요한 권한만 안내한다.
 */
export function AdminGenres({ vm }: { vm: VM }) {
  const d = useGenresViewModel(vm.live.mutate)
  const rows = d.genres.data
  const root = useRef<HTMLElement>(null)
  const [editing, setEditing] = useState<string | null>(null)
  // 같은 목록을 바꾸는 조치는 한 번에 하나만: 진행 중이면 다른 조치를 잠가 순서·이름 검사가 엇갈리지 않게 한다.
  const busy = vm.mutationsBlocked || Object.entries(vm.actions).some(([key, state]) => key.startsWith('genre:') && state.pending)
  const list = rows ? rows.toSorted((a, b) => a.position - b.position) : []
  const codes = list.map((genre) => genre.code)
  const targetOf = (key: string) => {
    const code = key.slice('genre:'.length)
    if (code === 'new') return '장르 추가'
    if (code === 'order') return '장르 순서'
    const name = list.find((genre) => genre.code === code)?.name
    return name && `「${name}」`
  }
  /** 수정 폼을 닫을 때 초점이 body로 떨어지지 않게 그 줄의 ⋮ 버튼으로 돌려준다. */
  const closeEditor = (genre: OperationsGenre) => {
    Array.from(root.current?.querySelectorAll<HTMLElement>('[data-genre]') ?? []).find((el) => el.dataset.genre === genre.code)?.querySelector<HTMLElement>('.pop-menu-btn')?.focus()
    setEditing(null)
  }
  const add = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    const form = e.currentTarget
    const data = new FormData(form)
    if (await d.create({ name: String(data.get('name') ?? ''), emoji: String(data.get('emoji') ?? '') })) {
      form.reset()
      form.querySelector<HTMLInputElement>('input[name="name"]')?.focus()
    }
  }
  return (
    <section className="panel admin-operations" aria-label="장르 관리" ref={root}>
      <div className="table-head">
        <h2 className="panel-title">장르 목록</h2>
        <button type="button" className="btn sm" onClick={d.genres.retry} disabled={d.genres.isRefreshing}>목록 새로고침</button>
      </div>
      <LiveState vm={vm} label="장르 목록" state={d.genres} />
      {rows === null && <p className="admin-action-error" role="alert">{GENRE_FORBIDDEN}</p>}
      {rows && (
        <>
          <form className="admin-filter" aria-label="장르 추가" onSubmit={(e) => void add(e)}>
            <label className="field field-search">
              새 장르 이름
              <input className="inp" name="name" maxLength={GENRE_NAME_MAX} required autoComplete="off" placeholder="예: 사이버펑크" />
            </label>
            <label className="field">
              아이콘 <span className="small muted">선택</span>
              <input className="inp" name="emoji" maxLength={GENRE_EMOJI_MAX} autoComplete="off" placeholder="예: 🤖" />
            </label>
            <button type="submit" className="btn pri" disabled={busy}>장르 추가</button>
          </form>
          <Status vm={vm} targetOf={targetOf} />
          <Table label="장르 관리 표" style={{ marginTop: 10 }}>
            <thead>
              <tr>
                <th scope="col">순서</th>
                <th scope="col">아이콘</th>
                <th scope="col">이름</th>
                <th scope="col">상태</th>
                <th scope="col">홈 노출</th>
                <th scope="col">작품 수</th>
                <th scope="col">세계관 수</th>
                <th scope="col" className="act">조치</th>
              </tr>
            </thead>
            <tbody>
              {list.map((genre, i) => (
                <Fragment key={genre.code}>
                  <tr className={editing === genre.code ? 'sel' : undefined}>
                    <td>{i + 1}</td>
                    <td>{genre.emoji ?? '—'}</td>
                    <td><b>{genre.name}</b></td>
                    <td><span className={`chip ${genre.active ? 'ok' : 'wait'}`}>{genre.active ? '활성' : '숨김'}</span></td>
                    <td>
                      {genre.featured
                        ? <span className={`chip ${genre.active ? 'ok' : 'wait'}`} title={genre.active ? undefined : '숨긴 장르라 홈 칩에는 나오지 않아요'}>홈 노출</span>
                        : '—'}
                    </td>
                    <td>{count(genre.workCount)}</td>
                    <td>{count(genre.worldCount)}</td>
                    <td>
                      <div className="rowend" data-genre={genre.code}>
                        <RowMenu genre={genre} index={i} last={list.length - 1} codes={codes} d={d} busy={busy} onEdit={() => setEditing(genre.code)} />
                      </div>
                    </td>
                  </tr>
                  {editing === genre.code && (
                    <tr>
                      <td colSpan={COLUMNS}><GenreEdit genre={genre} d={d} busy={busy} onClose={() => closeEditor(genre)} /></td>
                    </tr>
                  )}
                </Fragment>
              ))}
              {!list.length && <tr><td colSpan={COLUMNS} className="muted">등록된 장르가 없어요.</td></tr>}
            </tbody>
          </Table>
        </>
      )}
      <p className="admin-note">
        작가는 활성 장르 중에서만 새로 고를 수 있어요. 숨긴 장르는 선택지·홈 칩에서 빠지지만 이미 붙은 작품·세계관의 표시는 그대로예요(일괄 교체 기능은 없어요).
        홈 장르 칩에는 최대 {HOME_GENRE_LIMIT}개까지 보여요. 장르는 삭제할 수 없고, 이름을 바꿔도 검색 색인은 다음 색인 작업 전까지 옛 이름으로 찾아져요.
      </p>
    </section>
  )
}

const menuLabel = (genre: OperationsGenre) => `「${genre.name}」 조치`

/** 이 탭의 조치 안내: 진행·실패는 대상 이름과 함께 각각, 완료는 가장 마지막 하나만(행 조치가 여러 번 쌓여도 줄이 늘지 않게). */
function Status({ vm, targetOf }: { vm: VM; targetOf: (key: string) => string | undefined }) {
  return (
    <>
      {Object.entries(vm.actions)
        .filter(([key, state]) => key.startsWith('genre:') && (state.pending || state.error))
        .map(([key, state]) => <AdminActionStatus key={key} state={{ ...state, message: '' }} target={targetOf(key)} />)}
      {vm.lastSuccessKey.startsWith('genre:') && vm.lastSuccess && <p className="admin-note" role="status">{vm.lastSuccess}</p>}
    </>
  )
}

/** 행 조치 메뉴(⋮ 하나): 항목을 고르면 PopMenu가 메뉴를 닫고 초점을 ⋮로 돌린다. 이름·아이콘 수정만 행 아래 인라인 폼으로 이어진다. */
function RowMenu({ genre, index, last, codes, d, busy, onEdit }: { genre: OperationsGenre; index: number; last: number; codes: string[]; d: Genres; busy: boolean; onEdit: () => void }) {
  const change = (patch: GenrePatch, message: string) => void d.update(genre, patch, message)
  return (
    <PopMenu className="genre-menu" label={menuLabel(genre)} icon={<span aria-hidden="true">⋮</span>}>
      <button type="button" role="menuitem" disabled={busy} onClick={onEdit}>이름·아이콘 수정</button>
      {genre.active
        ? (
          <button type="button" role="menuitem" className="danger" disabled={busy} onClick={() => {
            if (window.confirm(`「${genre.name}」을(를) 숨길까요? 작가가 새로 고를 수 없고 홈 칩에서도 빠져요. 이미 붙은 작품·세계관은 그대로 보여요.`)) {
              change({ active: false }, `「${genre.name}」 장르를 숨겼어요.`)
            }
          }}>숨기기</button>
        )
        : <button type="button" role="menuitem" disabled={busy} onClick={() => change({ active: true }, `「${genre.name}」 장르를 다시 보이게 했어요.`)}>다시 보이기</button>}
      <button type="button" role="menuitem" disabled={busy} onClick={() => change({ featured: !genre.featured }, genre.featured ? `「${genre.name}」 장르를 홈 칩에서 뺐어요.` : `「${genre.name}」 장르를 홈 칩에 보이게 했어요.`)}>
        {genre.featured ? '홈 노출 끄기' : '홈 노출 켜기'}
      </button>
      <button type="button" role="menuitem" disabled={busy || index === 0} onClick={() => void d.move(codes, genre, -1)}>위로 옮기기</button>
      <button type="button" role="menuitem" disabled={busy || index === last} onClick={() => void d.move(codes, genre, 1)}>아래로 옮기기</button>
    </PopMenu>
  )
}

/**
 * 행 아래 인라인 수정 폼: 이름·아이콘 중 바뀐 것만 보낸다. 아이콘을 비우면 지운다. 성공하면 닫고, 실패하면 입력을 그대로 두고 위 조치 안내가 이유를 알린다.
 * 진행 중에도 입력칸은 잠그지 않는다(잠기면 초점이 body로 떨어진다). 중복 제출은 제출 버튼과 실행기가 막는다.
 */
function GenreEdit({ genre, d, busy, onClose }: { genre: OperationsGenre; d: Genres; busy: boolean; onClose: () => void }) {
  const first = useRef<HTMLInputElement>(null)
  useEffect(() => { first.current?.focus() }, [])
  const save = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    const data = new FormData(e.currentTarget)
    const name = String(data.get('name') ?? '').trim()
    const emoji = String(data.get('emoji') ?? '').trim()
    const patch: GenrePatch = { ...(name !== genre.name ? { name } : {}), ...(emoji !== (genre.emoji ?? '') ? { emoji } : {}) }
    if (!Object.keys(patch).length) return onClose()
    if (await d.update(genre, patch, `「${name}」 장르를 수정했어요.`)) onClose()
  }
  return (
    <form className="admin-filter genre-edit" aria-label={`「${genre.name}」 이름·아이콘 수정`} onSubmit={(e) => void save(e)}>
      <label className="field field-search">
        장르 이름
        <input ref={first} className="inp" name="name" defaultValue={genre.name} maxLength={GENRE_NAME_MAX} required autoComplete="off" />
      </label>
      <label className="field">
        아이콘 <span className="small muted">비우면 지워요</span>
        <input className="inp" name="emoji" defaultValue={genre.emoji ?? ''} maxLength={GENRE_EMOJI_MAX} autoComplete="off" />
      </label>
      <button type="submit" className="btn pri" disabled={busy}>저장</button>
      <button type="button" className="btn" onClick={onClose}>취소</button>
    </form>
  )
}

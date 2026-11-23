import { Fragment, useEffect, useRef, useState, type FormEvent } from 'react'

import { CARD_CATEGORY_FORBIDDEN, CARD_CATEGORY_ICON_MAX, CARD_CATEGORY_NAME_MAX, type CardCategoryPatch, type OperationsCardCategory } from '../../../../domain/entities/cardCategory'
import { PopMenu } from '../../../shared/PopMenu'
import type { useAdminViewModel } from '../viewmodel/useAdminViewModel'
import { useCardCategoriesViewModel } from '../viewmodel/useCardCategoriesViewModel'
import { AdminActionStatus, LiveState, Table } from './OperationsPanels'

type VM = ReturnType<typeof useAdminViewModel>
type Categories = ReturnType<typeof useCardCategoriesViewModel>

const COLUMNS = 6
const count = (n: number) => n.toLocaleString('ko-KR')

/**
 * `콘텐츠 관리 > 카드 카테고리`(결정 E): 세계관 카드의 분류를 관리한다. 장르 관리와 같은 틀이다 — 추가 폼, 표(순서·아이콘·이름·상태·카드 수),
 * 행마다 ⋮ 조치 메뉴(이름·아이콘 수정은 행 아래 인라인 폼, 숨기기/다시 보이기는 확인 뒤, 위·아래로 옮기기). 삭제는 없다(카드가 참조한다).
 * 조회·변경은 `works` 권한이 필요해서, 없으면(403) 폼·표 없이 필요한 권한만 안내한다.
 */
export function AdminCardCategories({ vm }: { vm: VM }) {
  const d = useCardCategoriesViewModel(vm.live.mutate)
  const rows = d.categories.data
  const root = useRef<HTMLElement>(null)
  const [editing, setEditing] = useState<string | null>(null)
  // 같은 목록을 바꾸는 조치는 한 번에 하나만: 진행 중이면 다른 조치를 잠가 순서·이름 검사가 엇갈리지 않게 한다.
  const busy = vm.mutationsBlocked || Object.entries(vm.actions).some(([key, state]) => key.startsWith('cardCategory:') && state.pending)
  const list = rows ? rows.toSorted((a, b) => a.position - b.position) : []
  const codes = list.map((category) => category.code)
  const targetOf = (key: string) => {
    const code = key.slice('cardCategory:'.length)
    if (code === 'new') return '카테고리 추가'
    if (code === 'order') return '카테고리 순서'
    const name = list.find((category) => category.code === code)?.name
    return name && `「${name}」`
  }
  /** 수정 폼을 닫을 때 초점이 body로 떨어지지 않게 그 줄의 ⋮ 버튼으로 돌려준다. */
  const closeEditor = (category: OperationsCardCategory) => {
    Array.from(root.current?.querySelectorAll<HTMLElement>('[data-category]') ?? []).find((el) => el.dataset.category === category.code)?.querySelector<HTMLElement>('.pop-menu-btn')?.focus()
    setEditing(null)
  }
  const add = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    const form = e.currentTarget
    const data = new FormData(form)
    if (await d.create({ name: String(data.get('name') ?? ''), icon: String(data.get('icon') ?? '') })) {
      form.reset()
      form.querySelector<HTMLInputElement>('input[name="name"]')?.focus()
    }
  }
  return (
    <section className="panel admin-operations" aria-label="카드 카테고리 관리" ref={root}>
      <div className="table-head">
        <h2 className="panel-title">카드 카테고리 목록</h2>
        <button type="button" className="btn sm" onClick={d.categories.retry} disabled={d.categories.isRefreshing}>목록 새로고침</button>
      </div>
      <LiveState vm={vm} label="카드 카테고리 목록" state={d.categories} />
      {rows === null && <p className="admin-action-error" role="alert">{CARD_CATEGORY_FORBIDDEN}</p>}
      {rows && (
        <>
          <form className="admin-filter" aria-label="카드 카테고리 추가" onSubmit={(e) => void add(e)}>
            <label className="field field-search">
              새 카테고리 이름
              <input className="inp" name="name" maxLength={CARD_CATEGORY_NAME_MAX} required autoComplete="off" placeholder="예: 종족" />
            </label>
            <label className="field">
              <span>아이콘 <span className="small muted">(선택)</span></span>
              <input className="inp" name="icon" maxLength={CARD_CATEGORY_ICON_MAX * 2} autoComplete="off" placeholder="예: 🐉" />
            </label>
            <button type="submit" className="btn pri" disabled={busy}>카테고리 추가</button>
          </form>
          <Status vm={vm} targetOf={targetOf} />
          <Table label="카드 카테고리 관리 표" style={{ marginTop: 10 }}>
            <thead>
              <tr>
                <th scope="col">순서</th>
                <th scope="col">아이콘</th>
                <th scope="col">이름</th>
                <th scope="col">상태</th>
                <th scope="col">카드 수</th>
                <th scope="col" className="act">조치</th>
              </tr>
            </thead>
            <tbody>
              {list.map((category, i) => (
                <Fragment key={category.code}>
                  <tr className={editing === category.code ? 'sel' : undefined}>
                    <td>{i + 1}</td>
                    <td>{category.icon ?? '—'}</td>
                    <td><b>{category.name}</b></td>
                    <td><span className={`chip ${category.active ? 'ok' : 'wait'}`}>{category.active ? '활성' : '숨김'}</span></td>
                    <td>{count(category.cardCount)}</td>
                    <td>
                      {/* 장르 표와 같은 행 메뉴(.genre-menu: 오른쪽 정렬 고정 위치 목록)를 쓴다. */}
                      <div className="rowend" data-category={category.code}>
                        <RowMenu category={category} index={i} last={list.length - 1} codes={codes} d={d} busy={busy} onEdit={() => setEditing(category.code)} />
                      </div>
                    </td>
                  </tr>
                  {editing === category.code && (
                    <tr>
                      <td colSpan={COLUMNS}><CategoryEdit category={category} d={d} busy={busy} onClose={() => closeEditor(category)} /></td>
                    </tr>
                  )}
                </Fragment>
              ))}
              {!list.length && <tr><td colSpan={COLUMNS} className="muted">등록된 카테고리가 없어요.</td></tr>}
            </tbody>
          </Table>
        </>
      )}
      <p className="admin-note">
        작가는 활성 카테고리 중에서만 새로 고를 수 있어요. 숨긴 카테고리는 선택지에서 빠지지만 이미 쓰는 카드의 표시는 그대로예요(일괄 교체 기능은 없어요).
        카테고리는 삭제할 수 없어요. AI는 기본 8종만 알아서, 기본 8종이 아닌 카테고리의 카드는 AI에게 ‘기타’로 전달돼요.
      </p>
    </section>
  )
}

const menuLabel = (category: OperationsCardCategory) => `「${category.name}」 조치`

/** 이 탭의 조치 안내: 진행·실패는 대상 이름과 함께 각각, 완료는 가장 마지막 하나만(행 조치가 여러 번 쌓여도 줄이 늘지 않게). */
function Status({ vm, targetOf }: { vm: VM; targetOf: (key: string) => string | undefined }) {
  return (
    <>
      {Object.entries(vm.actions)
        .filter(([key, state]) => key.startsWith('cardCategory:') && (state.pending || state.error))
        .map(([key, state]) => <AdminActionStatus key={key} state={{ ...state, message: '' }} target={targetOf(key)} />)}
      {vm.lastSuccessKey.startsWith('cardCategory:') && vm.lastSuccess && <p className="admin-note" role="status">{vm.lastSuccess}</p>}
    </>
  )
}

/** 행 조치 메뉴(⋮ 하나): 항목을 고르면 PopMenu가 메뉴를 닫고 초점을 ⋮로 돌린다. 이름·아이콘 수정만 행 아래 인라인 폼으로 이어진다. */
function RowMenu({ category, index, last, codes, d, busy, onEdit }: { category: OperationsCardCategory; index: number; last: number; codes: string[]; d: Categories; busy: boolean; onEdit: () => void }) {
  const change = (patch: CardCategoryPatch, message: string) => void d.update(category, patch, message)
  return (
    <PopMenu className="genre-menu" label={menuLabel(category)} icon={<span aria-hidden="true">⋮</span>}>
      <button type="button" role="menuitem" disabled={busy} onClick={onEdit}>이름·아이콘 수정</button>
      {category.active
        ? (
          <button type="button" role="menuitem" className="danger" disabled={busy} onClick={() => {
            if (window.confirm(`「${category.name}」을(를) 숨길까요? 작가가 새로 고를 수 없어요. 이미 이 카테고리를 쓰는 카드는 그대로 보여요.`)) {
              change({ active: false }, `「${category.name}」 카테고리를 숨겼어요.`)
            }
          }}>숨기기</button>
        )
        : <button type="button" role="menuitem" disabled={busy} onClick={() => change({ active: true }, `「${category.name}」 카테고리를 다시 보이게 했어요.`)}>다시 보이기</button>}
      <button type="button" role="menuitem" disabled={busy || index === 0} onClick={() => void d.move(codes, category, -1)}>위로 옮기기</button>
      <button type="button" role="menuitem" disabled={busy || index === last} onClick={() => void d.move(codes, category, 1)}>아래로 옮기기</button>
    </PopMenu>
  )
}

/**
 * 행 아래 인라인 수정 폼: 이름·아이콘 중 바뀐 것만 보낸다. 아이콘을 비우면 지운다. 성공하면 닫고, 실패하면 입력을 그대로 두고 위 조치 안내가 이유를 알린다.
 * 진행 중에도 입력칸은 잠그지 않는다(잠기면 초점이 body로 떨어진다). 중복 제출은 제출 버튼과 실행기가 막는다.
 */
function CategoryEdit({ category, d, busy, onClose }: { category: OperationsCardCategory; d: Categories; busy: boolean; onClose: () => void }) {
  const first = useRef<HTMLInputElement>(null)
  useEffect(() => { first.current?.focus() }, [])
  const save = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    const data = new FormData(e.currentTarget)
    const name = String(data.get('name') ?? '').trim()
    const icon = String(data.get('icon') ?? '').trim()
    const patch: CardCategoryPatch = { ...(name !== category.name ? { name } : {}), ...(icon !== (category.icon ?? '') ? { icon } : {}) }
    if (!Object.keys(patch).length) return onClose()
    if (await d.update(category, patch, `「${name}」 카테고리를 수정했어요.`)) onClose()
  }
  return (
    <form className="admin-filter genre-edit" aria-label={`「${category.name}」 이름·아이콘 수정`} onSubmit={(e) => void save(e)}>
      <label className="field field-search">
        카테고리 이름
        <input ref={first} className="inp" name="name" defaultValue={category.name} maxLength={CARD_CATEGORY_NAME_MAX} required autoComplete="off" />
      </label>
      <label className="field">
        아이콘 <span className="small muted">비우면 지워요</span>
        <input className="inp" name="icon" defaultValue={category.icon ?? ''} maxLength={CARD_CATEGORY_ICON_MAX * 2} autoComplete="off" />
      </label>
      <button type="submit" className="btn pri" disabled={busy}>저장</button>
      <button type="button" className="btn" onClick={onClose}>취소</button>
    </form>
  )
}

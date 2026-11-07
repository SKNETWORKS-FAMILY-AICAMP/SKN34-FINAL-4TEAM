// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { MemoryRouter, Route, Routes } from 'react-router'
import { Provider } from 'react-redux'
import { createAppStore } from '../../../../app/store'
import { WorldRelationshipEditor } from './WorldRelationshipEditor'
import { WorldStudioPage } from './WorldStudioPage'
import * as studioViewModel from '../viewmodel/useWorldStudioViewModel'
import { WorldStudioUseCase } from '../../../../domain/usecases/WorldStudioUseCase'
import { InMemoryWorldStudioRepository } from '../../../../data/world-studio/InMemoryWorldStudioRepository'
import { putRelation } from '../../../../domain/entities/studioRelations'
import { newSetting } from '../../../../domain/entities/studioWorld'
const { useWorldStudioViewModel } = studioViewModel
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})
it('selects source and target, applies free prose and preserves the relation ID on edit', async () => {
  const useCase = new WorldStudioUseCase(new InMemoryWorldStudioRepository())
  const world = await useCase.create('세계', ''), a = newSetting('people'), b = newSetting('places')
  a.item.title = '가람'
  b.item.title = '항구'
  world.settings = [a, b]
  await useCase.save(world)
  function Harness() {
    const vm = useWorldStudioViewModel(useCase)
    return vm.editing
      ? (
        <>
          <WorldRelationshipEditor studio={vm} />
          <button onClick={vm.save}>메모리에 저장</button>
        </>
      )
      : null
  }
  render(
    <MemoryRouter initialEntries={['/worldstudio/' + world.id]}>
      <Routes>
        <Route path='/worldstudio/:worldId' element={<Harness />} />
      </Routes>
    </MemoryRouter>,
  )
  fireEvent.change(await screen.findByRole('combobox', { name: 'source · 관계 주체' }), {
    target: { value: a.item.id },
  })
  fireEvent.change(screen.getByRole('combobox', { name: 'target · 관계 대상' }), {
    target: { value: b.item.id },
  })
  fireEvent.click(screen.getByRole('button', { name: '관계 작성' }))
  fireEvent.change(screen.getByRole('combobox', { name: '실제 관계 1' }), {
    target: { value: '지키는 장소' },
  })
  fireEvent.click(screen.getByRole('button', { name: '편집본에 적용' }))
  fireEvent.click(screen.getByRole('button', { name: '메모리에 저장' }))
  await waitFor(async () => expect((await useCase.read(world.id)).settings).toHaveLength(3))
  const relation = (await useCase.read(world.id)).settings[2].item
  fireEvent.click(screen.getByRole('button', { name: '가람 · 지키는 장소 · 항구' }))
  fireEvent.change(screen.getByRole('combobox', { name: '실제 관계 1' }), {
    target: { value: '돌아갈 장소' },
  })
  fireEvent.click(screen.getByRole('button', { name: '편집본에 적용' }))
  fireEvent.click(screen.getByRole('button', { name: '메모리에 저장' }))
  await waitFor(async () =>
    expect((await useCase.read(world.id)).settings[2].item).toMatchObject({
      id: relation.id,
      text: '돌아갈 장소',
    })
  )
})

it('keeps both emotion directions and explicit removal when changing a legacy fact direction', async () => {
  const useCase = new WorldStudioUseCase(new InMemoryWorldStudioRepository())
  const world = await useCase.create('방향 검증', ''),
    a = newSetting('people'),
    b = newSetting('people')
  a.item.title = '가람'
  b.item.title = '나래'
  let settings = putRelation([a, b], {
    subjectId: a.item.id,
    targetId: b.item.id,
    predicate: 'parent_of',
    polarity: 'asserted',
  })
  settings = putRelation(settings, {
    subjectId: a.item.id,
    targetId: b.item.id,
    predicate: 'trusts',
    polarity: 'asserted',
  })
  world.settings = settings
  await useCase.save(world)
  let current: ReturnType<typeof useWorldStudioViewModel> | undefined
  function Harness() {
    const vm = useWorldStudioViewModel(useCase)
    current = vm
    return vm.editing ? <WorldRelationshipEditor studio={vm} /> : null
  }
  render(
    <MemoryRouter initialEntries={['/worldstudio/' + world.id]}>
      <Routes>
        <Route path='/worldstudio/:worldId' element={<Harness />} />
      </Routes>
    </MemoryRouter>,
  )
  fireEvent.click(await screen.findByRole('button', { name: '가람 · 부모 → 자녀 · 나래' }))
  fireEvent.change(screen.getByRole('combobox', { name: '실제 관계 1 방향' }), {
    target: { value: 'reverse' },
  })
  fireEvent.change(screen.getByRole('textbox', { name: '나래 → 가람 감정 1' }), {
    target: { value: '존경하지만 두렵다' },
  })
  fireEvent.click(screen.getByRole('button', { name: '가람 → 나래 감정 1 삭제' }))
  fireEvent.click(screen.getByRole('button', { name: '편집본에 적용' }))
  const relations = current!.editing!.settings.filter((row) => row.item.kind === 'relation')
  expect(relations).toHaveLength(2)
  expect(relations[0].item).toMatchObject({
    id: settings[2].item.id,
    subjectId: b.item.id,
    targetId: a.item.id,
    predicate: 'parent_of',
  })
  expect(relations[1].item).toMatchObject({
    subjectId: b.item.id,
    targetId: a.item.id,
    predicate: 'custom_emotion',
    text: '존경하지만 두렵다',
  })
  expect(current!.saved!.settings).toEqual(settings)
})

it('removes an incident relation with its person and restores both original IDs on undo', async () => {
  const useCase = new WorldStudioUseCase(new InMemoryWorldStudioRepository())
  const world = await useCase.create('세계', ''), a = newSetting('people'), b = newSetting('people')
  a.item.title = '가람'
  b.item.title = '나래'
  world.settings = putRelation([a, b], {
    subjectId: a.item.id,
    targetId: b.item.id,
    predicate: 'custom_relation',
    text: '친구',
    polarity: 'asserted',
  })
  await useCase.save(world)
  let current: ReturnType<typeof useWorldStudioViewModel> | undefined
  function Harness() {
    const vm = useWorldStudioViewModel(useCase)
    current = vm
    return vm.editing ? <WorldRelationshipEditor studio={vm} /> : null
  }
  render(
    <MemoryRouter initialEntries={['/worldstudio/' + world.id]}>
      <Routes>
        <Route path='/worldstudio/:worldId' element={<Harness />} />
      </Routes>
    </MemoryRouter>,
  )
  fireEvent.change(await screen.findByRole('combobox', { name: 'source · 관계 주체' }), {
    target: { value: a.item.id },
  })
  fireEvent.click(screen.getByRole('button', { name: '선택한 인물 삭제' }))
  expect(screen.getByRole('region', { name: '인물 삭제 확인' }).textContent).toContain(
    '관계·감정 1개',
  )
  fireEvent.click(screen.getByRole('button', { name: '인물과 연결 삭제' }))
  expect(current!.editing!.settings.map((s) => s.item.id)).toEqual([b.item.id])
  expect(current!.saved!.settings).toHaveLength(3)
  fireEvent.click(screen.getByRole('button', { name: '인물 삭제 되돌리기' }))
  expect(current!.editing!.settings).toEqual(world.settings)
  expect(current!.dirty).toBe(false)
  expect(screen.getByRole<HTMLSelectElement>('combobox', { name: 'source · 관계 주체' }).value)
    .toBe(a.item.id)
  expect(screen.queryByRole('button', { name: '인물 삭제 되돌리기' })).toBeNull()
})

it.each(['text', 'title', 'name'] as const)(
  'preserves the same-mounted pair draft and latest saved settings after an external %s edit',
  async (field) => {
    const useCase = new WorldStudioUseCase(new InMemoryWorldStudioRepository())
    const world = await useCase.create('탭 충돌 검증', ''),
      a = newSetting('people'),
      b = newSetting('people')
    a.item.title = '가람'
    b.item.title = '나래'
    world.settings = putRelation([a, b], {
      subjectId: a.item.id,
      targetId: b.item.id,
      predicate: 'friend_of',
      polarity: 'asserted',
    })
    world.settings = putRelation(world.settings, {
      subjectId: a.item.id,
      targetId: b.item.id,
      predicate: 'custom_relation',
      polarity: 'asserted',
      text: '오랜 동료이자 경쟁자',
    })
    const relation = world.settings[2].item
    await useCase.save(world)
    let current: ReturnType<typeof useWorldStudioViewModel> | undefined
    vi.spyOn(studioViewModel, 'useWorldStudioViewModel').mockImplementation(() => {
      current = useWorldStudioViewModel(useCase)
      return current
    })
    render(
      <Provider store={createAppStore({ role: 'user' })}>
        <MemoryRouter initialEntries={['/worldstudio/' + world.id]}>
          <Routes>
            <Route path='/worldstudio/:worldId' element={<WorldStudioPage />} />
          </Routes>
        </MemoryRouter>
      </Provider>,
    )
    await screen.findByRole('heading', { name: '탭 충돌 검증', level: 2 })
    fireEvent.click(screen.getByRole('button', { name: '관계 연결 (선택)' }))
    fireEvent.click(screen.getByRole('button', { name: '가람 · 친구 · 나래' }))
    const fact = screen.getByRole('combobox', { name: '실제 관계 1' }),
      draft = screen.getByRole<HTMLTextAreaElement>('textbox', { name: '나래 → 가람 감정 1' })
    const prose = '믿고 싶지만 아직은 두렵다.\n패널에 남겨 둘 감정'
    fireEvent.change(draft, { target: { value: prose } })
    fireEvent.click(screen.getByRole('button', { name: '설정 카드' }))
    if (field !== 'name') {
      fireEvent.click(screen.getByText('기존 설정·관계 2개'))
      fireEvent.click(
        within(screen.getByRole('navigation', { name: '기존 설정과 관계' })).getByRole('button', {
          name: /가람 · 친구 · 나래/,
        }),
      )
    } else fireEvent.click(screen.getByRole('button', { name: '가람 인물' }))
    fireEvent.change(
      screen.getByRole('textbox', { name: field === 'text' ? '설명' : '설정 이름' }),
      {
        target: {
          value: field === 'text'
            ? '설정 탭의 최신 설명'
            : field === 'title'
            ? '설정 탭의 최신 이름'
            : '가람 수정',
        },
      },
    )
    fireEvent.click(screen.getByRole('button', { name: '검토·저장' }))
    fireEvent.click(screen.getByRole('button', { name: '세계관 저장' }))
    await screen.findByText(
      '서버에 현재 세계관을 저장했어요. 관계는 현재 상태만 보관하며 과거 관계 복원은 지원하지 않습니다.',
    )
    const latest = await useCase.read(world.id)
    expect(latest.settings[2].item).toMatchObject({
      id: relation.id,
      ...(field === 'text'
        ? { text: '설정 탭의 최신 설명' }
        : field === 'title'
        ? { title: '설정 탭의 최신 이름' }
        : { title: '가람 수정 · 친구 · 나래', text: '가람 수정 · 친구 · 나래' }),
    })
    fireEvent.click(screen.getByRole('button', { name: '관계 연결 (선택)' }))
    expect(screen.getByRole('combobox', { name: '실제 관계 1' })).toBe(fact)
    expect(
      screen.getByRole<HTMLTextAreaElement>('textbox', {
        name: field === 'name' ? '나래 → 가람 수정 감정 1' : '나래 → 가람 감정 1',
      }).value,
    ).toBe(prose)
    fireEvent.click(screen.getByRole('button', { name: '편집본에 적용' }))
    const panel = screen.getByRole('region', { name: '관계 편집' })
    expect(within(panel).getByRole('alert').textContent).toContain('다른 곳에서 관계가 변경')
    expect(within(panel).getByRole('alert').textContent).toContain('입력은 유지')
    expect(
      screen.getByRole<HTMLTextAreaElement>('textbox', {
        name: field === 'name' ? '나래 → 가람 수정 감정 1' : '나래 → 가람 감정 1',
      }).value,
    ).toBe(prose)
    expect(current!.editing!.settings).toEqual(latest.settings)
    expect(current!.editing!.settings[3].item.text).toBe('오랜 동료이자 경쟁자')
    expect(current!.dirty).toBe(false)
    expect((await useCase.read(world.id)).settings).toEqual(latest.settings)
  },
)

// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { MemoryRouter, Route, Routes } from 'react-router'
import { Provider } from 'react-redux'
import { createAppStore } from '../../../../app/store'
import { RelationEpisodePicker } from './RelationEpisodePicker'
import { WorldRelationshipEditor } from './WorldRelationshipEditor'
import { WorldStudioPage } from './WorldStudioPage'
import * as studioViewModel from '../viewmodel/useWorldStudioViewModel'
import { WorldStudioUseCase } from '../../../../domain/usecases/WorldStudioUseCase'
import { InMemoryWorldStudioRepository } from '../../../../data/world-studio/InMemoryWorldStudioRepository'
import { putRelation } from '../../../../domain/entities/studioRelations'
import { newSetting } from '../../../../domain/entities/studioWorld'
import { EpisodeWorldRepository } from '../../../../test/episodeWorldRepository'
const { useWorldStudioViewModel } = studioViewModel
// 카드 설명 편집기(Toast UI Editor)는 jsdom에서 입력을 흉내 낼 수 없어 같은 값 전달만 하는 textarea 대역을 쓴다.
vi.mock('../../../shared/LazyMarkdownEditor', () => import('../../../../test/markdownEditorFake'))
/** 관리 모드 설정집 화면의 보기 전환 줄(설정집·관계도·시간선)에서 버튼을 찾는다. */
const manageTab = (name: string) => within(screen.getByRole('navigation', { name: '세계관 메뉴' })).getByRole('button', { name })
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})
it('많은 카드에서 그래프 페이지와 주체 검색으로 마지막 카드에 접근한다', async () => {
  const useCase = new WorldStudioUseCase(new InMemoryWorldStudioRepository())
  const world = await useCase.create('대형 세계', '')
  world.settings = Array.from({ length: 101 }, (_, i) => { const row = newSetting('people'); row.item.title = `설정 ${i}`; return row })
  await useCase.save(world)
  function Harness() { const vm = useWorldStudioViewModel(useCase); return vm.editing ? <WorldRelationshipEditor studio={vm} /> : null }
  render(<MemoryRouter initialEntries={['/worldstudio/' + world.id]}><Routes><Route path='/worldstudio/:worldId' element={<Harness />} /></Routes></MemoryRouter>)
  await screen.findByRole('group', { name: '설정 0 인물 카드' })
  expect(screen.queryByRole('group', { name: '설정 100 인물 카드' })).toBeNull()
  fireEvent.change(screen.getByRole('searchbox', { name: '관계 주체 검색' }), { target: { value: '설정 100' } })
  expect(within(screen.getByRole('combobox', { name: '관계 주체' })).getByRole('option', { name: '설정 100' })).toBeTruthy()
})
it('선택한 카드의 다른 페이지 이웃과 관계선을 보고 관계를 편집한다', async () => {
  const useCase = new WorldStudioUseCase(new InMemoryWorldStudioRepository())
  const world = await useCase.create('이웃 관계', '')
  const cards = Array.from({ length: 101 }, (_, i) => { const row = newSetting('people'); row.item.title = `설정 ${i}`; return row })
  world.settings = putRelation(cards, { subjectId: cards[0].item.id, targetId: cards[100].item.id, predicate: 'friend_of', polarity: 'asserted' })
  await useCase.save(world)
  function Harness() { const vm = useWorldStudioViewModel(useCase); return vm.editing ? <WorldRelationshipEditor studio={vm} /> : null }
  render(<MemoryRouter initialEntries={['/worldstudio/' + world.id]}><Routes><Route path='/worldstudio/:worldId' element={<Harness />} /></Routes></MemoryRouter>)
  await screen.findByRole('group', { name: '설정 0 인물 카드' })
  expect(screen.queryByRole('group', { name: '설정 100 인물 카드' })).toBeNull()
  fireEvent.change(screen.getByRole('searchbox', { name: '관계도 설정 검색' }), { target: { value: '설정 0' } })
  fireEvent.click(within(screen.getByRole('group', { name: '관계도 중심 설정' })).getByRole('button', { name: '설정 0' }))
  expect(screen.getByRole('group', { name: '설정 100 인물 카드' })).toBeTruthy()
  expect(screen.getByRole('button', { name: /관계선 편집: 설정 0 · 설정 100 · 친구/ })).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: /관계선 편집: 설정 0 · 설정 100 · 친구/ }))
  expect(await screen.findByRole('combobox', { name: '실제 관계 1' })).toBeTruthy()
})
it('그래프 페이지가 다른 카드의 관계를 관계 목록 다음 쪽에서 찾고 대상 카드로 이동한다', async () => {
  const useCase = new WorldStudioUseCase(new InMemoryWorldStudioRepository())
  const world = await useCase.create('페이지 관계 검증', '')
  const cards = Array.from({ length: 101 }, (_, i) => { const row = newSetting('people'); row.item.title = `설정 ${i}`; return row })
  let settings = cards
  for (let i = 0; i < 50; i++) settings = putRelation(settings, { subjectId: cards[i].item.id, targetId: cards[i + 1].item.id, predicate: 'friend_of', polarity: 'asserted' })
  settings = putRelation(settings, { subjectId: cards[0].item.id, targetId: cards[100].item.id, predicate: 'friend_of', polarity: 'asserted' })
  world.settings = settings
  await useCase.save(world)
  vi.spyOn(studioViewModel, 'useWorldStudioViewModel').mockImplementation(() => useWorldStudioViewModel(useCase))
  render(<Provider store={createAppStore({ role: 'user' })}><MemoryRouter initialEntries={['/worldstudio/' + world.id + '?view=people']}><Routes><Route path='/worldstudio/:worldId' element={<WorldStudioPage />} /></Routes></MemoryRouter></Provider>)
  await screen.findByRole('group', { name: '설정 0 인물 카드' })
  expect(screen.queryByRole('group', { name: '설정 100 인물 카드' })).toBeNull()
  expect(screen.getByText(/전체 관계는 아래 목록에서 확인하고 편집할 수 있어요/)).toBeTruthy()
  const list = within(screen.getByRole('region', { name: '관계 목록' }))
  fireEvent.click(list.getByRole('button', { name: '다음' }))
  const row = list.getByRole('button', { name: '설정 0 · 친구 · 설정 100 편집' }).closest('tr')!
  expect(within(row).getByRole('button', { name: '설정 0' })).toBeTruthy()
  fireEvent.click(within(row).getByRole('button', { name: '설정 100' }))
  expect(await screen.findByRole<HTMLInputElement>('textbox', { name: '설정 이름' })).toHaveProperty('value', '설정 100')
})
it('connects character and location cards, applies free prose and preserves the relation ID on edit', async () => {
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
  fireEvent.click(await screen.findByRole('button', { name: '가람 관계 연결' }))
  expect(screen.getByRole('group', { name: '항구 장소 카드' })).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: '항구 상대 선택' }))
  fireEvent.change(screen.getByRole('combobox', { name: '실제 관계 1' }), {
    target: { value: '지키는 장소' },
  })
  fireEvent.click(screen.getByRole('button', { name: '편집본에 적용' }))
  fireEvent.click(screen.getByRole('button', { name: '메모리에 저장' }))
  await waitFor(async () => expect((await useCase.read(world.id)).settings).toHaveLength(3))
  const relation = (await useCase.read(world.id)).settings[2].item
  fireEvent.click(screen.getByRole('button', { name: '가람 · 지키는 장소 · 항구 편집' }))
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
  fireEvent.click(await screen.findByRole('button', { name: '가람 · 부모 → 자녀 · 나래 편집' }))
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
  fireEvent.change(await screen.findByRole('combobox', { name: '관계 주체' }), {
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
  expect(screen.getByRole<HTMLSelectElement>('combobox', { name: '관계 주체' }).value)
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
    await screen.findByRole('heading', { name: '탭 충돌 검증', level: 1 })
    fireEvent.click(manageTab('관계도'))
    fireEvent.click(screen.getByRole('button', { name: '가람 · 친구 · 나래 편집' }))
    const fact = screen.getByRole('combobox', { name: '실제 관계 1' }),
      draft = screen.getByRole<HTMLTextAreaElement>('textbox', { name: '나래 → 가람 감정 1' })
    const prose = '믿고 싶지만 아직은 두렵다.\n패널에 남겨 둘 감정'
    fireEvent.change(draft, { target: { value: prose } })
    fireEvent.click(manageTab('설정집'))
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
    fireEvent.click(screen.getByRole('button', { name: '세계관 저장' }))
    await screen.findByText(
      '서버에 현재 세계관을 저장했어요. 관계는 회차별로 기록하며 과거 관계 복원은 지원하지 않아요.',
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
    fireEvent.click(screen.getByRole('button', { name: '설정집' })) // 설정 편집 화면을 닫고 설정집 화면으로
    fireEvent.click(manageTab('관계도'))
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

it('preserves the unapplied relationship text when changing the target is cancelled',async()=>{
 const useCase=new WorldStudioUseCase(new InMemoryWorldStudioRepository())
 const world=await useCase.create('세계',''),a=newSetting('people'),b=newSetting('people'),c=newSetting('people')
 a.item.title='가람';b.item.title='나래';c.item.title='다온';world.settings=[a,b,c];await useCase.save(world)
 let current:ReturnType<typeof useWorldStudioViewModel>|undefined
 function Harness(){const vm=useWorldStudioViewModel(useCase);current=vm;return vm.editing?<WorldRelationshipEditor studio={vm}/>:null}
 vi.spyOn(window,'confirm').mockReturnValue(false)
 render(<MemoryRouter initialEntries={['/worldstudio/'+world.id]}><Routes><Route path='/worldstudio/:worldId' element={<Harness/>}/></Routes></MemoryRouter>)
 fireEvent.change(await screen.findByRole('combobox',{name:'관계 주체'}),{target:{value:a.item.id}})
 fireEvent.change(screen.getByRole('combobox',{name:'관계 대상'}),{target:{value:b.item.id}})
 fireEvent.click(screen.getByRole('button',{name:'관계 작성'}))
 fireEvent.change(screen.getByRole('combobox',{name:'실제 관계 1'}),{target:{value:'작성 중인 관계'}})
 await waitFor(()=>expect(current!.relationDirty).toBe(true))
 fireEvent.change(screen.getByRole('combobox',{name:'관계 대상'}),{target:{value:c.item.id}})
 expect(screen.getByRole<HTMLSelectElement>('combobox',{name:'관계 대상'}).value).toBe(b.item.id)
 expect(screen.getByRole<HTMLInputElement>('combobox',{name:'실제 관계 1'}).value).toBe('작성 중인 관계')
 expect(window.confirm).toHaveBeenCalledOnce()
})

it('closes stale deletion confirmation safely after the person changes type',async()=>{
 const useCase=new WorldStudioUseCase(new InMemoryWorldStudioRepository())
 const world=await useCase.create('세계',''),person=newSetting('people');person.item.title='가람';world.settings=[person];await useCase.save(world)
 let current:ReturnType<typeof useWorldStudioViewModel>|undefined
 function Harness(){const vm=useWorldStudioViewModel(useCase);current=vm;return vm.editing?<WorldRelationshipEditor studio={vm}/>:null}
 render(<MemoryRouter initialEntries={['/worldstudio/'+world.id]}><Routes><Route path='/worldstudio/:worldId' element={<Harness/>}/></Routes></MemoryRouter>)
 fireEvent.change(await screen.findByRole('combobox',{name:'관계 주체'}),{target:{value:person.item.id}})
 fireEvent.click(screen.getByRole('button',{name:'선택한 인물 삭제'}))
 expect(screen.getByRole('region',{name:'인물 삭제 확인'})).toBeTruthy()
 act(()=>current!.changeCardType(person.item.id,'location'))
 expect(screen.queryByRole('region',{name:'인물 삭제 확인'})).toBeNull()
 expect(current!.editing!.settings[0].item.id).toBe(person.item.id)
})

it('does not discard a new relation with a custom name but no description on apply',async()=>{
 const useCase=new WorldStudioUseCase(new InMemoryWorldStudioRepository())
 const world=await useCase.create('세계',''),a=newSetting('people'),b=newSetting('people')
 a.item.title='가람';b.item.title='나래'
 world.settings=putRelation([a,b],{subjectId:a.item.id,targetId:b.item.id,predicate:'friend_of',polarity:'asserted'});await useCase.save(world)
 function Harness(){const vm=useWorldStudioViewModel(useCase);return vm.editing?<WorldRelationshipEditor studio={vm}/>:null}
 render(<MemoryRouter initialEntries={['/worldstudio/'+world.id]}><Routes><Route path='/worldstudio/:worldId' element={<Harness/>}/></Routes></MemoryRouter>)
 fireEvent.click(await screen.findByRole('button',{name:'가람 · 친구 · 나래 편집'}))
 const group=screen.getByRole('heading',{name:'나래 → 가람 감정'}).closest('section')!
 fireEvent.click(within(group).getByText('항목 이름 직접 쓰기'))
 fireEvent.change(within(group).getByRole('textbox',{name:'나래 → 가람 감정 1 이름'}),{target:{value:'남겨 둔 이름'}})
 fireEvent.click(screen.getByRole('button',{name:'편집본에 적용'}))
 expect(screen.getByRole('alert').textContent).toContain('설명')
 expect(within(group).getByRole<HTMLInputElement>('textbox',{name:'나래 → 가람 감정 1 이름'}).value).toBe('남겨 둔 이름')
})

it('keeps the open pair draft when the same two people are chosen in the opposite direction',async()=>{
 const useCase=new WorldStudioUseCase(new InMemoryWorldStudioRepository())
 const world=await useCase.create('세계',''),a=newSetting('people'),b=newSetting('people')
 a.item.title='가람';b.item.title='나래'
 world.settings=putRelation([a,b],{subjectId:b.item.id,targetId:a.item.id,predicate:'trusts',polarity:'asserted'});await useCase.save(world)
 function Harness(){const vm=useWorldStudioViewModel(useCase);return vm.editing?<WorldRelationshipEditor studio={vm}/>:null}
 vi.spyOn(window,'confirm').mockReturnValue(true)
 render(<MemoryRouter initialEntries={['/worldstudio/'+world.id]}><Routes><Route path='/worldstudio/:worldId' element={<Harness/>}/></Routes></MemoryRouter>)
 fireEvent.change(await screen.findByRole('combobox',{name:'관계 주체'}),{target:{value:a.item.id}})
 fireEvent.change(screen.getByRole('combobox',{name:'관계 대상'}),{target:{value:b.item.id}})
 fireEvent.click(screen.getByRole('button',{name:'관계 작성'}))
 fireEvent.change(screen.getByRole('combobox',{name:'실제 관계 1'}),{target:{value:'작성 중인 관계'}})
 fireEvent.click(within(screen.getByRole('table',{name:'저장할 관계 목록'})).getByRole('button',{name:'나래 · 신뢰 · 가람 편집'}))
 expect(window.confirm).not.toHaveBeenCalled()
 expect(screen.getByRole<HTMLInputElement>('combobox',{name:'실제 관계 1'}).value).toBe('작성 중인 관계')
})

it('focuses connection cancel, cancels choosing with Escape and clears it when the source person is deleted',async()=>{
 const useCase=new WorldStudioUseCase(new InMemoryWorldStudioRepository())
 const world=await useCase.create('세계',''),a=newSetting('people'),b=newSetting('places')
 a.item.title='가람';b.item.title='항구';world.settings=[a,b];await useCase.save(world)
 function Harness(){const vm=useWorldStudioViewModel(useCase);return vm.editing?<WorldRelationshipEditor studio={vm}/>:null}
 render(<MemoryRouter initialEntries={['/worldstudio/'+world.id]}><Routes><Route path='/worldstudio/:worldId' element={<Harness/>}/></Routes></MemoryRouter>)
 fireEvent.click(await screen.findByRole('button',{name:'가람 관계 연결'}))
 expect(document.activeElement).toBe(screen.getByRole('button',{name:'연결 취소'}))
 expect(screen.getByRole('status').textContent).toContain('가람의 연결 상대')
 fireEvent.keyDown(screen.getByRole('button',{name:'연결 취소'}),{key:'Escape'})
 expect(screen.queryByRole('button',{name:'연결 취소'})).toBeNull()
 expect(document.activeElement).toBe(screen.getByRole('button',{name:'가람 관계 연결'}))
 fireEvent.click(screen.getByRole('button',{name:'가람 관계 연결'}))
 fireEvent.click(screen.getByRole('button',{name:'선택한 인물 삭제'}))
 fireEvent.click(screen.getByRole('button',{name:'인물과 연결 삭제'}))
 expect(screen.queryByRole('button',{name:'연결 취소'})).toBeNull()
 expect(screen.getByRole('button',{name:'항구 관계 연결'})).toBeTruthy()
})

// ── 관계도 유형 필터 ──────────────────────────────────────────────────────────────────────────────
/** 인물 둘(가람·나래)과 장소(항구) 카드, 가람↔나래(친구)·가람→항구(지키는 곳) 관계가 있는 세계관의 관계 편집기만 그리고 유형 필터 줄을 돌려준다. */
async function openTyped() {
  const useCase = new WorldStudioUseCase(new InMemoryWorldStudioRepository())
  const world = await useCase.create('세계', ''), a = newSetting('people'), b = newSetting('people'), c = newSetting('places')
  a.item.title = '가람'
  b.item.title = '나래'
  c.item.title = '항구'
  const friends = putRelation([a, b, c], { subjectId: a.item.id, targetId: b.item.id, predicate: 'friend_of', polarity: 'asserted' })
  world.settings = putRelation(friends, { subjectId: a.item.id, targetId: c.item.id, predicate: 'custom_relation_directed', polarity: 'asserted', text: '지키는 곳' })
  await useCase.save(world)
  function Harness() {
    const vm = useWorldStudioViewModel(useCase)
    return vm.editing ? <WorldRelationshipEditor studio={vm} /> : null
  }
  render(
    <MemoryRouter initialEntries={['/worldstudio/' + world.id]}>
      <Routes><Route path='/worldstudio/:worldId' element={<Harness />} /></Routes>
    </MemoryRouter>,
  )
  return within(await screen.findByRole('group', { name: '관계도 유형 필터' }))
}
/** 유형 필터 버튼들(전체 · 유형…)의 눌림 상태. */
const pressed = () => within(screen.getByRole('group', { name: '관계도 유형 필터' })).getAllByRole('button').map((b) => b.getAttribute('aria-pressed'))

it('filters the graph by card type: hiding a type removes its cards and the edges touching them but not the select options or the relation list, and 전체 restores', async () => {
  const filter = await openTyped()
  expect(filter.getAllByRole('button').map((b) => b.textContent)).toEqual(['전체', '인물 2', '장소 1']) // 노드가 있는 유형만 개수와 함께(능력·조직 등은 없다)
  expect(pressed()).toEqual(['true', 'true', 'true']) // 기본은 모두 보임
  expect(screen.getByRole('button', { name: /관계선 편집: 가람 · 항구/ })).toBeTruthy()
  fireEvent.click(filter.getByRole('button', { name: '장소 1' }))
  expect(pressed()).toEqual(['false', 'true', 'false']) // 전체는 켜지지 않은 상태
  expect(screen.queryByRole('group', { name: '항구 장소 카드' })).toBeNull()
  expect(screen.getByRole('group', { name: '가람 인물 카드' })).toBeTruthy()
  expect(screen.queryByRole('button', { name: /관계선 편집: 가람 · 항구/ })).toBeNull() // 항구에 닿는 관계선도 빠진다
  expect(screen.getByRole('button', { name: /관계선 편집: 가람 · 나래/ })).toBeTruthy()
  expect(within(screen.getByRole('combobox', { name: '관계 대상' })).getByRole('option', { name: '항구' })).toBeTruthy() // 선택지는 거르지 않는다
  expect(within(screen.getByRole('table', { name: '저장할 관계 목록' })).getByRole('button', { name: '가람 · 지키는 곳 · 항구 편집' })).toBeTruthy() // 관계 목록도
  fireEvent.click(filter.getByRole('button', { name: '장소 1' })) // 같은 버튼을 다시 누르면 보인다
  expect(screen.getByRole('group', { name: '항구 장소 카드' })).toBeTruthy()
  fireEvent.click(filter.getByRole('button', { name: '장소 1' }))
  fireEvent.click(filter.getByRole('button', { name: '전체' }))
  expect(pressed()).toEqual(['true', 'true', 'true'])
  expect(screen.getByRole('group', { name: '항구 장소 카드' })).toBeTruthy()
  expect(screen.getByRole('button', { name: /관계선 편집: 가람 · 항구/ })).toBeTruthy()
})

it('never empties the graph: the last visible type cannot be hidden, and a source of another type keeps its connect mode', async () => {
  const filter = await openTyped()
  fireEvent.click(screen.getByRole('button', { name: '가람 관계 연결' }))
  fireEvent.click(filter.getByRole('button', { name: '장소 1' })) // 출발 카드(인물)와 다른 유형을 숨기면 연결 모드는 그대로다
  expect(screen.getByRole('button', { name: '연결 취소' })).toBeTruthy()
  expect(screen.getByRole('button', { name: '나래 상대 선택' })).toBeTruthy()
  expect(filter.getByRole<HTMLButtonElement>('button', { name: '인물 2' }).disabled).toBe(true) // 인물만 남았으니 끌 수 없다
  expect(filter.getByRole<HTMLButtonElement>('button', { name: '장소 1' }).disabled).toBe(false) // 숨긴 유형은 늘 다시 켤 수 있다
})

it('releases the selection and the connect mode when the card they belong to is hidden, so nothing can be linked to a hidden card', async () => {
  const filter = await openTyped()
  fireEvent.click(screen.getByRole('button', { name: '항구 관계 연결' })) // 항구에서 연결을 시작: 선택되고 상대를 고르는 중
  expect(screen.getByRole('group', { name: '항구 장소 카드' }).getAttribute('aria-current')).toBe('true')
  expect(screen.getByRole('button', { name: '가람 상대 선택' })).toBeTruthy()
  fireEvent.click(filter.getByRole('button', { name: '장소 1' }))
  expect(screen.queryByRole('button', { name: '연결 취소' })).toBeNull()
  expect(screen.queryByRole('button', { name: /상대 선택/ })).toBeNull() // 숨은 항구에 이을 상대 고르기 버튼이 남지 않는다
  expect(screen.getByRole('button', { name: '가람 관계 연결' })).toBeTruthy()
  fireEvent.click(filter.getByRole('button', { name: '전체' }))
  expect(screen.getByRole('group', { name: '항구 장소 카드' }).getAttribute('aria-current')).toBeNull() // 선택도 풀려 있다
})

// ── 관계 기준 회차(DEC-51) ───────────────────────────────────────────────────────────────────────
/** 회차 선택(페이지가 편집기 바로 위에 둔다)과 관계 편집기만 그린다. 소설이 연결된 세계관: 1화에는 관계가 없고 2화(최신)에 가람과 나래의 친구 관계가 있다. `supported`가 false면 회차를 모르는 메모리 데모다. */
async function openEpisodes({ linked = true, supported = true } = {}) {
  const a = newSetting('people'), b = newSetting('people')
  a.item.title = '가람'
  b.item.title = '나래'
  const settings = putRelation([a, b], { subjectId: a.item.id, targetId: b.item.id, predicate: 'friend_of', polarity: 'asserted' })
  const repository = supported ? new EpisodeWorldRepository() : new InMemoryWorldStudioRepository(), useCase = new WorldStudioUseCase(repository)
  const world = await useCase.create('세계', '')
  await useCase.save({ ...world, settings, linkedWorkId: linked ? 'work-1' : null })
  if (repository instanceof EpisodeWorldRepository) repository.relations = { 1: [], 2: settings.filter((s) => s.item.kind === 'relation') }
  let current: ReturnType<typeof useWorldStudioViewModel> | undefined
  function Harness() {
    const vm = useWorldStudioViewModel(useCase)
    current = vm
    return vm.editing ? <><RelationEpisodePicker studio={vm} /><WorldRelationshipEditor studio={vm} /></> : null
  }
  render(
    <MemoryRouter initialEntries={['/worldstudio/' + world.id]}>
      <Routes><Route path='/worldstudio/:worldId' element={<Harness />} /></Routes>
    </MemoryRouter>,
  )
  const input = await screen.findByRole<HTMLInputElement>('textbox', { name: '관계 기준 화' })
  return { repository, id: world.id, vm: () => current!, input }
}
const episodePicker = () => within(screen.getByRole('region', { name: '관계 기준 회차' }))
const relationTable = () => within(screen.getByRole('table', { name: '저장할 관계 목록' }))

it.each([
  ['데모에서는 지원하지 않아요.', { supported: false }],
  ['소설을 연결하면 회차별로 기록할 수 있어요.', { linked: false }],
] as const)('locks the relation episode picker with its reason: %s', async (reason, options) => {
  const { input } = await openEpisodes(options)
  expect(episodePicker().getByText(reason)).toBeTruthy()
  expect(episodePicker().getByRole('status').textContent).toBe(reason) // 비활성 입력의 설명에만 두지 않고 화면에 읽히는 문구로 둔다
  expect(episodePicker().queryByText(/이 회차의 관계로 기록/)).toBeNull() // 잠금 이유와 모순되는 '저장하면 이 회차로 기록' 도움말은 숨긴다
  expect(input.disabled).toBe(true)
  expect(episodePicker().getByRole<HTMLButtonElement>('button', { name: '이 회차 관계 보기' }).disabled).toBe(true)
  expect(episodePicker().getByRole<HTMLButtonElement>('button', { name: '최신으로' }).disabled).toBe(true)
})

it('validates the typed episode, reads that episode with its relations, and returns to the latest', async () => {
  const { repository, id, input } = await openEpisodes()
  const read = vi.spyOn(repository, 'read'), show = () => episodePicker().getByRole<HTMLButtonElement>('button', { name: '이 회차 관계 보기' })
  expect(input.placeholder).toBe('최신')
  expect(episodePicker().getByText(/세계관을 저장하면 이 회차의 관계로 기록/)).toBeTruthy() // 잠기지 않았으면 저장 기준 도움말이 보인다
  expect(show().disabled).toBe(true) // 지금 보는 회차(최신)와 같다
  expect(episodePicker().getByRole<HTMLButtonElement>('button', { name: '최신으로' }).disabled).toBe(true)
  expect(relationTable().getByRole('button', { name: '가람 · 친구 · 나래 편집' })).toBeTruthy() // 최신(2화)의 관계
  fireEvent.change(input, { target: { value: '0' } })
  expect(episodePicker().getByRole('alert').textContent).toBe('관계 기준 회차는 1 이상의 정수로 입력해 주세요.')
  expect(input.getAttribute('aria-invalid')).toBe('true')
  expect(show().disabled).toBe(true)
  fireEvent.change(input, { target: { value: '1' } })
  expect(episodePicker().queryByRole('alert')).toBeNull()
  fireEvent.click(show())
  expect(await screen.findByText('아직 연결한 관계가 없어요.')).toBeTruthy()
  expect(read).toHaveBeenLastCalledWith(id, expect.any(AbortSignal), 1)
  expect(screen.getByRole<HTMLInputElement>('textbox', { name: '관계 기준 화' }).value).toBe('1') // 다시 열린 편집기도 지금 보는 회차를 보인다
  fireEvent.click(episodePicker().getByRole('button', { name: '최신으로' }))
  expect(await screen.findByRole('button', { name: '가람 · 친구 · 나래 편집' })).toBeTruthy()
  expect(read).toHaveBeenLastCalledWith(id, expect.any(AbortSignal), undefined)
  expect(screen.getByRole<HTMLInputElement>('textbox', { name: '관계 기준 화' }).value).toBe('')
})

it('locks the relation episode picker while changes are unsaved and says why', async () => {
  const { vm, input } = await openEpisodes()
  act(() => vm().patch({ description: '고친 설명' }))
  expect(input.disabled).toBe(true)
  expect(episodePicker().getByText('저장하지 않은 변경이 있어 회차를 바꿀 수 없어요. 먼저 세계관을 저장하세요.')).toBeTruthy()
})

it('shows a relation to a deleted setting by its deleted name, read-only, and never offers it as a new endpoint', async () => {
  const useCase = new WorldStudioUseCase(new InMemoryWorldStudioRepository())
  const world = await useCase.create('세계', ''), a = newSetting('people'), b = newSetting('people')
  a.item.title = '가람'
  b.item.title = '나래'
  const settings = putRelation([a, b], { subjectId: a.item.id, targetId: b.item.id, predicate: 'friend_of', polarity: 'asserted' })
  const named = crypto.randomUUID() // 서버가 삭제된 카드의 이름을 알려 준 끝점
  const gone = { ...settings[2], item: { ...settings[2].item, id: crypto.randomUUID(), predicate: 'custom_relation', text: '옛 동료', title: '옛 동료', targetId: crypto.randomUUID() } }
  const goneNamed = { ...gone, item: { ...gone.item, id: crypto.randomUUID(), text: '옛 스승', title: '옛 스승', targetId: named } }
  await useCase.save({ ...world, settings: [...settings, gone, goneNamed], deletedTitles: { [named]: '폐허 도서관' } })
  function Harness() {
    const vm = useWorldStudioViewModel(useCase)
    return vm.editing ? <WorldRelationshipEditor studio={vm} /> : null
  }
  render(
    <MemoryRouter initialEntries={['/worldstudio/' + world.id]}>
      <Routes><Route path='/worldstudio/:worldId' element={<Harness />} /></Routes>
    </MemoryRouter>,
  )
  const row = (await screen.findByText('삭제된 설정', { selector: 'td' })).closest('tr')!
  expect(Array.from(row.querySelectorAll('td'), (cell) => cell.textContent?.trim()).slice(0, 3)).toEqual(['가람', '옛 동료', '삭제된 설정'])
  expect(within(row).queryAllByRole('button')).toHaveLength(0)
  expect(within(row).getByText('읽기 전용')).toBeTruthy()
  expect(relationTable().getByRole('button', { name: '가람 · 친구 · 나래 편집' })).toBeTruthy() // 다른 관계는 그대로 고칠 수 있다
  const reason = screen.getByText(/삭제된 설정과 이어진 관계는 읽기 전용이에요/)
  expect(reason).toBeTruthy()
  const titled = screen.getByText('삭제된 설정: 폐허 도서관', { selector: 'td' }).closest('tr')! // 이름을 아는 삭제된 설정은 이름을 붙여 보인다
  expect(Array.from(titled.querySelectorAll('td'), (cell) => cell.textContent?.trim()).slice(0, 3)).toEqual(['가람', '옛 스승', '삭제된 설정: 폐허 도서관'])
  for (const readOnly of [row, titled]) expect(readOnly.getAttribute('aria-describedby')).toBe(reason.id) // 읽기 전용인 이유가 그 행에 이어진다
  expect(within(screen.getByRole('combobox', { name: '관계 대상' })).queryByText(/삭제된 설정/)).toBeNull()
})

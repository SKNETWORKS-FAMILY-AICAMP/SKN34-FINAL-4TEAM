// @vitest-environment jsdom
import '../../../../test/reactFlowStubs'
import { act, cleanup, fireEvent, render as renderBare, screen, waitFor, within } from '@testing-library/react'
import type { ReactElement } from 'react'
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
import { cardTypeOf } from '../../../../domain/entities/studioCards'
import { newSetting } from '../../../../domain/entities/studioWorld'
import { EpisodeWorldRepository } from '../../../../test/episodeWorldRepository'
const { useWorldStudioViewModel } = studioViewModel
/** 관계 작성 패널은 시트(Sheet)라 앱 스토어(Provider)가 있어야 한다. 이미 Provider를 두른 테스트는 한 겹 더 쌓일 뿐이다. */
const render = (ui: ReactElement) => renderBare(<Provider store={createAppStore({ role: 'user' })}>{ui}</Provider>)
// 카드 설명 편집기(Toast UI Editor)는 jsdom에서 입력을 흉내 낼 수 없어 같은 값 전달만 하는 textarea 대역을 쓴다.
vi.mock('../../../shared/LazyMarkdownEditor', () => import('../../../../test/markdownEditorFake'))
/** 관리 모드 설정집 화면의 왼쪽 사이드바 보기 전환 메뉴(설정집·관계도·시간선)에서 버튼을 찾는다. */
const manageTab = (name: string) => within(screen.getByRole('navigation', { name: '세계관 메뉴' })).getByRole('button', { name })
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})
it('많은 카드(101장)도 모두 한 그래프에 그리고, 설정 찾기로 마지막 카드를 고르면 그 카드가 선택된다', async () => {
  const useCase = new WorldStudioUseCase(new InMemoryWorldStudioRepository())
  const world = await useCase.create('대형 세계', '')
  world.settings = Array.from({ length: 101 }, (_, i) => { const row = newSetting('people'); row.item.title = `설정 ${i}`; return row })
  await useCase.save(world)
  function Harness() { const vm = useWorldStudioViewModel(useCase); return vm.editing ? <WorldRelationshipEditor studio={vm} /> : null }
  render(<MemoryRouter initialEntries={['/worldstudio/' + world.id]}><Routes><Route path='/worldstudio/:worldId' element={<Harness />} /></Routes></MemoryRouter>)
  await screen.findByRole('group', { name: '설정 0 인물 카드' })
  expect(cardCount()).toBe(101) // 쪽으로 나누지 않고 전체를 그린다
  const find = screen.getByRole<HTMLInputElement>('combobox', { name: '설정 찾기' })
  fireEvent.change(find, { target: { value: '설정 100' } }) // 이름을 쓰거나 목록에서 고른다
  expect(screen.getByRole('group', { name: '설정 100 인물 카드' }).getAttribute('aria-current')).toBe('true')
  expect(find.value).toBe('설정 100') // 고른 뒤에도 쓴 글은 초점을 잃을 때까지 남는다(이름을 이어 쓸 수 있게)
  fireEvent.blur(find)
  expect(find.value).toBe('')
})
it('멀리 있는 두 카드의 관계선도 그려져 누르면 그 관계의 편집 시트가 열린다', async () => {
  const useCase = new WorldStudioUseCase(new InMemoryWorldStudioRepository())
  const world = await useCase.create('이웃 관계', '')
  const cards = Array.from({ length: 101 }, (_, i) => { const row = newSetting('people'); row.item.title = `설정 ${i}`; return row })
  world.settings = putRelation(cards, { subjectId: cards[0].item.id, targetId: cards[100].item.id, predicate: 'friend_of', polarity: 'asserted' })
  await useCase.save(world)
  function Harness() { const vm = useWorldStudioViewModel(useCase); return vm.editing ? <WorldRelationshipEditor studio={vm} /> : null }
  render(<MemoryRouter initialEntries={['/worldstudio/' + world.id]}><Routes><Route path='/worldstudio/:worldId' element={<Harness />} /></Routes></MemoryRouter>)
  await screen.findByRole('group', { name: '설정 0 인물 카드' })
  expect(screen.getByRole('group', { name: '설정 100 인물 카드' })).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: /관계선 편집: 설정 0 · 설정 100 · 친구/ }))
  expect(await screen.findByRole('textbox', { name: '실제 관계 1' })).toBeTruthy()
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
  fireEvent.change(screen.getByRole('textbox', { name: '실제 관계 1' }), {
    target: { value: '지키는 장소' },
  })
  fireEvent.click(screen.getByRole('button', { name: '편집본에 적용' }))
  fireEvent.click(screen.getByRole('button', { name: '메모리에 저장' }))
  await waitFor(async () => expect((await useCase.read(world.id)).settings).toHaveLength(3))
  const relation = (await useCase.read(world.id)).settings[2].item
  fireEvent.click(screen.getByRole('button', { name: '관계선 편집: 가람 · 항구 · 지키는 장소' }))
  fireEvent.change(screen.getByRole('textbox', { name: '실제 관계 1' }), {
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
  fireEvent.click(await screen.findByRole('button', { name: '관계선 편집: 가람 · 나래 · 부모 → 자녀' }))
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
  fireEvent.click(await screen.findByRole('group', { name: '가람 인물 카드' })) // 가람을 선택
  act(() => { current!.deleteCard(a.item.id) }) // 편집 화면의 '카드 삭제'와 같은 경로다
  expect(current!.editing!.settings.map((s) => s.item.id)).toEqual([b.item.id])
  expect(current!.saved!.settings).toHaveLength(3)
  fireEvent.click(screen.getByRole('button', { name: '삭제 되돌리기' }))
  expect(current!.editing!.settings).toEqual(world.settings)
  expect(current!.dirty).toBe(false)
  expect(screen.getByRole('group', { name: '가람 인물 카드' }).getAttribute('aria-current')).toBe('true') // 되돌린 카드가 선택돼 있다
  expect(screen.queryByRole('button', { name: '삭제 되돌리기' })).toBeNull()
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
    fireEvent.click(screen.getByRole('button', { name: '관계선 편집: 가람 · 나래 · 친구' }))
    const fact = screen.getByRole('textbox', { name: '실제 관계 1' }),
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
    } else {
      fireEvent.click(screen.getByRole('button', { name: '가람 인물' }))
      fireEvent.click(screen.getByRole('button', { name: '수정하기' })) // 제목은 미리보기를 열고 수정하기가 편집 화면을 연다
    }
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
    expect(screen.getByRole('textbox', { name: '실제 관계 1' })).toBe(fact)
    expect(
      screen.getByRole<HTMLTextAreaElement>('textbox', {
        name: field === 'name' ? '나래 → 가람 수정 감정 1' : '나래 → 가람 감정 1',
      }).value,
    ).toBe(prose)
    fireEvent.click(screen.getByRole('button', { name: '편집본에 적용' }))
    const panel = within(screen.getByRole('dialog', { name: /관계$/ })) // 관계 작성 패널은 시트다
    expect(panel.getByRole('alert').textContent).toContain('다른 곳에서 관계가 변경')
    expect(panel.getByRole('alert').textContent).toContain('입력은 유지')
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

it('preserves the unapplied relationship text when connecting another card is cancelled',async()=>{
 const useCase=new WorldStudioUseCase(new InMemoryWorldStudioRepository())
 const world=await useCase.create('세계',''),a=newSetting('people'),b=newSetting('people'),c=newSetting('people')
 a.item.title='가람';b.item.title='나래';c.item.title='다온';world.settings=[a,b,c];await useCase.save(world)
 let current:ReturnType<typeof useWorldStudioViewModel>|undefined
 function Harness(){const vm=useWorldStudioViewModel(useCase);current=vm;return vm.editing?<WorldRelationshipEditor studio={vm}/>:null}
 vi.spyOn(window,'confirm').mockReturnValue(false)
 render(<MemoryRouter initialEntries={['/worldstudio/'+world.id]}><Routes><Route path='/worldstudio/:worldId' element={<Harness/>}/></Routes></MemoryRouter>)
 await screen.findByRole('group',{name:'가람 인물 카드'});await toCards()
 fireEvent.click(screen.getByRole('button',{name:'가람 관계 연결'}))
 fireEvent.click(screen.getByRole('button',{name:'나래 상대 선택'}))
 fireEvent.change(screen.getByRole('textbox',{name:'실제 관계 1'}),{target:{value:'작성 중인 관계'}})
 await waitFor(()=>expect(current!.relationDirty).toBe(true))
 fireEvent.click(screen.getByRole('button',{name:'가람 관계 연결'})) // 다른 연결을 시작하면 작성 중인 입력을 버릴지 묻고, 거절하면 그대로다
 expect(window.confirm).toHaveBeenCalledOnce()
 expect(screen.getByRole('dialog',{name:'가람 ↔ 나래 관계'})).toBeTruthy()
 expect(screen.getByRole<HTMLInputElement>('textbox',{name:'실제 관계 1'}).value).toBe('작성 중인 관계')
 expect(screen.queryByRole('button',{name:'연결 취소'})).toBeNull() // 연결 모드도 시작되지 않았다
})

it('does not discard a new relation with a custom name but no description on apply',async()=>{
 const useCase=new WorldStudioUseCase(new InMemoryWorldStudioRepository())
 const world=await useCase.create('세계',''),a=newSetting('people'),b=newSetting('people')
 a.item.title='가람';b.item.title='나래'
 world.settings=putRelation([a,b],{subjectId:a.item.id,targetId:b.item.id,predicate:'friend_of',polarity:'asserted'});await useCase.save(world)
 function Harness(){const vm=useWorldStudioViewModel(useCase);return vm.editing?<WorldRelationshipEditor studio={vm}/>:null}
 render(<MemoryRouter initialEntries={['/worldstudio/'+world.id]}><Routes><Route path='/worldstudio/:worldId' element={<Harness/>}/></Routes></MemoryRouter>)
 fireEvent.click(await screen.findByRole('button',{name:'관계선 편집: 가람 · 나래 · 친구'}))
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
 fireEvent.click(await screen.findByRole('button',{name:'가람 관계 연결'}))
 fireEvent.click(screen.getByRole('button',{name:'나래 상대 선택'}))
 fireEvent.change(screen.getByRole('textbox',{name:'실제 관계 1'}),{target:{value:'작성 중인 관계'}})
 fireEvent.click(screen.getByRole('button',{name:'관계선 편집: 나래 · 가람 · 신뢰'})) // 같은 두 설정의 반대 방향 관계를 누른다
 expect(window.confirm).not.toHaveBeenCalled()
 expect(screen.getByRole<HTMLInputElement>('textbox',{name:'실제 관계 1'}).value).toBe('작성 중인 관계')
})

it('focuses connection cancel, cancels choosing with Escape and clears it when the source person is deleted elsewhere',async()=>{
 const useCase=new WorldStudioUseCase(new InMemoryWorldStudioRepository())
 const world=await useCase.create('세계',''),a=newSetting('people'),b=newSetting('places')
 a.item.title='가람';b.item.title='항구';world.settings=[a,b];await useCase.save(world)
 let current:ReturnType<typeof useWorldStudioViewModel>|undefined
 function Harness(){const vm=useWorldStudioViewModel(useCase);current=vm;return vm.editing?<WorldRelationshipEditor studio={vm}/>:null}
 render(<MemoryRouter initialEntries={['/worldstudio/'+world.id]}><Routes><Route path='/worldstudio/:worldId' element={<Harness/>}/></Routes></MemoryRouter>)
 fireEvent.click(await screen.findByRole('button',{name:'가람 관계 연결'}))
 expect(document.activeElement).toBe(screen.getByRole('button',{name:'연결 취소'}))
 expect(screen.getByRole('status').textContent).toContain('가람의 연결 상대')
 fireEvent.keyDown(screen.getByRole('button',{name:'연결 취소'}),{key:'Escape'})
 expect(screen.queryByRole('button',{name:'연결 취소'})).toBeNull()
 expect(document.activeElement).toBe(screen.getByRole('button',{name:'가람 관계 연결'}))
 fireEvent.click(screen.getByRole('button',{name:'가람 관계 연결'}))
 act(()=>{current!.deleteCard(a.item.id)}) // 편집 화면의 카드 삭제로 연결을 시작한 카드가 지워졌다(관계도는 그동안 숨은 채 마운트돼 있다)
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
  const filter = within(await screen.findByRole('group', { name: '관계도 유형 필터' }))
  await screen.findByRole('group', { name: '가람 인물 카드' })
  await toCards()
  return filter
}
/** 유형 필터 버튼들(전체 · 유형…)의 눌림 상태. */
const pressed = () => within(screen.getByRole('group', { name: '관계도 유형 필터' })).getAllByRole('button').map((b) => b.getAttribute('aria-pressed'))

it('filters the graph by card type: hiding a type removes its cards and the edges touching them, and 전체 restores', async () => {
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
/** 회차 선택(페이지가 편집기 바로 위에 둔다)과 관계 편집기만 그린다. 소설이 연결된 세계관: 1화에는 관계가 없고 2화(최신)에 가람과 나래의 친구 관계가 있다. `supported`가 false면 회차를 모르는 메모리 데모다. `from`은 서버가 준 그 관계의 시작 회차(N화부터)다. */
async function openEpisodes({ linked = true, supported = true, from }: { linked?: boolean; supported?: boolean; from?: number } = {}) {
  const a = newSetting('people'), b = newSetting('people')
  a.item.title = '가람'
  b.item.title = '나래'
  const settings = putRelation([a, b], { subjectId: a.item.id, targetId: b.item.id, predicate: 'friend_of', polarity: 'asserted', fromEpisode: from })
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

it.each([
  ['데모에서는 지원하지 않아요.', { supported: false }],
  ['소설을 연결하면 회차별로 기록할 수 있어요.', { linked: false }],
] as const)('locks the relation episode picker with its reason: %s', async (reason, options) => {
  const { input } = await openEpisodes(options)
  expect(episodePicker().getByText(reason)).toBeTruthy()
  expect(episodePicker().getByRole('status').textContent).toBe(reason) // 비활성 입력의 설명에만 두지 않고 화면에 읽히는 문구로 둔다
  expect(episodePicker().queryByText(/관계를 몇 화부터로 기록할지/)).toBeNull() // 잠금 이유와 모순되는 도움말은 숨긴다
  expect(input.disabled).toBe(true)
  expect(episodePicker().getByRole<HTMLButtonElement>('button', { name: '이 회차 관계 보기' }).disabled).toBe(true)
  expect(episodePicker().getByRole<HTMLButtonElement>('button', { name: '최신으로' }).disabled).toBe(true)
})

it('validates the typed episode, reads that episode with its relations, and returns to the latest', async () => {
  const { repository, id, input } = await openEpisodes()
  const read = vi.spyOn(repository, 'read'), show = () => episodePicker().getByRole<HTMLButtonElement>('button', { name: '이 회차 관계 보기' })
  expect(input.placeholder).toBe('최신')
  expect(episodePicker().queryByText(/관계를 몇 화부터로 기록할지는 관계마다 적고/)).toBeNull() // 기록 회차는 관계 작성 시트가 알리므로 이 칸에는 긴 도움말을 두지 않는다
  expect(show().disabled).toBe(true) // 지금 보는 회차(최신)와 같다
  expect(episodePicker().getByRole<HTMLButtonElement>('button', { name: '최신으로' }).disabled).toBe(true)
  expect(screen.getByRole('button', { name: /관계선 편집: 가람 · 나래/ })).toBeTruthy() // 최신(2화)의 관계
  fireEvent.change(input, { target: { value: '0' } })
  expect(episodePicker().getByRole('alert').textContent).toBe('관계 기준 회차는 1 이상의 정수로 입력해 주세요.')
  expect(input.getAttribute('aria-invalid')).toBe('true')
  expect(show().disabled).toBe(true)
  fireEvent.change(input, { target: { value: '1' } })
  expect(episodePicker().queryByRole('alert')).toBeNull()
  fireEvent.click(show())
  await waitFor(() => expect(screen.queryByRole('button', { name: /관계선 편집: 가람 · 나래/ })).toBeNull()) // 1화 시점에는 그 관계가 없다
  expect(read).toHaveBeenLastCalledWith(id, expect.any(AbortSignal), 1)
  expect(screen.getByRole<HTMLInputElement>('textbox', { name: '관계 기준 화' }).value).toBe('1') // 다시 열린 편집기도 지금 보는 회차를 보인다
  fireEvent.click(episodePicker().getByRole('button', { name: '최신으로' }))
  expect(await screen.findByRole('button', { name: /관계선 편집: 가람 · 나래/ })).toBeTruthy()
  expect(read).toHaveBeenLastCalledWith(id, expect.any(AbortSignal), undefined)
  expect(screen.getByRole<HTMLInputElement>('textbox', { name: '관계 기준 화' }).value).toBe('')
})

it('locks the relation episode picker while changes are unsaved and says why', async () => {
  const { vm, input } = await openEpisodes()
  act(() => vm().patch({ description: '고친 설명' }))
  expect(input.disabled).toBe(true)
  expect(episodePicker().getByText('저장하지 않은 변경이 있어 회차를 바꿀 수 없어요. 먼저 세계관을 저장하세요.')).toBeTruthy()
})

it('shows the saved N화부터 in the relation sheet and records the one typed in its edit row (DEC-54)', async () => {
  const { repository, vm } = await openEpisodes({ from: 2 })
  fireEvent.click(screen.getByRole('button', { name: /관계선 편집: 가람 · 나래/ }))
  const field = screen.getByRole<HTMLInputElement>('textbox', { name: '실제 관계 1 시작 회차 화부터' })
  expect(field.value).toBe('2') // 서버가 준 그 관계의 시작 회차
  fireEvent.change(field, { target: { value: '4' } })
  fireEvent.click(screen.getByRole('button', { name: '편집본에 적용' }))
  const save = vi.spyOn(repository, 'saveStudio')
  await act(async () => { await vm().save() })
  expect(save.mock.calls[0][0].settings.find((s) => s.item.kind === 'relation')?.item.fromEpisode).toBe(4)
  expect(save).toHaveBeenCalledWith(expect.objectContaining({ id: expect.any(String) }), expect.anything(), undefined) // 보는 회차(최신)가 아니라 관계마다의 N화부터가 기록 회차를 정한다
})

it.each([{ linked: false }, { supported: false }])('has no N화부터 input without a linked novel or in the demo (%j)', async (options) => {
  await openEpisodes({ ...options, from: 2 })
  fireEvent.click(screen.getByRole('button', { name: /관계선 편집: 가람 · 나래/ }))
  expect(screen.queryByRole('textbox', { name: /시작 회차/ })).toBeNull()
})

it('relations to deleted settings are not drawn and only their count is told in one line (they stay when saved)', async () => {
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
  expect(await screen.findByText('삭제된 설정과 이어진 관계 2개는 저장 시 그대로 유지돼요')).toBeTruthy()
  expect(cardCount()).toBe(2) // 삭제된 설정은 그릴 카드가 없다
  expect(screen.getAllByRole('button', { name: /관계선 편집/ })).toHaveLength(1) // 그릴 수 있는 관계는 가람 · 나래 하나뿐이고
  expect(screen.getByRole('button', { name: '관계선 편집: 가람 · 나래 · 친구' })).toBeTruthy() // 그 관계는 그대로 고칠 수 있다
})

// ── 관계도: 모든 카드를 한 그래프에 ──────────────────────────────────────────────────────────────────────────
/** 인물 허브 하나가 이웃 15장(인물)과 관계로 이어지고 외톨이 카드 5장이 따로 있는 세계관의 관계 편집기. */
async function openHub() {
  const useCase = new WorldStudioUseCase(new InMemoryWorldStudioRepository())
  const world = await useCase.create('허브 세계', '')
  const hub = newSetting('people'), others = Array.from({ length: 15 }, (_, i) => { const row = newSetting('people'); row.item.title = '이웃 ' + i; return row }), loners = Array.from({ length: 5 }, (_, i) => { const row = newSetting('places'); row.item.title = '외톨이 ' + i; return row })
  hub.item.title = '허브'
  world.settings = others.reduce((rows, other) => putRelation(rows, { subjectId: hub.item.id, targetId: other.item.id, predicate: 'friend_of', polarity: 'asserted' }), [hub, ...others, ...loners])
  await useCase.save(world)
  function Harness() {
    const vm = useWorldStudioViewModel(useCase)
    return vm.editing ? <WorldRelationshipEditor studio={vm} /> : null
  }
  render(<MemoryRouter initialEntries={['/worldstudio/' + world.id]}><Routes><Route path='/worldstudio/:worldId' element={<Harness />} /></Routes></MemoryRouter>)
  await screen.findByRole('group', { name: '허브 인물 카드' })
  return { hub, others }
}
const cardCount = () => document.querySelectorAll('.react-flow__node').length // 점이든 카드든 노드 하나가 카드 한 장이다
/** 관계도를 카드 단계(near)까지 확대한다: 시맨틱 줌이라 카드가 많거나 퍼져 있으면 처음에는 점이고 카드 버튼은 가까이서만 있다. */
async function toCards() {
  const flow = document.querySelector('.relationship-flow')!
  for (let i = 0; i < 24 && flow.getAttribute('data-level') !== 'near'; i++) {
    fireEvent.click(screen.getByRole('button', { name: '확대' }))
    await waitFor(() => {})
  }
  expect(flow.getAttribute('data-level')).toBe('near')
}
/** 선 위 관계 이름(화면 좌표 이름표 층): 모든 단계에서 기본 숨김이고 마우스를 올리거나 초점이 간·고른 선에만 보인다. */
const edgeLabels = () => document.querySelectorAll('.relationship-edge-name').length

it('모든 카드를 한 그래프에 그리고(중심 카드·이웃 쪽 이동·전체 관계도로는 없다), 선 위 관계 이름은 모든 단계에서 기본 숨김이며 마우스를 올린 동안 그 선에만 보인다', async () => {
  await openHub()
  expect(cardCount()).toBe(21) // 허브 + 이웃 15장 + 외톨이 5장 전체
  expect(screen.getByRole('group', { name: '외톨이 0 장소 카드' })).toBeTruthy()
  for (const gone of ['이웃 페이지 이동', '그래프 페이지 이동']) expect(screen.queryByRole('navigation', { name: gone })).toBeNull()
  for (const gone of ['전체 관계도로', '중심 카드로 보기']) expect(screen.queryByRole('button', { name: gone })).toBeNull()
  expect(edgeLabels()).toBe(0) // 멀리서는 관계 이름이 없고(<title> 툴팁만)
  expect(screen.getAllByRole('button', { name: /관계선 편집: 허브 · 이웃/ })).toHaveLength(15) // 선은 그대로 읽히고 누를 수 있다
  fireEvent.click(screen.getByRole('group', { name: '이웃 3 인물 카드' })) // 멀리서 점을 누르면 그 카드로 다가간다(중간 단계)
  await waitFor(() => expect(document.querySelector('.relationship-flow')!.getAttribute('data-level')).toBe('mid'))
  expect(edgeLabels()).toBe(0) // 중간에서도 기본 숨김(예전에는 모든 선에 라벨)
  const line = () => screen.getByRole('button', { name: /관계선 편집: 허브 · 이웃 3 · / })
  fireEvent.mouseEnter(line())
  expect(edgeLabels()).toBe(1) // 선에 마우스를 올린 동안만 그 선의 이름
  fireEvent.mouseLeave(line())
  expect(edgeLabels()).toBe(0)
  await toCards()
  expect(edgeLabels()).toBe(0) // 가까이서도 기본 숨김
  fireEvent.mouseEnter(line())
  expect(edgeLabels()).toBe(1)
})

it('카드의 관계 연결 버튼으로 주체를 정하고 상대 선택을 누르면 가운데에 관계 작성 시트가 열려 첫 입력으로 초점이 가고, Esc는 변경이 있으면 확인한 뒤 닫는다', async () => {
  await openHub()
  await toCards() // 카드 버튼은 가까이서만 있다
  fireEvent.click(screen.getByRole('button', { name: '허브 관계 연결' }))
  expect(screen.queryByRole('dialog')).toBeNull() // 주체만 정한 단계
  fireEvent.click(screen.getByRole('button', { name: '이웃 0 상대 선택' }))
  const dialog = await screen.findByRole('dialog', { name: '허브 ↔ 이웃 0 관계' })
  const first = within(dialog).getByRole<HTMLTextAreaElement>('textbox', { name: '실제 관계 1' })
  expect(first.tagName).toBe('TEXTAREA') // 관계 문구는 한 줄 입력이 아니라 여러 줄 칸이다
  expect(first.getAttribute('maxlength')).toBe('3000')
  await waitFor(() => expect(document.activeElement).toBe(first))
  expect(dialog.classList.contains('relationship-sheet')).toBe(true)
  fireEvent.change(first, { target: { value: '오랜 동료' } })
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
  fireEvent.keyDown(document, { key: 'Escape' })
  expect(confirm).toHaveBeenCalledOnce() // 적용하지 않은 입력이 있으니 버릴지 묻는다
  expect(screen.getByRole('dialog', { name: '허브 ↔ 이웃 0 관계' })).toBeTruthy()
  confirm.mockReturnValue(true)
  fireEvent.keyDown(document, { key: 'Escape' })
  expect(screen.queryByRole('dialog')).toBeNull()
})

it('관계도 점(멀리·중간)과 카드 모서리(가까이)에는 유형 색이 있어 인물과 장소를 구분한다', async () => {
  await openHub()
  const far = (name: string) => screen.getByRole('group', { name }).querySelector<HTMLElement>('.relationship-dot')!
  expect(far('허브 인물 카드').style.background).not.toBe('')
  expect(far('허브 인물 카드').style.background).not.toBe(far('외톨이 0 장소 카드').style.background)
  await toCards()
  const dot = (name: string) => screen.getByRole('group', { name }).querySelector<HTMLElement>('.relationship-kind')!
  expect(dot('허브 인물 카드').style.background).not.toBe('')
  expect(dot('허브 인물 카드').style.background).not.toBe(dot('외톨이 0 장소 카드').style.background)
  expect(dot('허브 인물 카드').getAttribute('aria-hidden')).toBe('true')
})

it('설정 찾기 선택지는 한 번에 200개까지라, 설정 60장도 전부 그리고 51번째 이후 설정을 그 자리에서 고른다', async () => {
  const useCase = new WorldStudioUseCase(new InMemoryWorldStudioRepository())
  const world = await useCase.create('큰 세계', '')
  world.settings = Array.from({ length: 60 }, (_, i) => { const row = newSetting('people'); row.item.title = `설정 ${i}`; return row })
  await useCase.save(world)
  function Harness() { const vm = useWorldStudioViewModel(useCase); return vm.editing ? <WorldRelationshipEditor studio={vm} /> : null }
  render(<MemoryRouter initialEntries={['/worldstudio/' + world.id]}><Routes><Route path='/worldstudio/:worldId' element={<Harness />} /></Routes></MemoryRouter>)
  await screen.findByRole('group', { name: '설정 0 인물 카드' })
  expect(cardCount()).toBe(60) // 50장씩 나누지 않는다
  const find = screen.getByRole('combobox', { name: '설정 찾기' }), choices = [...document.getElementById(find.getAttribute('list')!)!.querySelectorAll('option')].map((o) => o.getAttribute('value'))
  expect(choices).toContain('설정 59') // 쪽 이동 없이 51번째 이후 설정도 고른다
  expect(screen.queryAllByRole('navigation', { name: /페이지 이동/ })).toHaveLength(0)
})

// ── 관계도 컨트롤: 위 한 줄(설정 찾기)·카드 삭제·+ 설정 추가·선 삭제·시트 도움말 ─────────────────────────────────────────
it('그래프 위 한 줄에 설정 찾기가 있어, 쓰는 동안 이름에 맞지 않는 카드가 흐려지고 이름을 고르면 그 카드가 선택된다', async () => {
  await openHub()
  const find = screen.getByRole<HTMLInputElement>('combobox', { name: '설정 찾기' })
  expect(find.value).toBe('')
  const options = [...document.getElementById(find.getAttribute('list')!)!.querySelectorAll('option')].map((o) => o.getAttribute('value'))
  expect(options).toContain('이웃 3')
  expect(screen.queryByRole('searchbox', { name: '관계도 설정 검색' })).toBeNull()
  const bar = find.closest('.relationship-bar') as HTMLElement
  expect(bar.compareDocumentPosition(document.querySelector('.relationship-flow')!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy() // 그래프 위다
  fireEvent.change(find, { target: { value: '없는 이름' } }) // 없는 이름은 아무것도 고르지 않고 모든 카드를 흐린다
  expect(document.querySelectorAll('.relationship-dot.dim')).toHaveLength(21) // 멀리서는 점이 흐려진다
  expect(document.querySelector('[aria-current=true]')).toBeNull()
  fireEvent.blur(find)
  expect(find.value).toBe('') // 쓰던 글을 비우고 흐림도 거둔다
  expect(document.querySelectorAll('.relationship-dot.dim')).toHaveLength(0)
  fireEvent.change(find, { target: { value: '이웃 3' } })
  expect(screen.getByRole('group', { name: '이웃 3 인물 카드' }).getAttribute('aria-current')).toBe('true')
  expect(find.value).toBe('이웃 3') // 고른 뒤에도 쓴 글은 초점을 잃을 때까지 남는다
  fireEvent.blur(find)
  expect(find.value).toBe('')
})

it('설정 찾기는 이름을 한 글자씩 쓰는 동안 입력을 지우지 않는다: 한 이름이 다른 이름의 앞부분이어도(가람·가람의 집) 긴 이름까지 이어 쓸 수 있다', async () => {
  const useCase = new WorldStudioUseCase(new InMemoryWorldStudioRepository())
  const world = await useCase.create('세계', ''), a = newSetting('people'), b = newSetting('places')
  a.item.title = '가람'
  b.item.title = '가람의 집'
  world.settings = [a, b]
  await useCase.save(world)
  function Harness() { const vm = useWorldStudioViewModel(useCase); return vm.editing ? <WorldRelationshipEditor studio={vm} /> : null }
  render(<MemoryRouter initialEntries={['/worldstudio/' + world.id]}><Routes><Route path='/worldstudio/:worldId' element={<Harness />} /></Routes></MemoryRouter>)
  const find = await screen.findByRole<HTMLInputElement>('combobox', { name: '설정 찾기' })
  fireEvent.change(find, { target: { value: '가람' } }) // 앞부분과 같은 이름이 있어도 쓰던 글을 지우지 않는다
  expect(screen.getByRole('group', { name: '가람 인물 카드' }).getAttribute('aria-current')).toBe('true')
  expect(find.value).toBe('가람')
  fireEvent.change(find, { target: { value: '가람의 집' } }) // 이어 써서 더 긴 이름의 카드를 찾는다
  expect(screen.getByRole('group', { name: '가람의 집 장소 카드' }).getAttribute('aria-current')).toBe('true')
  expect(find.value).toBe('가람의 집')
  fireEvent.blur(find)
  expect(find.value).toBe('')
})


/** 가람(인물)과 나래가 친구로 이어진 세계관의 관계 편집기 + 이 편집기가 쓰는 뷰모델. */
async function openPair() {
  const useCase = new WorldStudioUseCase(new InMemoryWorldStudioRepository())
  const world = await useCase.create('세계', ''), a = newSetting('people'), b = newSetting('people')
  a.item.title = '가람'
  b.item.title = '나래'
  world.settings = putRelation([a, b], { subjectId: a.item.id, targetId: b.item.id, predicate: 'friend_of', polarity: 'asserted' })
  await useCase.save(world)
  let current: ReturnType<typeof useWorldStudioViewModel> | undefined
  function Harness() {
    const vm = useWorldStudioViewModel(useCase)
    current = vm
    return vm.editing ? <WorldRelationshipEditor studio={vm} /> : null
  }
  render(<MemoryRouter initialEntries={['/worldstudio/' + world.id]}><Routes><Route path='/worldstudio/:worldId' element={<Harness />} /></Routes></MemoryRouter>)
  await screen.findByRole('group', { name: '가람 인물 카드' })
  return { vm: () => current!, a, b }
}

it('카드 메뉴의 삭제는 설정집 편집 화면과 같은 확인(함께 지워지는 관계) 시트를 거치고, 취소하면 그대로이며, 지우면 카드와 관계가 빠지고 되돌리기 알림이 뜬다', async () => {
  const { vm, b } = await openPair()
  const deleteFromMenu = () => { fireEvent.contextMenu(screen.getByRole('group', { name: '가람 인물 카드' })); fireEvent.click(screen.getByRole('menuitem', { name: '삭제' })) }
  deleteFromMenu()
  const dialog = screen.getByRole('dialog', { name: '설정 삭제 확인' }) // 시트로 연다
  expect(within(dialog).getByText(/인물과 연결된 관계·감정 1개를 편집본에서 삭제해요/)).toBeTruthy()
  fireEvent.click(within(dialog).getByRole('button', { name: '삭제 취소' }))
  expect(screen.queryByRole('dialog')).toBeNull()
  expect(vm().dirty).toBe(false) // 취소하면 아무것도 바뀌지 않는다
  deleteFromMenu()
  fireEvent.click(within(screen.getByRole('dialog', { name: '설정 삭제 확인' })).getByRole('button', { name: '인물과 연결 삭제' }))
  expect(vm().editing!.settings.map((s) => s.item.id)).toEqual([b.item.id]) // 카드와 이어진 관계가 함께 빠졌다
  expect(vm().dirty).toBe(true)
  expect(screen.queryByRole('group', { name: '가람 인물 카드' })).toBeNull()
  expect(screen.queryByRole('button', { name: /관계선 편집/ })).toBeNull()
  expect(screen.getByText(/‘가람’ 인물이 삭제됐어요/)).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: '삭제 되돌리기' }))
  expect(vm().dirty).toBe(false)
  expect(screen.getByRole('group', { name: '가람 인물 카드' })).toBeTruthy()
  expect(screen.getByRole('button', { name: /관계선 편집: 가람 · 나래/ })).toBeTruthy()
})

it('+ 설정 추가 패널에서 유형을 고르면 초안에 그 유형의 새 카드가 더해지고(저장 전 변경) 캔버스에서 선택되며 편집 화면으로 가지 않는다', async () => {
  const { vm } = await openPair()
  const before = vm().editing!.settings.length
  fireEvent.click(screen.getByRole('button', { name: '+ 설정 추가' }))
  fireEvent.click(within(screen.getByRole('dialog', { name: '설정 추가' })).getByRole('button', { name: '장소' }))
  await waitFor(() => expect(vm().editing!.settings).toHaveLength(before + 1))
  const added = vm().editing!.settings.at(-1)!.item
  expect(cardTypeOf(added)).toBe('location')
  expect(vm().dirty).toBe(true)
  const node = await screen.findByRole('group', { name: '새 설정 장소 카드' })
  await waitFor(() => expect(node.getAttribute('aria-current')).toBe('true')) // 새 카드가 선택된다
  expect(screen.queryByRole('dialog')).toBeNull() // 패널은 닫히고 편집 화면 시트 같은 것도 열리지 않는다
})

it('선에서 Delete는 확인한 뒤 그 관계만 편집본에서 지우고(카드는 그대로) 저장 전 변경으로 남는다', async () => {
  const { vm } = await openPair()
  vi.spyOn(window, 'confirm').mockReturnValue(true)
  fireEvent.keyDown(screen.getByRole('button', { name: /관계선 편집: 가람 · 나래/ }), { key: 'Delete' })
  expect(window.confirm).toHaveBeenCalledWith('가람 · 친구 · 나래 관계를 삭제할까요? 세계관을 저장해야 반영돼요.')
  expect(screen.queryByRole('button', { name: /관계선 편집/ })).toBeNull()
  expect(vm().editing!.settings.filter((s) => s.item.kind === 'relation')).toHaveLength(0)
  expect(cardCount()).toBe(2)
  expect(vm().relationDirty).toBe(false)
})

it('시트의 N화부터 도움말은 행마다 되풀이하지 않고 시트 위 한 문단이며, 모든 시작 회차 칸의 설명이 그 문단을 가리킨다', async () => {
  await openEpisodes({ from: 2 })
  fireEvent.click(screen.getByRole('button', { name: /관계선 편집: 가람 · 나래/ }))
  const dialog = await screen.findByRole('dialog')
  const help = within(dialog).getAllByText(/기록으로 저장해요/)
  expect(help).toHaveLength(1)
  const fields = within(dialog).getAllByRole('textbox', { name: /시작 회차/ })
  expect(fields.length).toBeGreaterThanOrEqual(1)
  for (const field of fields) expect(field.getAttribute('aria-describedby')!.split(' ')).toContain(help[0].id)
  expect(help[0].compareDocumentPosition(dialog.querySelector('.relationship-group')!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy() // 첫 행 묶음보다 위
})

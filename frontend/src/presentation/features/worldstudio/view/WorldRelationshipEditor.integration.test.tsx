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
/** 관리 모드 설정집 화면의 보기 전환 줄(설정집·인물 관계도·시간선)에서 버튼을 찾는다. */
const manageTab = (name: string) => within(screen.getByRole('navigation', { name: '세계관 메뉴' })).getByRole('button', { name })
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
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
    fireEvent.click(manageTab('인물 관계도'))
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
    fireEvent.click(manageTab('인물 관계도'))
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
  const input = await screen.findByRole<HTMLInputElement>('textbox', { name: '관계 기준 회차' })
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
  expect(input.disabled).toBe(true)
  expect(episodePicker().getByRole<HTMLButtonElement>('button', { name: '이 회차 관계 보기' }).disabled).toBe(true)
  expect(episodePicker().getByRole<HTMLButtonElement>('button', { name: '최신으로' }).disabled).toBe(true)
})

it('validates the typed episode, reads that episode with its relations, and returns to the latest', async () => {
  const { repository, id, input } = await openEpisodes()
  const read = vi.spyOn(repository, 'read'), show = () => episodePicker().getByRole<HTMLButtonElement>('button', { name: '이 회차 관계 보기' })
  expect(input.placeholder).toBe('최신')
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
  expect(screen.getByRole<HTMLInputElement>('textbox', { name: '관계 기준 회차' }).value).toBe('1') // 다시 열린 편집기도 지금 보는 회차를 보인다
  fireEvent.click(episodePicker().getByRole('button', { name: '최신으로' }))
  expect(await screen.findByRole('button', { name: '가람 · 친구 · 나래 편집' })).toBeTruthy()
  expect(read).toHaveBeenLastCalledWith(id, expect.any(AbortSignal))
  expect(screen.getByRole<HTMLInputElement>('textbox', { name: '관계 기준 회차' }).value).toBe('')
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
  const gone = { ...settings[2], item: { ...settings[2].item, id: crypto.randomUUID(), predicate: 'custom_relation', text: '옛 동료', title: '옛 동료', targetId: crypto.randomUUID() } }
  await useCase.save({ ...world, settings: [...settings, gone] })
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
  expect(screen.getByText(/삭제된 설정과 이어진 관계는 읽기 전용이에요/)).toBeTruthy()
  expect(within(screen.getByRole('combobox', { name: '관계 대상' })).queryByText('삭제된 설정')).toBeNull()
})

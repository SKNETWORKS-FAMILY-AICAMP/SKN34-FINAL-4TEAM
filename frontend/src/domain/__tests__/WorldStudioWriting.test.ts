import { describe, expect, it } from 'vitest'
import { cardLibraryRows, newRevealBeyondNovel, revealEpisodeInput, selectCardForFilter, worldSealIssues, worldWritingIssues, writingIssueLabel } from '../entities/worldStudioWriting'
import { cardRevealEpisode, newSetting, RELATION_FROM_ERROR, type StudioWorld } from '../entities/studioWorld'
const world = (settings: StudioWorld['settings'] = []): StudioWorld => ({
  id: 'qa',
  name: '초기 세계',
  description: '',
  version: 1,
  settings,
  analysis: null,
})
it('shows ordinary card types separately from legacy relations and unclassified settings without changing them', () => {
  const person = newSetting('people')
  person.item.title = '가람'
  person.tags = ['주인공']
  person.aliases = ['여행자']
  const fact = newSetting()
  fact.item.title = '기존 사실'
  fact.item.text = '원문'
  const relation = { ...newSetting(), item: { ...newSetting().item, kind: 'relation' as const } }
  const settings = [person, fact, relation], before = structuredClone(settings)
  expect(cardLibraryRows(settings, 'all', '')).toEqual([person])
  expect(cardLibraryRows(settings, 'character', '여행자')).toEqual([person])
  expect(cardLibraryRows(settings, 'location', '')).toEqual([])
  expect(settings).toEqual(before)
})
it('keeps object and other card identities visible without coercing unsupported types', () => {
  const object = newSetting('people')
  object.item.entityType = 'object'
  const other = {
    ...newSetting('people'),
    item: { ...newSetting('people').item, entityType: 'other' },
  }
  expect(cardLibraryRows([object, other], 'object', '')).toEqual([object])
  expect(cardLibraryRows([object, other], 'all', '')).toEqual([object, other])
})
it('does not require optional descriptions or relationships and points missing names back to their exact card', () => {
  expect(worldWritingIssues(world())).toEqual([])
  const person = newSetting('people')
  person.item.title = '가람'
  expect(worldWritingIssues(world([person]))).toEqual([])
  const blank = newSetting('places')
  expect(worldWritingIssues(world([blank]))).toContainEqual({
    step: 'cards',
    id: blank.item.id,
    message: '카드 이름을 입력해 주세요.',
  })
  expect(worldWritingIssues({ ...world(), name: ' ' })).toContainEqual({
    step: 'info',
    message: '세계관 이름을 입력해 주세요.',
  })
  const fact = newSetting()
  fact.item.title = '기존 규칙'
  expect(worldWritingIssues(world([fact]))).toContainEqual({
    step: 'cards',
    id: fact.item.id,
    message: '이 설정의 설명을 입력해 주세요.',
  })
})

it('selects an item that remains visible under either search or type filtering', () => {
  const person = newSetting('people'), place = newSetting('places')
  person.item.title = '가람'
  place.item.title = '항구'
  const settings = [person, place], before = structuredClone(settings)
  expect(selectCardForFilter(settings, person.item.id, 'all', '가람')).toBe(person.item.id)
  expect(selectCardForFilter(settings, person.item.id, 'all', '항구')).toBe(place.item.id)
  expect(selectCardForFilter(settings, person.item.id, 'location', '')).toBe(place.item.id)
  expect(selectCardForFilter(settings, person.item.id, 'all', '없는 설정')).toBe('')
  expect(settings).toEqual(before)
})

it('blocks a confirmed version while a saved card still has no description, because the server requires name and description to seal', () => {
  const person = newSetting('people')
  person.item.title = '가람'
  expect(worldWritingIssues(world([person]))).toEqual([]) // 초안 저장은 이름만으로 된다
  expect(worldSealIssues(world([person]))).toEqual([{ step: 'cards', id: person.item.id, message: '‘가람’의 IDENTITY.md를 입력해야 확정 버전으로 남길 수 있어요.' }]) // 인물 카드의 설명은 IDENTITY.md 문서다
  person.item.text = '떠돌이 검객'
  expect(worldSealIssues(world([person]))).toEqual([])
  const harbor = newSetting('places')
  harbor.item.title = '항구'
  expect(worldSealIssues(world([harbor]))).toEqual([{ step: 'cards', id: harbor.item.id, message: '‘항구’의 설명을 입력해야 확정 버전으로 남길 수 있어요.' }])
})

it('독자 공개 회차는 비우거나 1 이상의 정수여야 하고, 어긋나면 그 카드로 돌아가 고치게 한다', () => {
  const person = newSetting('people')
  person.item.title = '가람'
  for (const revealFromEpisode of [undefined, 1, 12]) expect(worldWritingIssues(world([{ ...person, revealFromEpisode }]))).toEqual([])
  for (const revealFromEpisode of [0, -1, 1.5, Number.NaN]) {
    expect(worldWritingIssues(world([{ ...person, revealFromEpisode }]))).toEqual([{ step: 'cards', id: person.item.id, message: '독자 공개 회차는 1 이상의 정수로 입력해 주세요.' }])
  }
})

it('인물 문서가 3,000자를 넘거나 회차 번호가 어긋나면 그 카드로 돌아가 고치게 하고, 빠진 문서는 저장도 확정도 막지 않는다', () => {
  const person = newSetting('people')
  person.item.title = '가람'
  person.item.text = '본문'
  const docs = (soul: string, episodes: Record<string, string> = {}) => ({ ...person, characterDocs: { soul, goal: '', episodes } })
  expect(worldWritingIssues(world([person]))).toEqual([]) // SOUL.md·GOAL.md가 없는 기존 인물 카드
  expect(worldSealIssues(world([person]))).toEqual([])
  expect(worldWritingIssues(world([docs('가'.repeat(3000), { 0: '', 3: '기억' })]))).toEqual([])
  expect(worldWritingIssues(world([docs('가'.repeat(3001), { 3: '가'.repeat(3001) })])).map((issue) => writingIssueLabel(world([person]), issue))).toEqual([
    '‘가람’: SOUL.md는 3,000자 이하로 줄여 주세요.', '‘가람’: memory/03회차.md는 3,000자 이하로 줄여 주세요.',
  ])
  expect(worldWritingIssues(world([docs('성격', { '1.5': '기억' })]))).toEqual([{ step: 'cards', id: person.item.id, message: '회차 기억의 회차 번호는 0 이상의 정수로 입력해 주세요.' }])
  const long = { ...person, item: { ...person.item, text: '가'.repeat(3001) } }
  expect(worldWritingIssues(world([long]))).toEqual([{ step: 'cards', id: person.item.id, message: 'IDENTITY.md는 3,000자 이하로 줄여 주세요.' }]) // 본문도 인물 카드에서는 문서로 알린다
  const harbor = newSetting('places')
  harbor.item.title = '항구'
  harbor.item.text = '가'.repeat(3001)
  expect(worldWritingIssues(world([harbor]))).toEqual([]) // 인물이 아닌 카드의 본문 길이는 지금처럼 저장할 때 본다
})

it('저장 전 확인 사유를 화면에 보일 때는 어느 설정의 문제인지 이름을 앞에 붙이고, 이름이 빈 설정은 이름 없는 설정이라 부른다', () => {
  const rule = newSetting()
  rule.item.title = ' 금기 '
  const blank = newSetting('places')
  const draft = { ...world([rule, blank]), name: ' ' }
  expect(worldWritingIssues(draft).map((issue) => writingIssueLabel(draft, issue))).toEqual([
    '세계관 이름을 입력해 주세요.', // 세계관 자체의 문제는 사유 그대로다
    '‘금기’: 이 설정의 설명을 입력해 주세요.',
    '이름 없는 설정: 카드 이름을 입력해 주세요.',
  ])
  expect(writingIssueLabel(draft, { step: 'cards', id: 'missing', message: '카드 이름을 입력해 주세요.' })).toBe('이름 없는 설정: 카드 이름을 입력해 주세요.')
})

it('독자 공개 회차 입력은 숫자만 남겨 정수로 바꾸고, 숫자가 없으면 값을 비운다', () => {
  expect(['3', ' 12 ', '1.5', '-4', 'abc', '', '0', '007'].map(revealEpisodeInput)).toEqual([3, 12, 15, 4, undefined, undefined, 0, 7])
})

it('카드의 유효 공개 회차(DEC-53)는 회차 값, 값이 없고 공개면 1화(옛 공개 카드), 그 밖은 작가 전용이다', () => {
  // 서버 shownCardEpisode와 같은 규칙이다: 회차 값이 있으면 공개 여부와 무관하게 그 값이다.
  expect(cardRevealEpisode({ revealFromEpisode: 3, visibility: 'private' })).toBe(3)
  expect(cardRevealEpisode({ revealFromEpisode: 3, visibility: 'public' })).toBe(3)
  expect(cardRevealEpisode({ visibility: 'public' })).toBe(1)
  expect(cardRevealEpisode({ visibility: 'private' })).toBeUndefined()
  expect(cardRevealEpisode({})).toBeUndefined()
})

describe('연결된 소설에 없는 회차는 새로 정한 공개 회차로 저장할 수 없다(소설의 마지막 회차 안에서만, 이미 저장된 값은 막지 않는다)', () => {
  const card = (revealFromEpisode?: number) => {
    const row = newSetting('people')
    row.item.title = '가람'
    return { ...row, ...(revealFromEpisode !== undefined && { revealFromEpisode }) }
  }
  const at = (row: StudioWorld['settings'][number], linkedWorkId: string | null = 'work-1'): StudioWorld => ({ ...world([row]), linkedWorkId })
  const beyond = (row: StudioWorld['settings'][number], message: string) => [{ step: 'cards', id: row.item.id, message }]

  it('저장한 값과 달라진(새로 정한) 공개 회차가 소설의 마지막 회차를 넘으면 그 카드로 돌아가 고치게 한다', () => {
    const saved = card(2)
    expect(worldWritingIssues(at({ ...saved, revealFromEpisode: 9 }), at(saved), 5)).toEqual(beyond(saved, '이 소설은 5화까지 있어요.'))
    expect(worldWritingIssues(at({ ...saved, revealFromEpisode: 5 }), at(saved), 5)).toEqual([]) // 마지막 회차는 된다
    expect(worldWritingIssues(at({ ...saved, revealFromEpisode: undefined }), at(saved), 5)).toEqual([]) // 비우면(작가 전용) 늘 된다
    const fresh = card()
    expect(worldWritingIssues(at({ ...fresh, revealFromEpisode: 1 }), at(fresh), 0)).toEqual(beyond(fresh, '이 소설에는 아직 회차가 없어요.'))
  })

  it('이미 저장된 값은 소설보다 커도 막지 않는다(저장값을 자동으로 고치지 않고, 다른 수정의 저장도 잠그지 않는다)', () => {
    const stale = card(193)
    expect(worldWritingIssues(at(stale), at(stale), 0)).toEqual([])
    expect(worldWritingIssues(at({ ...stale, item: { ...stale.item, title: '가람2' } }), at(stale), 0)).toEqual([])
  })

  it('소설의 회차 수를 모르거나(읽는 중·실패) 저장한 초안을 모르거나 연결되지 않은 세계관이면 보지 않는다', () => {
    const saved = card(2), changed = { ...saved, revealFromEpisode: 99 }
    expect(worldWritingIssues(at(changed), at(saved))).toEqual([])
    expect(worldWritingIssues(at(changed), undefined, 5)).toEqual([])
    expect(worldWritingIssues(at(changed, null), at(saved, null), 5)).toEqual([])
  })

  it('1 이상의 정수가 아닌 값은 기존 사유가 먼저이고 같은 카드에 두 사유를 겹쳐 쓰지 않는다', () => {
    const saved = card(2)
    expect(worldWritingIssues(at({ ...saved, revealFromEpisode: 0 }), at(saved), 5).map((i) => i.message)).toEqual(['독자 공개 회차는 1 이상의 정수로 입력해 주세요.'])
  })
})

describe('newRevealBeyondNovel: 사용자가 새로 정한 공개 회차만 소설의 마지막 회차와 견준다(카드 편집 화면의 오류 표시와 저장 전 확인이 같은 규칙)', () => {
  const card = (revealFromEpisode?: number) => {
    const row = newSetting('people')
    row.item.title = '가람'
    return { ...row, ...(revealFromEpisode !== undefined && { revealFromEpisode }) }
  }
  const saved = (row: StudioWorld['settings'][number], linkedWorkId: string | null = 'work-1'): StudioWorld => ({ ...world([row]), linkedWorkId })

  it('저장한 값에서 바꾼 공개 회차가 상한을 넘으면 안내를, 마지막 회차 안이거나 비우면 빈 글을 준다', () => {
    const stored = card(2)
    const check = newRevealBeyondNovel(saved(stored), 5)
    expect(check({ ...stored, revealFromEpisode: 9 })).toBe('이 소설은 5화까지 있어요.')
    expect([check({ ...stored, revealFromEpisode: 5 }), check({ ...stored, revealFromEpisode: undefined })]).toEqual(['', ''])
    expect(newRevealBeyondNovel(saved(card()), 0)({ ...card(), revealFromEpisode: 1 })).toBe('이 소설에는 아직 회차가 없어요.')
  })

  it('저장해 둔 값은 소설보다 커도 빈 글이다(손대지 않은 값에는 오류를 보이지 않고, 저장값으로 되돌려도 그렇다)', () => {
    const stale = card(193)
    expect(newRevealBeyondNovel(saved(stale), 0)(stale)).toBe('')
    expect(newRevealBeyondNovel(saved(stale), 5)(stale)).toBe('')
    const check = newRevealBeyondNovel(saved(stale), 5)
    expect(check({ ...stale, revealFromEpisode: 200 })).toBe('이 소설은 5화까지 있어요.') // 다른 큰 값으로 바꾸면 새로 정한 값이다
    expect(check({ ...stale, revealFromEpisode: 193 })).toBe('') // 다시 저장값으로 돌리면 빈 글이다
  })

  it('소설의 회차 수를 모르거나 저장한 초안을 모르거나 연결되지 않은 세계관이거나 1 이상의 정수가 아닌 값이면 빈 글이다', () => {
    const stored = card(2), changed = { ...stored, revealFromEpisode: 99 }
    expect(newRevealBeyondNovel(saved(stored), undefined)(changed)).toBe('')
    expect(newRevealBeyondNovel(undefined, 5)(changed)).toBe('')
    expect(newRevealBeyondNovel(saved(stored, null), 5)(changed)).toBe('')
    expect([0, -1, 1.5].map((revealFromEpisode) => newRevealBeyondNovel(saved(stored), 5)({ ...stored, revealFromEpisode }))).toEqual(['', '', '']) // 그 값은 invalidReveal이 가린다
  })

  it('저장한 초안에 없는 카드(새로 더한 카드)는 입력한 값이 바로 새로 정한 값이다', () => {
    const fresh = card()
    expect(newRevealBeyondNovel(saved(card(2)), 3)({ ...fresh, revealFromEpisode: 9 })).toBe('이 소설은 3화까지 있어요.')
  })
})

describe('관계의 N화부터는 소설이 연결된 세계관에서 새로 쓰거나 바꾼 관계마다 있어야 저장할 수 있다(DEC-54 2단계)', () => {
  const [a, b] = [newSetting('people'), newSetting('people')]
  a.item.title = '가람'
  b.item.title = '나래'
  const relation = (patch: Partial<StudioWorld['settings'][number]['item']> = {}) => {
    const row = newSetting()
    row.item = { ...row.item, kind: 'relation', title: '친구', text: '오랜 친구', subjectId: a.item.id, targetId: b.item.id, predicate: 'custom_relation', ...patch }
    return row
  }
  const linked = (settings: StudioWorld['settings'], linkedWorkId: string | null = 'work-1'): StudioWorld => ({ ...world(settings), linkedWorkId })
  const issue = (id: string) => ({ step: 'relations', id, message: RELATION_FROM_ERROR })

  it('저장한 초안에 없는 새 관계는 N화부터가 없거나 잘못되면 그 관계로 돌아가 고치게 하고, 올바르면 막지 않는다', () => {
    const saved = linked([a, b])
    const added = relation()
    expect(worldWritingIssues(linked([a, b, added]), saved)).toEqual([issue(added.item.id)])
    for (const fromEpisode of [0, -1, 1.5]) expect(worldWritingIssues(linked([a, b, relation({ id: added.item.id, fromEpisode })]), saved), String(fromEpisode)).toEqual([issue(added.item.id)])
    expect(worldWritingIssues(linked([a, b, relation({ id: added.item.id, fromEpisode: 3 })]), saved)).toEqual([])
  })

  it('저장한 초안에서 바뀐 관계도 같고, 그대로인 관계는 N화부터가 없어도 막지 않는다', () => {
    const old = relation()
    const saved = linked([a, b, old])
    expect(worldWritingIssues(linked([a, b, old]), saved)).toEqual([])
    const changed = { ...old, item: { ...old.item, text: '다시 만난 친구' } }
    expect(worldWritingIssues(linked([a, b, changed]), saved)).toEqual([issue(old.item.id)])
    expect(worldWritingIssues(linked([a, b, { ...changed, item: { ...changed.item, fromEpisode: 4 } }]), saved)).toEqual([])
  })

  it('소설을 연결하지 않은 세계관이거나 저장한 초안을 모르는 점검(확정 버전)은 막지 않는다', () => {
    const added = relation()
    expect(worldWritingIssues(linked([a, b, added], null), linked([a, b], null))).toEqual([])
    expect(worldWritingIssues(linked([a, b, added]))).toEqual([])
  })

  it('사유에는 관계 이름이 붙는다', () => {
    const added = relation({ title: '가람 · 친구 · 나래' })
    const draft = linked([a, b, added])
    expect(worldWritingIssues(draft, linked([a, b])).map((i) => writingIssueLabel(draft, i))).toEqual([`‘가람 · 친구 · 나래’: ${RELATION_FROM_ERROR}`])
  })
})

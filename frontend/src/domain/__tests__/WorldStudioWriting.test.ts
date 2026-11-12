import { expect, it } from 'vitest'
import { cardLibraryRows, revealEpisodeInput, selectCardForFilter, worldSealIssues, worldWritingIssues, writingIssueLabel } from '../entities/worldStudioWriting'
import { newSetting, type StudioWorld } from '../entities/studioWorld'
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
  const docs = (soul: string, episodes: Record<string, string> = {}) => ({ ...person, characterDocs: { soul, memory: '', episodes } })
  expect(worldWritingIssues(world([person]))).toEqual([]) // SOUL.md·MEMORY.md가 없는 기존 인물 카드
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

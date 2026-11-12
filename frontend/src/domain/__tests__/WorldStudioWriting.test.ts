import { expect, it } from 'vitest'
import { cardLibraryRows, selectCardForFilter, worldSealIssues, worldWritingIssues } from '../entities/worldStudioWriting'
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
  expect(worldSealIssues(world([person]))).toEqual([{ step: 'cards', id: person.item.id, message: '‘가람’의 설명을 입력해야 확정 버전으로 남길 수 있어요.' }])
  person.item.text = '떠돌이 검객'
  expect(worldSealIssues(world([person]))).toEqual([])
})

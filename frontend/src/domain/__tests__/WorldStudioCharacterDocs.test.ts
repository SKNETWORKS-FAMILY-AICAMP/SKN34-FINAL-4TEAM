import { describe, expect, it } from 'vitest'

import {
  characterDocIssues,
  characterDocName,
  characterDocOfFile,
  characterDocText,
  episodeDocNumbers,
  importCharacterDocs,
  isEpisodeKey,
  matchDocFiles,
  migrateCharacterDocs,
  missingCharacterDocs,
  storedCharacterDocs,
  withCharacterDoc,
  withoutEpisodeDoc,
} from '../entities/characterDocs'
import { newSetting, type CharacterDocs, type StudioSetting } from '../entities/studioWorld'

const person = (text = '', characterDocs?: CharacterDocs): StudioSetting => {
  const row = newSetting('people')
  row.item.title = '가람'
  row.item.text = text
  return characterDocs ? { ...row, characterDocs } : row
}
const place = (characterDocs?: CharacterDocs): StudioSetting => ({ ...newSetting('places'), ...(characterDocs && { characterDocs }) })
const docs = (over: Partial<CharacterDocs> = {}): CharacterDocs => ({ soul: '', goal: '', episodes: {}, ...over })

describe('인물 문서의 이름과 글', () => {
  it('파일 이름은 IDENTITY.md·SOUL.md·GOAL.md이고 회차별 기억은 memory/ 아래 두 자리 0 채움이다', () => {
    expect((['identity', 'soul', 'goal', 0, 3, 12, 120] as const).map(characterDocName)).toEqual([
      'IDENTITY.md', 'SOUL.md', 'GOAL.md', 'memory/00회차.md', 'memory/03회차.md', 'memory/12회차.md', 'memory/120회차.md',
    ])
  })

  it('IDENTITY.md는 카드 본문이고 나머지는 characterDocs에서 읽으며 없는 문서는 빈 글이다', () => {
    const row = person('떠돌이 검객', docs({ soul: '말수가 적다', goal: '스승의 원수를 찾는다', episodes: { 3: '스승을 잃었다' } }))
    expect((['identity', 'soul', 'goal', 3, 4] as const).map((key) => characterDocText(row, key))).toEqual(['떠돌이 검객', '말수가 적다', '스승의 원수를 찾는다', '스승을 잃었다', ''])
    expect((['identity', 'soul', 'goal', 0] as const).map((key) => characterDocText(person('본문'), key))).toEqual(['본문', '', '', ''])
  })

  it('회차별 기억은 넣은 순서와 상관없이 회차 번호 오름차순으로 센다', () => {
    expect(episodeDocNumbers(person('', docs({ episodes: { 120: '', 3: '', 0: '' } })))).toEqual([0, 3, 120])
    expect(episodeDocNumbers(person())).toEqual([])
  })

  it('문서 하나를 고치거나 회차 기억을 지워도 원래 값은 그대로 두고 새 값을 준다', () => {
    const before = docs({ soul: '옛 글', episodes: { 3: '기억' } })
    expect(withCharacterDoc(undefined, 'soul', '새 글')).toEqual(docs({ soul: '새 글' })) // 문서가 없던 카드는 빈 문서에서 시작한다
    expect(withCharacterDoc(before, 'goal', '목표')).toEqual(docs({ soul: '옛 글', goal: '목표', episodes: { 3: '기억' } }))
    expect(withCharacterDoc(before, 0, '')).toEqual(docs({ soul: '옛 글', episodes: { 0: '', 3: '기억' } })) // 빈 회차 기억도 문서로 남는다
    expect(withoutEpisodeDoc(withCharacterDoc(before, 7, '다른 기억'), 3)).toEqual(docs({ soul: '옛 글', episodes: { 7: '다른 기억' } }))
    expect(before).toEqual(docs({ soul: '옛 글', episodes: { 3: '기억' } }))
  })
})

describe('빠진 문서 알림(정리 필요)', () => {
  it('인물 카드에서 IDENTITY.md·SOUL.md·GOAL.md 중 비어 있는(공백뿐인 것도) 문서를 순서대로 알린다', () => {
    expect(missingCharacterDocs(person())).toEqual(['identity', 'soul', 'goal']) // 기존 인물 카드·가져온 인물 카드는 본문만 있다
    expect(missingCharacterDocs(person('본문'))).toEqual(['soul', 'goal'])
    expect(missingCharacterDocs(person('본문', docs({ soul: ' \n ', goal: '목표' })))).toEqual(['soul'])
    expect(missingCharacterDocs(person('본문', docs({ soul: '성격', goal: '목표' })))).toEqual([])
  })

  it('회차별 기억은 없어도 되고, 인물이 아닌 카드는 알리지 않는다', () => {
    expect(missingCharacterDocs(person('본문', docs({ soul: '성격', goal: '목표', episodes: { 1: '' } })))).toEqual([])
    expect(missingCharacterDocs(place())).toEqual([])
    expect(missingCharacterDocs(newSetting('notes'))).toEqual([])
  })
})

describe('저장을 막는 문제', () => {
  it('문서마다 3,000자까지이고 넘은 문서를 파일 이름으로 알린다(IDENTITY.md인 카드 본문도 인물 카드에서는 문서 이름으로)', () => {
    const long = '가'.repeat(3001), full = '가'.repeat(3000)
    expect(characterDocIssues(person(full, docs({ soul: full, goal: '', episodes: { 3: full } })))).toEqual([])
    expect(characterDocIssues(person(long, docs({ soul: long, goal: long, episodes: { 3: long, 120: '짧다' } })))).toEqual([
      'IDENTITY.md는 3,000자 이하로 줄여 주세요.', 'SOUL.md는 3,000자 이하로 줄여 주세요.', 'GOAL.md는 3,000자 이하로 줄여 주세요.', 'memory/03회차.md는 3,000자 이하로 줄여 주세요.',
    ])
    expect(characterDocIssues(person(long))).toEqual(['IDENTITY.md는 3,000자 이하로 줄여 주세요.']) // 본문만 있는 인물 카드
  })

  it('회차 번호가 0 이상의 정수가 아니면 막는다', () => {
    for (const key of ['-1', '1.5', 'abc', '', '03', '1e3', String(Number.MAX_SAFE_INTEGER + 1)]) {
      const episodes = { [key]: '기억' } as unknown as CharacterDocs['episodes']
      expect(characterDocIssues(person('본문', docs({ episodes }))), key).toEqual(['회차 기억의 회차 번호는 0 이상의 정수로 입력해 주세요.'])
    }
    expect(['0', '3', '120', String(Number.MAX_SAFE_INTEGER)].map(isEpisodeKey)).toEqual([true, true, true, true])
  })

  it('문서가 없는 인물 카드와 인물이 아닌 카드는 문제 삼지 않는다(인물이 아닌 카드의 문서는 저장하지 않고, 그 본문은 기존 카드 검증이 본다)', () => {
    expect(characterDocIssues(person())).toEqual([])
    const harbor = place(docs({ soul: '가'.repeat(3001) }))
    harbor.item.text = '가'.repeat(3001)
    expect(characterDocIssues(harbor)).toEqual([])
  })
})

describe('저장되는 문서', () => {
  it('인물 카드에 내용이나 회차 기억이 하나라도 있을 때만 저장하고, 전부 비었거나 인물이 아니면 저장하지 않는다', () => {
    const written = docs({ soul: '성격' })
    expect(storedCharacterDocs(person('본문', written))).toEqual(written)
    expect(storedCharacterDocs(person('본문', docs({ goal: '목표' })))).toEqual(docs({ goal: '목표' })) // GOAL.md만 있어도 문서가 있다
    expect(storedCharacterDocs(person('본문', docs({ episodes: { 3: '' } })))).toEqual(docs({ episodes: { 3: '' } })) // 빈 회차 기억도 만든 문서다
    expect(storedCharacterDocs(person('본문', docs()))).toBeUndefined()
    expect(storedCharacterDocs(person('본문'))).toBeUndefined()
    expect(storedCharacterDocs(place(written))).toBeUndefined()
  })

  it('DEC-47 이전 모양(memory)이 섞여 들어와도 memory 키 없이 00회차로 옮겨 저장하고, memory뿐인 문서도 비었다고 버리지 않는다', () => {
    const old = (memory: string, episodes: Record<number, string> = {}) => ({ soul: '', memory, episodes }) as unknown as CharacterDocs
    const stored = storedCharacterDocs(person('본문', old('스승의 유언', { 3: '기억' })))
    expect(stored).toEqual(docs({ episodes: { 0: '스승의 유언', 3: '기억' } }))
    expect(Object.keys(stored!).sort()).toEqual(['episodes', 'goal', 'soul']) // 저장 시 memory 키가 없다
    expect(storedCharacterDocs(person('본문', old('유언')))).toEqual(docs({ episodes: { 0: '유언' } }))
    expect(storedCharacterDocs(person('본문', old('')))).toBeUndefined()
    expect(storedCharacterDocs(place(old('유언')))).toBeUndefined()
  })
})

describe('옛 인물 문서 이전(DEC-47: MEMORY.md 폐지, GOAL.md 추가)', () => {
  it('memory만 있으면 그 글이 00회차가 되고 memory 키는 없어진다(soul·다른 회차는 그대로)', () => {
    const moved = migrateCharacterDocs({ soul: '성격', memory: '스승의 유언', episodes: { 3: '기억' } })
    expect(moved).toEqual({ soul: '성격', goal: '', episodes: { 0: '스승의 유언', 3: '기억' } })
    expect(Object.keys(moved).sort()).toEqual(['episodes', 'goal', 'soul'])
  })

  it('00회차에 이미 글이 있으면 memory를 그 앞에 빈 줄 하나로 이어 붙인다', () => {
    expect(migrateCharacterDocs({ soul: '', memory: '스승의 유언', episodes: { 0: '프롤로그의 기억', 3: '기억' } }).episodes).toEqual({ 0: '스승의 유언\n\n프롤로그의 기억', 3: '기억' })
  })

  it('memory가 빈 글(공백뿐인 글 포함)이면 아무것도 바꾸지 않는다', () => {
    for (const memory of ['', ' \n ', undefined]) {
      expect(migrateCharacterDocs({ soul: '성격', goal: '목표', memory, episodes: { 3: '기억' } }), String(memory)).toEqual({ soul: '성격', goal: '목표', episodes: { 3: '기억' } })
    }
  })

  it('비어 있는(빈 글·공백뿐인) 00회차는 없는 것으로 보고 memory만 남긴다', () => {
    expect(migrateCharacterDocs({ soul: '', memory: '유언', episodes: { 0: '' } }).episodes).toEqual({ 0: '유언' })
    expect(migrateCharacterDocs({ soul: '', memory: '유언', episodes: { 0: '  \n' } }).episodes).toEqual({ 0: '유언' })
  })

  it('goal이 없으면 빈 글이고, 있으면 그대로이며, 이미 지금 모양이면 같은 값이다', () => {
    expect(migrateCharacterDocs({ soul: '성격', episodes: {} }).goal).toBe('')
    expect(migrateCharacterDocs({ soul: '성격', goal: '목표', episodes: {} }).goal).toBe('목표')
    const current = docs({ soul: '성격', goal: '목표', episodes: { 0: '기억', 3: '기억' } })
    expect(migrateCharacterDocs(current)).toEqual(current)
  })

  it('받은 값은 바꾸지 않고, 합친 00회차가 3,000자를 넘어도 자르지 않는다(저장 전 확인이 막는다)', () => {
    const raw = { soul: '', memory: '가'.repeat(2000), episodes: { 0: '나'.repeat(2000) } }
    const before = structuredClone(raw)
    const moved = migrateCharacterDocs(raw)
    expect(moved.episodes[0]).toBe('가'.repeat(2000) + '\n\n' + '나'.repeat(2000))
    expect(raw).toEqual(before)
    expect(characterDocIssues({ ...person('본문'), characterDocs: moved })).toEqual(['memory/00회차.md는 3,000자 이하로 줄여 주세요.'])
  })
})

describe('파일 이름으로 문서 정하기', () => {
  it('IDENTITY.md·SOUL.md·GOAL.md는 대소문자와 상관없이 알아보고, 옛 MEMORY.md는 memory(00회차에 합쳐지는 파일)로 알아본다', () => {
    expect(['IDENTITY.md', 'identity.MD', ' Soul.md ', 'GOAL.md', 'goal.md'].map(characterDocOfFile)).toEqual(['identity', 'identity', 'soul', 'goal', 'goal'])
    expect(['MEMORY.md', 'memory.md', ' Memory.MD '].map(characterDocOfFile)).toEqual(['memory', 'memory', 'memory'])
    expect(characterDocName('memory')).toBe('memory/00회차.md') // 옛 MEMORY.md가 담기는 문서
  })

  it('NN회차.md는 앞의 숫자가 회차 번호다', () => {
    expect(['00회차.md', '03회차.md', '3회차.md', '120회차.md', '007회차.MD'].map(characterDocOfFile)).toEqual([0, 3, 3, 120, 7])
  })

  it('macOS가 한글을 자모로 풀어 준 파일 이름(NFD)도 알아본다', () => {
    const decomposed = '03회차.md'.normalize('NFD')
    expect(decomposed).not.toBe('03회차.md')
    expect(characterDocOfFile(decomposed)).toBe(3)
  })

  it('그 밖의 이름은 알아보지 못한다', () => {
    for (const name of ['notes.md', 'IDENTITY.txt', 'SOUL', 'soul.md.bak', 'GOAL.txt', 'goals.md', '회차.md', '-1회차.md', '1.5회차.md', '3회차 메모.md', 'memory.markdown', '99999999999999999999회차.md', '']) {
      expect(characterDocOfFile(name), name).toBeNull()
    }
  })

  it('고른 파일을 문서에 맞추고, 알아볼 수 없는 이름과 앞선 파일과 같은 문서로 읽히는 이름은 따로 모은다', () => {
    const files = ['SOUL.md', 'notes.md', '03회차.md', 'soul.md', '3회차.md', 'IDENTITY.md', '그림.png'].map((name) => ({ name }))
    const { picked, unknown, duplicate } = matchDocFiles(files)
    expect(picked.map(({ file, key }) => [file.name, key])).toEqual([['SOUL.md', 'soul'], ['03회차.md', 3], ['IDENTITY.md', 'identity']])
    expect(picked[0].file).toBe(files[0]) // 받은 파일 그대로 돌려준다
    expect(unknown).toEqual(['notes.md', '그림.png'])
    expect(duplicate).toEqual(['soul.md', '3회차.md'])
  })

  it('옛 MEMORY.md와 00회차.md는 다른 파일로 함께 받고, MEMORY.md로 읽히는 파일이 둘이면 앞의 것만 받는다', () => {
    const { picked, duplicate } = matchDocFiles(['MEMORY.md', '00회차.md', 'memory.md', 'GOAL.md'].map((name) => ({ name })))
    expect(picked.map(({ key }) => key)).toEqual(['memory', 0, 'goal'])
    expect(duplicate).toEqual(['memory.md'])
  })
})

describe('불러온 글을 문서에 담기', () => {
  it('IDENTITY.md는 카드 본문이 되고 나머지는 문서가 되며, 줄바꿈은 \\n으로 맞춘다', () => {
    const result = importCharacterDocs(person(), [['identity', '이름: 가람\r\n나이: 스물'], ['soul', '말수가 적다\r'], [3, '스승을 잃었다']])
    expect(result).toEqual({ replaced: [], text: '이름: 가람\n나이: 스물', docs: docs({ soul: '말수가 적다\n', episodes: { 3: '스승을 잃었다' } }) })
  })

  it('이미 내용이 있는 문서가 다른 글로 바뀌면 그 문서를 알리고, 빈 문서·같은 글·안 불러온 문서는 알리지 않는다', () => {
    const row = person('옛 본문', docs({ soul: '옛 성격', goal: '그대로', episodes: { 3: '옛 기억', 4: '  ' } }))
    const result = importCharacterDocs(row, [['identity', '새 본문'], ['soul', '새 성격'], ['goal', '그대로'], [3, '새 기억'], [4, '새로 쓴 기억'], [5, '처음 쓴 기억']])
    expect(result.replaced).toEqual(['identity', 'soul', 3])
    expect(result.text).toBe('새 본문')
    expect(result.docs).toEqual(docs({ soul: '새 성격', goal: '그대로', episodes: { 3: '새 기억', 4: '새로 쓴 기억', 5: '처음 쓴 기억' } }))
    expect(row.characterDocs).toEqual(docs({ soul: '옛 성격', goal: '그대로', episodes: { 3: '옛 기억', 4: '  ' } })) // 받은 카드는 바꾸지 않는다
  })

  it('GOAL.md는 goal 문서가 되고, 이미 내용이 있는 goal이 다른 글로 바뀌면 알린다', () => {
    expect(importCharacterDocs(person('본문'), [['goal', '스승의 원수를 찾는다\r\n']])).toEqual({ replaced: [], text: '본문', docs: docs({ goal: '스승의 원수를 찾는다\n' }) })
    expect(importCharacterDocs(person('본문', docs({ goal: '옛 목표' })), [['goal', '새 목표']]).replaced).toEqual(['goal'])
  })

  it('옛 MEMORY.md는 00회차로 받고, 0회차에 이미 글이 있으면 그 앞에 빈 줄 하나로 이어 붙이며 덮어쓰지 않는다(바뀌는 문서로 알리지 않는다)', () => {
    expect(importCharacterDocs(person('본문'), [['memory', '스승의 유언\r\n']])).toEqual({ replaced: [], text: '본문', docs: docs({ episodes: { 0: '스승의 유언\n' } }) })
    const row = person('본문', docs({ soul: '성격', episodes: { 0: '프롤로그의 기억', 3: '기억' } }))
    const merged = importCharacterDocs(row, [['memory', '스승의 유언']])
    expect(merged.replaced).toEqual([])
    expect(merged.docs).toEqual(docs({ soul: '성격', episodes: { 0: '스승의 유언\n\n프롤로그의 기억', 3: '기억' } }))
    expect(row.characterDocs?.episodes[0]).toBe('프롤로그의 기억') // 받은 카드는 바꾸지 않는다
  })

  it('MEMORY.md와 00회차.md를 함께 불러오면 고른 순서와 상관없이 MEMORY.md가 00회차.md의 글 앞에 붙는다', () => {
    for (const incoming of [[['memory', '유언'], [0, '프롤로그']], [[0, '프롤로그'], ['memory', '유언']]] as const) {
      expect(importCharacterDocs(person('본문'), incoming).docs).toEqual(docs({ episodes: { 0: '유언\n\n프롤로그' } }))
    }
  })

  it('IDENTITY.md를 불러오지 않으면 본문은 그대로이고, 문서를 불러오지 않으면 문서도 그대로다', () => {
    const row = person('본문')
    expect(importCharacterDocs(row, [['soul', '성격']])).toEqual({ replaced: [], text: '본문', docs: docs({ soul: '성격' }) })
    expect(importCharacterDocs(row, [['identity', '새 본문']])).toEqual({ replaced: ['identity'], text: '새 본문', docs: undefined })
  })
})

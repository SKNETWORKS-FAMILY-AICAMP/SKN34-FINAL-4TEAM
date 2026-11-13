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
const docs = (over: Partial<CharacterDocs> = {}): CharacterDocs => ({ soul: '', memory: '', episodes: {}, ...over })

describe('인물 문서의 이름과 글', () => {
  it('파일 이름은 IDENTITY.md·SOUL.md·MEMORY.md이고 회차별 기억은 memory/ 아래 두 자리 0 채움이다', () => {
    expect((['identity', 'soul', 'memory', 0, 3, 12, 120] as const).map(characterDocName)).toEqual([
      'IDENTITY.md', 'SOUL.md', 'MEMORY.md', 'memory/00회차.md', 'memory/03회차.md', 'memory/12회차.md', 'memory/120회차.md',
    ])
  })

  it('IDENTITY.md는 카드 본문이고 나머지는 characterDocs에서 읽으며 없는 문서는 빈 글이다', () => {
    const row = person('떠돌이 검객', docs({ soul: '말수가 적다', episodes: { 3: '스승을 잃었다' } }))
    expect((['identity', 'soul', 'memory', 3, 4] as const).map((key) => characterDocText(row, key))).toEqual(['떠돌이 검객', '말수가 적다', '', '스승을 잃었다', ''])
    expect((['identity', 'soul', 'memory', 0] as const).map((key) => characterDocText(person('본문'), key))).toEqual(['본문', '', '', ''])
  })

  it('회차별 기억은 넣은 순서와 상관없이 회차 번호 오름차순으로 센다', () => {
    expect(episodeDocNumbers(person('', docs({ episodes: { 120: '', 3: '', 0: '' } })))).toEqual([0, 3, 120])
    expect(episodeDocNumbers(person())).toEqual([])
  })

  it('문서 하나를 고치거나 회차 기억을 지워도 원래 값은 그대로 두고 새 값을 준다', () => {
    const before = docs({ soul: '옛 글', episodes: { 3: '기억' } })
    expect(withCharacterDoc(undefined, 'soul', '새 글')).toEqual(docs({ soul: '새 글' })) // 문서가 없던 카드는 빈 문서에서 시작한다
    expect(withCharacterDoc(before, 'memory', '비밀')).toEqual(docs({ soul: '옛 글', memory: '비밀', episodes: { 3: '기억' } }))
    expect(withCharacterDoc(before, 0, '')).toEqual(docs({ soul: '옛 글', episodes: { 0: '', 3: '기억' } })) // 빈 회차 기억도 문서로 남는다
    expect(withoutEpisodeDoc(withCharacterDoc(before, 7, '다른 기억'), 3)).toEqual(docs({ soul: '옛 글', episodes: { 7: '다른 기억' } }))
    expect(before).toEqual(docs({ soul: '옛 글', episodes: { 3: '기억' } }))
  })
})

describe('빠진 문서 알림(정리 필요)', () => {
  it('인물 카드에서 IDENTITY.md·SOUL.md·MEMORY.md 중 비어 있는(공백뿐인 것도) 문서를 순서대로 알린다', () => {
    expect(missingCharacterDocs(person())).toEqual(['identity', 'soul', 'memory']) // 기존 인물 카드·가져온 인물 카드는 본문만 있다
    expect(missingCharacterDocs(person('본문'))).toEqual(['soul', 'memory'])
    expect(missingCharacterDocs(person('본문', docs({ soul: ' \n ', memory: '비밀' })))).toEqual(['soul'])
    expect(missingCharacterDocs(person('본문', docs({ soul: '성격', memory: '비밀' })))).toEqual([])
  })

  it('회차별 기억은 없어도 되고, 인물이 아닌 카드는 알리지 않는다', () => {
    expect(missingCharacterDocs(person('본문', docs({ soul: '성격', memory: '비밀', episodes: { 1: '' } })))).toEqual([])
    expect(missingCharacterDocs(place())).toEqual([])
    expect(missingCharacterDocs(newSetting('notes'))).toEqual([])
  })
})

describe('저장을 막는 문제', () => {
  it('문서마다 3,000자까지이고 넘은 문서를 파일 이름으로 알린다(IDENTITY.md인 카드 본문도 인물 카드에서는 문서 이름으로)', () => {
    const long = '가'.repeat(3001), full = '가'.repeat(3000)
    expect(characterDocIssues(person(full, docs({ soul: full, memory: '', episodes: { 3: full } })))).toEqual([])
    expect(characterDocIssues(person(long, docs({ soul: long, memory: long, episodes: { 3: long, 120: '짧다' } })))).toEqual([
      'IDENTITY.md는 3,000자 이하로 줄여 주세요.', 'SOUL.md는 3,000자 이하로 줄여 주세요.', 'MEMORY.md는 3,000자 이하로 줄여 주세요.', 'memory/03회차.md는 3,000자 이하로 줄여 주세요.',
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
    expect(storedCharacterDocs(person('본문', written))).toBe(written)
    expect(storedCharacterDocs(person('본문', docs({ episodes: { 3: '' } })))).toEqual(docs({ episodes: { 3: '' } })) // 빈 회차 기억도 만든 문서다
    expect(storedCharacterDocs(person('본문', docs()))).toBeUndefined()
    expect(storedCharacterDocs(person('본문'))).toBeUndefined()
    expect(storedCharacterDocs(place(written))).toBeUndefined()
  })
})

describe('파일 이름으로 문서 정하기', () => {
  it('IDENTITY.md·SOUL.md·MEMORY.md는 대소문자와 상관없이 알아본다', () => {
    expect(['IDENTITY.md', 'identity.MD', ' Soul.md ', 'MEMORY.md', 'memory.md'].map(characterDocOfFile)).toEqual(['identity', 'identity', 'soul', 'memory', 'memory'])
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
    for (const name of ['notes.md', 'IDENTITY.txt', 'SOUL', 'soul.md.bak', '회차.md', '-1회차.md', '1.5회차.md', '3회차 메모.md', 'memory.markdown', '99999999999999999999회차.md', '']) {
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
})

describe('불러온 글을 문서에 담기', () => {
  it('IDENTITY.md는 카드 본문이 되고 나머지는 문서가 되며, 줄바꿈은 \\n으로 맞춘다', () => {
    const result = importCharacterDocs(person(), [['identity', '이름: 가람\r\n나이: 스물'], ['soul', '말수가 적다\r'], [3, '스승을 잃었다']])
    expect(result).toEqual({ replaced: [], text: '이름: 가람\n나이: 스물', docs: docs({ soul: '말수가 적다\n', episodes: { 3: '스승을 잃었다' } }) })
  })

  it('이미 내용이 있는 문서가 다른 글로 바뀌면 그 문서를 알리고, 빈 문서·같은 글·안 불러온 문서는 알리지 않는다', () => {
    const row = person('옛 본문', docs({ soul: '옛 성격', memory: '그대로', episodes: { 3: '옛 기억', 4: '  ' } }))
    const result = importCharacterDocs(row, [['identity', '새 본문'], ['soul', '새 성격'], ['memory', '그대로'], [3, '새 기억'], [4, '새로 쓴 기억'], [5, '처음 쓴 기억']])
    expect(result.replaced).toEqual(['identity', 'soul', 3])
    expect(result.text).toBe('새 본문')
    expect(result.docs).toEqual(docs({ soul: '새 성격', memory: '그대로', episodes: { 3: '새 기억', 4: '새로 쓴 기억', 5: '처음 쓴 기억' } }))
    expect(row.characterDocs).toEqual(docs({ soul: '옛 성격', memory: '그대로', episodes: { 3: '옛 기억', 4: '  ' } })) // 받은 카드는 바꾸지 않는다
  })

  it('IDENTITY.md를 불러오지 않으면 본문은 그대로이고, 문서를 불러오지 않으면 문서도 그대로다', () => {
    const row = person('본문')
    expect(importCharacterDocs(row, [['soul', '성격']])).toEqual({ replaced: [], text: '본문', docs: docs({ soul: '성격' }) })
    expect(importCharacterDocs(row, [['identity', '새 본문']])).toEqual({ replaced: ['identity'], text: '새 본문', docs: undefined })
  })
})

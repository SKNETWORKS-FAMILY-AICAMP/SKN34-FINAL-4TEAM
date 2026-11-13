import { cardTypeOf } from './studioCards'
import type { CharacterDocs, StudioSetting } from './studioWorld'

/*
 * 인물 문서: 인물 카드는 IDENTITY.md(카드 본문 `item.text`) · SOUL.md · MEMORY.md · memory/NN회차.md 네 종류로 쓴다.
 * 본문이 아닌 문서는 `StudioSetting.characterDocs`에 있고 작가용이다(공개 세계관·독자 설정 위키에는 본문만 나간다). 인물이 아닌 카드에는 쓰지 않는다.
 */

/** 문서 하나: 고정 문서 셋, 또는 회차별 기억의 회차 번호. */
export type CharacterDocKey = 'identity' | 'soul' | 'memory' | number

const NAMES = { identity: 'IDENTITY.md', soul: 'SOUL.md', memory: 'MEMORY.md' } as const
/** 문서 하나의 글자 수 한도(카드 본문과 같다). */
export const CHARACTER_DOC_MAX = 3000
const EPISODE_DOC_ERROR = '회차 기억의 회차 번호는 0 이상의 정수로 입력해 주세요.'

const isCharacter = (setting: StudioSetting) => cardTypeOf(setting.item) === 'character'

/** 회차 번호로 쓸 수 있는 수: 0 이상의 정수. */
const isEpisodeNumber = (n: number) => Number.isSafeInteger(n) && n >= 0
/** `episodes`의 키로 쓸 수 있는 글자: 0 이상의 정수를 군더더기 없이 쓴 것(`03`·`1.5`·`-1`은 아니다). */
export const isEpisodeKey = (key: string) => /^(0|[1-9]\d*)$/.test(key) && isEpisodeNumber(Number(key))

/** 회차별 기억의 파일 이름(`memory/` 아래). 회차 번호를 두 자리로 0을 채운다(세 자리부터는 그대로). */
export const episodeDocFile = (episode: number) => `${String(episode).padStart(2, '0')}회차.md`
/** 문서의 파일 이름. 회차별 기억은 `memory/` 아래다. */
export const characterDocName = (key: CharacterDocKey) => (typeof key === 'number' ? `memory/${episodeDocFile(key)}` : NAMES[key])

/** 문서의 글. IDENTITY.md는 카드 본문이고 없는 문서는 빈 글이다. */
export function characterDocText(setting: StudioSetting, key: CharacterDocKey): string {
  if (key === 'identity') return setting.item.text
  const docs = setting.characterDocs
  return (typeof key === 'number' ? docs?.episodes[key] : docs?.[key]) ?? ''
}

/** 회차별 기억이 있는 회차 번호(오름차순). */
export const episodeDocNumbers = (setting: StudioSetting) => Object.keys(setting.characterDocs?.episodes ?? {}).map(Number).sort((a, b) => a - b)

/** 본문이 아닌 문서 하나의 글을 바꾼 문서. 문서가 없던 카드는 빈 문서에서 시작하고, 없던 회차는 새로 생긴다. */
export function withCharacterDoc(docs: CharacterDocs | undefined, key: Exclude<CharacterDocKey, 'identity'>, text: string): CharacterDocs {
  const base = docs ?? { soul: '', memory: '', episodes: {} }
  return typeof key === 'number' ? { ...base, episodes: { ...base.episodes, [key]: text } } : { ...base, [key]: text }
}

/** 회차별 기억 하나를 지운 문서. */
export function withoutEpisodeDoc(docs: CharacterDocs, episode: number): CharacterDocs {
  const { [episode]: _, ...episodes } = docs.episodes
  return { ...docs, episodes }
}

/**
 * 인물 카드에서 비어 있는 문서(IDENTITY·SOUL·MEMORY 순, 공백뿐이면 빈 것). 인물이 아니면 없다. '정리 필요'로 알리기만 하고 이것으로 저장·확정을 막지 않는다
 * (본문인 IDENTITY.md가 빈 카드의 확정은 기존 규칙 `worldSealIssues`가 따로 막는다: 서버가 확정 버전의 모든 카드에 본문을 요구한다).
 */
export const missingCharacterDocs = (setting: StudioSetting) =>
  isCharacter(setting) ? (['identity', 'soul', 'memory'] as const).filter((key) => !characterDocText(setting, key).trim()) : []

/**
 * 저장을 막는 문제(인물 카드): 0 이상의 정수가 아닌 회차 번호와 3,000자를 넘는 문서(카드 본문인 IDENTITY.md 포함).
 * 저장 전 확인(`worldWritingIssues`)과 저장 검증(`WorldStudioUseCase.save`)이 이 문구를 그대로 쓴다. 인물이 아닌 카드의 본문 길이는 기존 카드 검증이 본다.
 */
export function characterDocIssues(setting: StudioSetting): string[] {
  if (!isCharacter(setting)) return []
  const episodes = Object.keys(setting.characterDocs?.episodes ?? {})
  const keys: CharacterDocKey[] = ['identity', 'soul', 'memory', ...episodes.filter(isEpisodeKey).map(Number)]
  return [
    ...(episodes.every(isEpisodeKey) ? [] : [EPISODE_DOC_ERROR]),
    ...keys.filter((key) => characterDocText(setting, key).length > CHARACTER_DOC_MAX).map((key) => `${characterDocName(key)}는 3,000자 이하로 줄여 주세요.`),
  ]
}

/** 문서가 하나라도 있는지: 내용이 있거나 회차별 기억을 만들었다. */
export const hasCharacterDocs = (docs?: CharacterDocs) => !!docs && !!(docs.soul || docs.memory || Object.keys(docs.episodes).length)

/** 저장소가 보관하는 문서: 인물 카드에 문서가 하나라도 있을 때만 있다. 전부 비었거나 인물이 아닌 카드의 문서는 저장하지 않는다. */
export const storedCharacterDocs = (setting: StudioSetting) => (isCharacter(setting) && hasCharacterDocs(setting.characterDocs) ? setting.characterDocs : undefined)

/**
 * 불러올 파일의 이름으로 문서를 정한다: IDENTITY.md·SOUL.md·MEMORY.md(대소문자 무시), NN회차.md(앞의 숫자가 회차 번호). 알아볼 수 없으면 null이다.
 * macOS는 한글 파일 이름을 자모로 풀어(NFD) 주므로 먼저 합친다.
 */
export function characterDocOfFile(fileName: string): CharacterDocKey | null {
  const name = fileName.normalize('NFC').trim().toLowerCase()
  const fixed = (['identity', 'soul', 'memory'] as const).find((key) => NAMES[key].toLowerCase() === name)
  if (fixed) return fixed
  const episode = Number(/^(\d+)회차\.md$/.exec(name)?.[1] ?? NaN)
  return isEpisodeNumber(episode) ? episode : null
}

/** 고른 파일을 문서에 맞춘다. 알아볼 수 없는 이름(`unknown`)과 앞선 파일과 같은 문서로 읽히는 이름(`duplicate`)은 가져오지 않는다. */
export function matchDocFiles<T extends { name: string }>(files: readonly T[]) {
  const picked: { file: T; key: CharacterDocKey }[] = [], unknown: string[] = [], duplicate: string[] = []
  for (const file of files) {
    const key = characterDocOfFile(file.name)
    if (key === null) unknown.push(file.name)
    else if (picked.some((other) => other.key === key)) duplicate.push(file.name)
    else picked.push({ file, key })
  }
  return { picked, unknown, duplicate }
}

/**
 * 불러온 글을 문서에 담는다(줄바꿈은 `\n`으로 맞춘다): IDENTITY.md는 카드 본문(`text`), 나머지는 문서(`docs`)가 된다.
 * `replaced`는 이미 내용이 있는데 다른 글로 바뀌는 문서다(덮어쓰기 전에 확인을 받을 대상). 받은 카드는 바꾸지 않는다.
 */
export function importCharacterDocs(setting: StudioSetting, incoming: readonly (readonly [CharacterDocKey, string])[]) {
  let text = setting.item.text, docs = setting.characterDocs
  const replaced: CharacterDocKey[] = []
  for (const [key, raw] of incoming) {
    const next = raw.replace(/\r\n?/g, '\n'), before = characterDocText(setting, key)
    if (before.trim() && before !== next) replaced.push(key)
    if (key === 'identity') text = next
    else docs = withCharacterDoc(docs, key, next)
  }
  return { replaced, text, docs }
}

import { useLayoutEffect, useRef, useState } from 'react'

import {
  CHARACTER_DOC_MAX,
  characterDocName,
  characterDocText,
  type CharacterDocKey,
  episodeDocNumbers,
  hasCharacterDocs,
  importCharacterDocs,
  matchDocFiles,
  missingCharacterDocs,
  withCharacterDoc,
  withoutEpisodeDoc,
} from '../../../../domain/entities/characterDocs'
import { cardTypeOf } from '../../../../domain/entities/studioCards'
import type { StudioSetting } from '../../../../domain/entities/studioWorld'
import type { useWorldStudioViewModel } from './useWorldStudioViewModel'

type Studio = Pick<ReturnType<typeof useWorldStudioViewModel>, 'editing' | 'update' | 'busy'>

/**
 * 편집 화면에서 보고 있는 카드의 본문 편집 상태. 인물 카드는 문서 네 종류(IDENTITY.md = 카드 본문 · SOUL.md · MEMORY.md · memory/NN회차.md) 가운데 고른 문서 하나를 편집하고,
 * 인물이 아닌 카드는 늘 본문 하나다. 문서 규칙(이름·빠진 문서·파일 이름 해석·덮어쓰기 대상)은 `domain/entities/characterDocs`의 순수 함수가 정하고, 모두 초안 변경이라 세계관 저장을 거쳐 반영된다.
 * - 고른 문서는 카드마다 따로이고(다른 카드를 열면 IDENTITY.md부터), 고른 회차별 기억이 지워지면 IDENTITY.md로 돌아온다.
 * - 편집기는 처음 값만 읽으므로 `editorKey`가 바뀌면 다시 만든다: 카드·문서가 바뀔 때와 파일을 불러와 글이 밖에서 바뀔 때다.
 * - 파일을 읽는 동안 초안이 바뀔 수 있어, 다 읽은 뒤에는 그때의 초안(`latest`)에서 카드를 다시 찾아 덮어쓸 문서를 가리고 적용한다. 편집 화면을 떠났으면 적용하지 않는다.
 */
export function useCharacterDocs(studio: Studio, setting: StudioSetting) {
  const cardId = setting.item.id
  const person = cardTypeOf(setting.item) === 'character'
  const [picked, setPicked] = useState<{ card: string; doc: CharacterDocKey }>()
  const [revision, setRevision] = useState(0)
  const [notice, setNotice] = useState<{ card: string; lines: string[] }>()
  // 커밋과 함께 바로 바꾼다(그리기 뒤로 미루면 그사이에 끝난 파일 읽기가 한 번 전의 초안을 본다).
  const latest = useRef<Studio | null>(studio)
  useLayoutEffect(() => {
    latest.current = studio
    return () => { latest.current = null }
  })
  const episodes = episodeDocNumbers(setting)
  const doc: CharacterDocKey = person && picked?.card === cardId && (typeof picked.doc !== 'number' || episodes.includes(picked.doc)) ? picked.doc : 'identity'
  const missing: CharacterDocKey[] = missingCharacterDocs(setting)
  const write = (key: CharacterDocKey, text: string) => {
    if (key === 'identity') studio.update(cardId, { text })
    else studio.update(cardId, {}, { characterDocs: withCharacterDoc(setting.characterDocs, key, text) })
  }
  return {
    /** 인물 카드인지. 아니면 문서 목록 없이 본문 하나만 편집한다. */
    person,
    /** 인물이 아닌 카드에 남아 있는 문서가 있는지(유형을 인물에서 바꾼 카드). 이대로 저장하면 문서가 사라진다고 알린다. */
    orphaned: !person && hasCharacterDocs(setting.characterDocs),
    /** 편집 중인 문서와 그 파일 이름·글 */
    doc,
    name: characterDocName(doc),
    text: characterDocText(setting, doc),
    editorKey: `${cardId}:${person ? doc : ''}:${revision}`,
    /** 회차별 기억이 있는 회차 번호(오름차순) */
    episodes,
    /** 문서 버튼에 붙일 표시: 3,000자를 넘었거나(저장을 막는다) 비어 있다(IDENTITY·SOUL·MEMORY, 알리기만 한다). */
    flagOf: (key: CharacterDocKey): 'over' | 'missing' | undefined => (characterDocText(setting, key).length > CHARACTER_DOC_MAX ? 'over' : missing.includes(key) ? 'missing' : undefined),
    select: (key: CharacterDocKey) => setPicked({ card: cardId, doc: key }),
    write: (text: string) => write(doc, text),
    /** 그 회차의 기억을 고른다. 없으면 빈 문서로 만든다(있던 글은 그대로 둔다). */
    addEpisode: (episode: number) => {
      if (!episodes.includes(episode)) write(episode, '')
      setPicked({ card: cardId, doc: episode })
    },
    /** 고른 회차별 기억을 확인을 받고 지운다. 지웠을 때만 true다. */
    removeEpisode: () => {
      if (typeof doc !== 'number' || !setting.characterDocs) return false
      if (!window.confirm(`${characterDocName(doc)}를 삭제할까요? 세계관을 저장하면 되돌릴 수 없어요.`)) return false
      studio.update(cardId, {}, { characterDocs: withoutEpisodeDoc(setting.characterDocs, doc) })
      return true
    },
    /** 고른 `.md` 파일을 파일 이름으로 문서에 맞춰 불러온다. 결과(불러온 문서·가져오지 않은 파일·취소·실패)는 `notice`에 남는다. */
    importFiles: async (files: File[]) => {
      const { picked: matched, unknown, duplicate } = matchDocFiles(files)
      const skipped = [
        ...(unknown.length ? [`알아볼 수 없어 가져오지 않은 파일: ${unknown.join(', ')}. 파일 이름은 IDENTITY.md·SOUL.md·MEMORY.md·NN회차.md여야 해요.`] : []),
        ...(duplicate.length ? [`같은 문서의 파일이 둘 이상이라 가져오지 않은 파일: ${duplicate.join(', ')}.`] : []),
      ]
      const say = (...lines: string[]) => setNotice({ card: cardId, lines: [...lines, ...skipped] })
      if (!matched.length) return say()
      let read: [CharacterDocKey, string][]
      try {
        read = await Promise.all(matched.map(async ({ file, key }): Promise<[CharacterDocKey, string]> => [key, await file.text()]))
      } catch {
        return say('파일을 읽지 못했어요. 다시 골라 주세요.')
      }
      const now = latest.current
      const row = now?.editing?.settings.find((other) => other.item.id === cardId)
      if (!now || !row) return
      if (now.busy) return say('저장하는 중이라 불러오지 못했어요. 저장이 끝난 뒤 다시 불러와 주세요.')
      const { replaced, text, docs } = importCharacterDocs(row, read)
      if (replaced.length && !window.confirm(`이미 내용이 있는 문서를 불러온 파일로 바꿔요: ${replaced.map(characterDocName).join(', ')}\n지금 내용은 사라져요. 바꿀까요?`)) {
        return say('불러오기를 취소했어요. 문서는 그대로예요.')
      }
      now.update(cardId, { text }, docs && { characterDocs: docs })
      setRevision((n) => n + 1)
      say(`문서 ${read.length}개를 불러왔어요: ${read.map(([key]) => characterDocName(key)).join(', ')}. 저장해야 반영돼요.`)
    },
    /** 방금 한 파일 불러오기의 결과 문장들(이 카드에서 한 것만) */
    notice: notice?.card === cardId ? notice.lines : [],
  }
}

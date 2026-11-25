import { useEffect, useRef, useState } from 'react'

import type { DocFill, DocFillTarget } from '../../../../domain/entities/characterDocs'
import type { StudioWorld } from '../../../../domain/entities/studioWorld'
import type { WorldReviewUseCase } from '../../../../domain/usecases/WorldReviewUseCase'

/** 마지막으로 받은 제안(한 카드) 하나. `settled`는 작가가 이미 처리한(반영했거나 반영하지 않기로 한) 문서다. */
type Result = { world: string; card: string; fill: DocFill; settled: DocFillTarget[] }
type Failure = { world: string; card: string; message: string }

type Inputs = {
  /** `null`이면 서버 기능이 없는 데모다. */
  useCase: WorldReviewUseCase | null
  saved: StudioWorld | null
  /** 저장하지 않은 변경(초안·관계 입력)이 있는지. 서버는 저장한 카드와 원고를 읽는다. */
  unsaved: boolean
  /** 저장·확정 같은 다른 요청이 진행 중인지 */
  busy: boolean
}

/**
 * 인물 문서 '원고로 채우기 제안'(#847, [계약](../../../../../../docs/design/world-review-contract.md)): OpenAI 전송 동의 → 요청 → 제안(원고 문장 줄과 회차). 카드 한 장의 제안 하나만 화면 상태로 갖고
 * 저장하지 않는다. 제안이 도착한 것은 저장도 반영도 아니다: 반영은 `useCharacterDocs`가 작가의 `초안에 반영` 뒤에 편집 초안의 그 문서만 바꾼다(DEC-36).
 * 서버가 저장한 카드와 연결된 소설의 저장 원고를 읽으므로 소설이 연결되지 않았거나 저장하지 않은 변경이 있으면 이유와 함께 잠근다(데모는 서버 기능이 없어 늘 잠긴다).
 * 세계관이 바뀌거나 화면을 벗어나면 진행 중인 요청을 취소하고 그 세계관의 실패·제안을 지운다(`useWorldReview`와 같은 이유: 화면은 `key` 없이 세계관 id만 바뀐다).
 */
export function useDocFill({ useCase, saved, unsaved, busy }: Inputs) {
  const worldId = saved?.id
  const [consent, setConsent] = useState(false)
  const [running, setRunning] = useState<string | null>(null) // 요청 중인 카드 id
  const [failure, setFailure] = useState<Failure | null>(null)
  const [result, setResult] = useState<Result | null>(null)
  const controller = useRef<AbortController | null>(null)
  useEffect(() => () => {
    controller.current?.abort()
    controller.current = null
    setRunning(null)
    setFailure(null)
    setResult(null)
  }, [worldId])
  const lock = !useCase ? '데모에서는 지원하지 않아요.'
    : !saved ? '세계관을 불러온 뒤 요청할 수 있어요.'
    : !saved.linkedWorkId ? '연결된 소설이 없어요. 작품 관리에서 소설을 연결하면 원고로 채울 수 있어요.'
    : unsaved ? '저장하지 않은 변경이 있어요. AI는 저장한 카드와 원고를 읽으니 먼저 세계관을 저장하세요.'
    : busy || running ? '다른 요청이 진행 중이에요. 끝난 뒤 요청해 주세요.' : ''
  const mine = (card: string) => (result && result.world === worldId && result.card === card ? result : null)
  return {
    /** OpenAI 전송·비용 동의(요청마다 다시 받지 않고 이 화면에 머무는 동안 유지한다) */
    consent,
    setConsent,
    /** 요청을 막는 이유(요청할 수 있으면 빈 글) */
    lock,
    /** 그 카드의 요청이 진행 중인지 */
    running: (card: string) => running === card,
    /** 그 카드의 마지막 요청의 실패 문구(서버가 준 그대로) */
    error: (card: string) => (failure && failure.world === worldId && failure.card === card ? failure.message : ''),
    /** 그 카드에서 `target` 문서에 온 제안: 요청 전이거나 이미 처리했으면 null, 받았으면 줄(근거가 없으면 빈 목록)과 서버가 원고에서 확인하지 못해 뺀 줄 수다. */
    proposal: (card: string, target: DocFillTarget) => {
      const found = mine(card)
      return found && !found.settled.includes(target) ? { lines: found.fill.lines.filter((line) => line.target === target), skipped: found.fill.skipped } : null
    },
    /** 카드의 제안을 요청한다. 받은 제안은 그 카드의 이전 제안을 대신하고, 요청할 수 없으면(잠김·이미 요청 중) 아무것도 하지 않는다. */
    request: async (card: string) => {
      if (!useCase || !saved || lock || controller.current) return
      const run = new AbortController()
      controller.current = run
      const { id } = saved
      setRunning(card)
      setFailure(null)
      setResult(null)
      try {
        const fill = await useCase.suggestDocs(id, card, consent, run.signal)
        if (!run.signal.aborted) setResult({ world: id, card, fill, settled: [] })
      } catch (e) {
        if (!run.signal.aborted) setFailure({ world: id, card, message: e instanceof Error ? e.message : '원고로 채우기 제안을 요청하지 못했어요.' })
      } finally {
        if (controller.current === run) {
          controller.current = null
          setRunning(null)
        }
      }
    },
    /** `target` 문서의 제안을 처리했다고 표시한다(반영했거나 반영하지 않기로 했다). 그 문서의 줄은 더 보이지 않는다. */
    settle: (card: string, target: DocFillTarget) => setResult((now) => (now && now.world === worldId && now.card === card ? { ...now, settled: [...now.settled, target] } : now)),
  }
}

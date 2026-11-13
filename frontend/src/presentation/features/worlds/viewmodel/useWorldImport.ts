import { useRef, useState } from 'react'

import { appContainer } from '../../../../app/appContainer'
import type { PublicWorld } from '../../../../domain/entities/publicWorld'
import type { StudioWorld } from '../../../../domain/entities/studioWorld'
import type { WorldStudioUseCase } from '../../../../domain/usecases/WorldStudioUseCase'
import { appendImported, importCards } from '../../../shared/importCards'
import { useAsyncData } from '../../../shared/useAsyncData'

export type ImportTarget = { id: string; name: string }
/** 바로 추가의 진행·결과. `count`는 더하는(더한) 설정 수이고 실패의 `message`는 서버·검증이 알린 사유 그대로다. */
export type ImportOutcome = { status: 'saving' | 'done'; target: ImportTarget; count: number } | { status: 'failed'; target: ImportTarget; message: string }

/** 한 번의 시도: 누구에게 어떤 설정을 보내려 했는지와, 저장을 보냈다면 그 입력(새 카드를 붙인 세계관)과 새 카드 id */
type Attempt = { target: ImportTarget; cardIds: string[]; sent?: { world: StudioWorld; addedIds: string[] } }

const sameIds = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((id) => b.includes(id))

/**
 * 가져갈 대상: 내 세계관 중 원본 세계관 자신을 뺀 것. 가져오기 메뉴가 열려 있을 때만 쓰이므로 그때 읽고 닫았다 열면 다시 읽는다.
 * `targets`가 없으면 아직 읽지 못한 것이다(`isLoading`·`isError`).
 */
export function useImportTargets(sourceWorldId: string, useCase: Pick<WorldStudioUseCase, 'list'> = appContainer.resolve('worldStudioUseCase')) {
  const { data, isLoading, isError, retry } = useAsyncData((signal) => useCase.list(signal), [useCase])
  return { targets: data?.filter((world) => world.id !== sourceWorldId), isLoading, isError, retry }
}

/**
 * 공개 세계관의 공개 설정을 내 세계관 초안에 바로 더한다(DEC-46, 서버 API 없이): 대상의 최신 초안을 읽어 고른 설정을 새 카드로 끝에 붙이고 그대로 저장한다.
 * 복사 규칙은 세계관 작업실의 가져오기와 같은 공용 규칙이다(`shared/importCards`의 `importCards`·`appendImported`: 새 id·비공개·독자 공개 회차 없음·출처 기록·활성 카드 1,000개 한도). 관계는 함께 오지 않는다.
 * 추가하는 동안의 다시 누르기는 무시하고, 실패는 서버·검증의 사유 그대로 `outcome`에 남긴다(성공으로 바꾸지 않는다).
 *
 * 같은 대상·같은 설정을 다시 보낼 때(`retry`)는 대상을 다시 읽어 맞춘다: 앞선 요청이 응답만 못 받고 실제로는 반영됐으면 다시 보내지 않고,
 * 초안이 그대로면 보냈던 입력을 그대로 다시 보내며(저장소는 결과를 모르는 요청 뒤에 같은 입력만 받는다), 초안이 바뀌었으면 최신 초안에 새로 붙인다.
 * ponytail: 대상 세계관을 다른 탭에서 편집 중이면 그쪽의 다음 저장이 충돌한다. 같은 카드를 또 가져오면 중복으로 들어간다(막지 않는다).
 */
export function useWorldImport(source: PublicWorld, useCase: Pick<WorldStudioUseCase, 'read' | 'save'> = appContainer.resolve('worldStudioUseCase')) {
  const [outcome, setOutcome] = useState<ImportOutcome>()
  const busy = useRef(false)
  const last = useRef<Attempt>(undefined)

  const add = async (target: ImportTarget, cardIds: readonly string[]) => {
    if (busy.current) return false
    busy.current = true
    const before = last.current
    // 같은 대상·같은 설정을 다시 보내는 것이면 앞선 시도가 보낸 입력을 이어받는다.
    const attempt: Attempt = { target, cardIds: [...cardIds], sent: before && before.target.id === target.id && sameIds(before.cardIds, cardIds) ? before.sent : undefined }
    last.current = attempt
    setOutcome({ status: 'saving', target, count: cardIds.length })
    try {
      const imported = importCards(source, new Set(cardIds), false)
      if (!imported.cards.length) throw new Error('가져올 설정을 찾을 수 없어요. 화면을 새로 고친 뒤 다시 골라 주세요.')
      const current = await useCase.read(target.id)
      let sent = attempt.sent
      // 앞선 요청이 이미 반영됐으면(새 카드가 초안에 있으면) 다시 보내지 않는다.
      if (!sent?.addedIds.every((id) => current.settings.some((setting) => setting.item.id === id))) {
        if (!sent || sent.world.version !== current.version) {
          sent = { world: { ...current, settings: appendImported(current.settings, imported) }, addedIds: imported.cards.map((card) => card.item.id) }
        }
        attempt.sent = sent
        await useCase.save(sent.world)
      }
      last.current = undefined
      setOutcome({ status: 'done', target, count: sent.addedIds.length })
      return true
    } catch (error) {
      setOutcome({ status: 'failed', target, message: error instanceof Error ? error.message : '설정을 추가하지 못했어요.' })
      return false
    } finally {
      busy.current = false
    }
  }

  return {
    outcome, saving: outcome?.status === 'saving', add,
    /** 실패한 마지막 시도를 같은 대상·같은 설정으로 다시 보낸다. */
    retry: () => (last.current ? add(last.current.target, last.current.cardIds) : Promise.resolve(false)),
  }
}

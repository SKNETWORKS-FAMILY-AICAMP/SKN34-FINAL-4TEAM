import { useEffect, useRef, useState } from 'react'
import { appContainer } from '../../../../app/appContainer'
import type { History, Work, WorkRegistration, WorkTaxonomy } from '../../../../domain/entities/content'
import type { EpisodeUseCase } from '../../../../domain/usecases/EpisodeUseCase'
import { type MediaUseCase, validateMediaFile } from '../../../../domain/usecases/MediaUseCase'

/**
 * `/content` 작품 관리 화면: 작품 생성·작품 정보(제목·소개·장르·해시태그)·표지·분기 정책·분기 정보(공개 중단·삭제)·분기 만들기·이력 조회.
 * 작품 목록과 선택은 서재(`/lib?tab=write`)가 맡고, 이 화면은 주소의 `?work=<id>`(workId)가 가리키는 내 작품 하나를 관리하거나 쿼리가 없으면 새 작품을 만든다.
 * 열린 작품(active)은 내 작품 목록에서 workId로 도출하므로 `install`이 목록을 갱신하면 함께 바뀌고, 작품 revision도 항상 서버 응답 값이다.
 * 원고 작성·AI 이어쓰기·회차 공개는 집필실(`/studio/{id}`) 몫이다.
 */
export function useEpisodeViewModel(
  workId: string | null,
  useCase: EpisodeUseCase = appContainer.resolve('episodeUseCase'),
  media: Pick<MediaUseCase, 'upload'> = appContainer.resolve('mediaUseCase'),
) {
  const [works, setWorks] = useState<Work[]>([])
  const [loaded, setLoaded] = useState<{ id: string; history: History } | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [ready, setReady] = useState(false)
  /** 내 작품 목록을 실제로 읽었는지. 읽기에 실패하면(인증 만료 등) 새 작품을 보내지 못하게 한다. */
  const [listed, setListed] = useState(false)
  const [coverRevision, setCoverRevision] = useState(0)
  const alive = useRef(true)
  const inFlight = useRef(false)
  const request = useRef<AbortController | null>(null)
  const active = works.find((w) => w.id === workId) ?? null
  /** 이력은 불러온 작품에서만 보인다(다른 작품으로 바뀌면 사라진다). 이 화면의 저장은 이력 내용을 바꾸지 않으므로 저장해도 남고, 탭을 다시 누르면 새로 읽는다. */
  const history = loaded && loaded.id === active?.id ? loaded.history : null
  const install = (w: Work) => setWorks((list) => [w, ...list.filter((x) => x.id !== w.id)])
  /** 서버가 revision을 올리는 변경(공개 중단 등) 뒤 목록과 열린 작품을 다시 읽는다. */
  const refresh = async () => {
    const list = await useCase.list()
    setWorks(list)
    setListed(true)
    const w = list.find((x) => x.id === active?.id)
    if (w) install(w)
  }
  useEffect(() => {
    alive.current = true
    const controller = new AbortController()
    useCase.list(controller.signal).then((list) => {
      if (!controller.signal.aborted) {
        setWorks(list)
        setListed(true)
        setReady(true)
      }
    }).catch((e: unknown) => {
      if (!controller.signal.aborted) {
        setError(
          e instanceof Error
            ? e.message
            : 'Core 서버에 연결하지 못했어요. 서버를 실행한 뒤 새로고침해 주세요.',
        )
        setReady(true)
      }
    })
    return () => {
      alive.current = false
      controller.abort()
      request.current?.abort()
    }
  }, [useCase])
  const run = async (fn: () => Promise<void>) => {
    if (inFlight.current) return false
    inFlight.current = true
    setBusy(true)
    setError('')
    setNotice('')
    try {
      await fn()
      return alive.current
    } catch (e) {
      if (alive.current) {
        setError(e instanceof Error ? e.message : '요청에 실패했어요. 다시 시도해 주세요.')
      }
      return false
    } finally {
      inFlight.current = false
      if (alive.current) setBusy(false)
    }
  }
  return {
    works,
    active,
    history,
    busy,
    error,
    notice,
    ready,
    listed,
    coverRevision,
    /** 새 작품의 id를 돌려준다. 표지 저장만 실패해도 작품은 만들어졌으므로 id를 돌려주고(오류는 알림으로 남김), 화면을 떠났거나 생성 자체가 실패하면 null이다. */
    create: async (title: string, summary: string, cover?: File, registration?: WorkRegistration) => {
      let id = null as string | null
      await run(async () => {
        if (cover) validateMediaFile(cover, true)
        const controller = new AbortController()
        request.current = controller
        const work = await useCase.create(title, summary, controller.signal, registration)
        if (controller.signal.aborted) return
        install(work)
        id = work.id
        if (cover) {
          try {
            await media.upload(
              { kind: 'cover', workId: work.id },
              cover,
              undefined,
              controller.signal,
            )
          } catch (e) {
            if (controller.signal.aborted) return
            throw new Error(
              `작품은 생성됐지만 표지 저장에 실패했어요. 작품을 다시 만들지 말고 표지 편집에서 재시도해 주세요. ${
                e instanceof Error ? e.message : ''
              }`,
            )
          }
          if (controller.signal.aborted) return
          setCoverRevision((v) => v + 1)
        }
        setNotice(
          cover
            ? '비공개 작품과 표지를 저장했어요.'
            : '비공개 작품을 만들었어요. 첫 회차를 작성해 보세요.',
        )
      })
      return alive.current ? id : null
    },
    reload: () =>
      run(async () => {
        await refresh()
        setNotice('최신 원고를 불러왔어요.')
      }),
    loadHistory: () =>
      run(async () => {
        if (active) setLoaded({ id: active.id, history: await useCase.history(active.id) })
      }),
    /** 작품 제목·소개와 바뀐 장르·해시태그 수정. 서버가 돌려준 작품(새 revision 포함)으로 화면을 바꾼다. */
    updateWork: (title: string, summary: string, taxonomy?: WorkTaxonomy) =>
      run(async () => {
        if (!active) return
        install(await useCase.updateWork(active.id, title, summary, active.revision, undefined, taxonomy))
        setNotice('작품 정보를 저장했어요.')
      }),
    policy: (allowFork: boolean, allowForkPublication: boolean) =>
      run(async () => {
        if (!active) return
        install(await useCase.policy(active.id, active.revision, allowFork, allowForkPublication))
        setNotice('분기 생성·공개 허용 설정을 저장했어요.')
      }),
    /** 새 분기 작품의 id를 돌려준다(실패하거나 화면을 떠났으면 null). */
    fork: async (episode: number, title: string, direction: string) => {
      let id = null as string | null
      await run(async () => {
        if (!active) return
        const created = await useCase.fork(active.id, episode, title, direction)
        install(created)
        id = created.id
        setNotice('선택한 회차에서 비공개 분기 작품을 만들었어요.')
      })
      return alive.current ? id : null
    },
    /** 분기 작품의 공개를 중단한다. 서버가 revision을 올리므로 끝나면 작품을 다시 읽는다. 발행된 회차와 원고는 남는다. */
    stopFork: () => {
      if (!active?.source || !window.confirm('포크 작품의 공개를 중단할까요? 발행된 회차와 원고는 보존돼요. 대기 중인 예약 발행은 취소되고, 원작이 공개를 허용하지 않으면 다시 공개할 수 없어요.')) return Promise.resolve(false)
      return run(async () => {
        await useCase.stopForkPublication(active.id)
        await refresh()
        setNotice('포크 공개를 중단했어요.')
      })
    },
    /** 분기 작품을 삭제한다. 성공하면 true이며, 열려 있던 작품이 사라지므로 화면이 서재로 이동한다. */
    deleteFork: () => {
      if (!active?.source || !window.confirm(`「${active.title}」 포크를 삭제할까요? 서재와 공개 화면에서 숨겨지고 되돌릴 수 없어요. 같은 원작에서 포크를 다시 만들 수 없어요.`)) return Promise.resolve(false)
      return run(async () => {
        await useCase.deleteWork(active.id)
        setNotice('포크를 삭제했어요.')
      })
    },
  }
}

import { appContainer } from '../../../../app/appContainer'
import { useAppSelector } from '../../../../app/store'
import type { ReadingUseCase } from '../../../../domain/usecases/ReadingUseCase'
import { useScreenId } from '../../../shared/screenIds'
import { useAsyncData } from '../../../shared/useAsyncData'
import { worldCardWiki } from './worldCardWiki'

/**
 * U45 설정 위키: 작품 상세와 같은 조회로 작품을 받고, 서버 작품에 연결된 세계관(DEC-46)이 있으면 그 세계관의 독자 공개 카드로 위키를 채운다
 * (없으면 기존 작품 설정 위키 그대로). [upto]가 있으면 그 회차(회차 화면에서 온 경우), 없으면 최신 공개 회차 기준이다.
 * 연결된 세계관의 카드를 읽지 못하면 빈 위키로 바꾸지 않고 isError로 알린다.
 */
export function useWorkWikiViewModel(id: string, upto?: number, readingUseCase: ReadingUseCase = appContainer.resolve('readingUseCase')) {
  const role = useAppSelector((s) => s.session.role)
  // ponytail: 연결된 세계관이 있어도 getWork가 기존 작품 설정을 먼저 읽는다(요청 한 번이 남는다). 작품 응답이 연결 여부를 알려 주면 그때 건너뛴다.
  const { data, isError, retry } = useAsyncData(async () => {
    const loaded = await readingUseCase.getWork(id, role, upto)
    return { loaded, world: loaded && await readingUseCase.linkedWorldCards(loaded.work, upto) }
  }, [readingUseCase, id, role, upto])
  const { loaded, world } = data ?? {}
  useScreenId(loaded ? 'U45' : null)
  return {
    /** undefined: 불러오는 중, null: 없거나 볼 수 없는 작품 */
    work: data && (loaded ? (world ? { ...loaded.work, wiki: worldCardWiki(world) } : loaded.work) : null),
    /** 실제로 적용된 기준 회차. 연결된 세계관이 있으면 서버가 적용한 값(발행된 회차 안), 없으면 1~마지막 회차로 맞춘 값이다. */
    upto: world?.upto ?? loaded?.upto ?? 0,
    /** 연결된 세계관의 관계를 읽지 못했는지(연결이 없는 것과 구분해 알린다) */
    relationsUnavailable: world?.relationshipStatus === 'unavailable',
    isError, retry,
  }
}

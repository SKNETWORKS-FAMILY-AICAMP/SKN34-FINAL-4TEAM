/** 운영 작품 조회(74). 작품 정본과 실제 운영 제한은 Content가, 관리자 권한은 운영 서비스가 소유하며 값은 서버가 계산해 줍니다. */
export type OperationsWork = {
  workId: string
  ownerId: string
  title: string
  authorName: string
  originKind: 'original' | 'fork'
  creationType: 'original' | 'external_derivative'
  /** 권리 진술이 하나라도 있으면 확인됨입니다. */
  rightsConfirmed: boolean
  visibility: 'public' | 'private'
  /** 운영 제한 중이면 공개 여부와 상관없이 독자에게 보이지 않습니다. */
  restricted: boolean
}

/**
 * 운영 작품 상세의 회차 한 줄(본문 없음, 번호순). 제한은 독자 열람·조회수·댓글만 막고 작가 집필은 그대로다(결정 A).
 * 상속 회차(Fork가 원작에서 물려받은 회차)는 직접 제한할 수 없고 원작 회차를 제한해야 한다.
 */
export type OperationsEpisode = { number: number; title: string; publicationStatus: string; restricted: boolean; inherited: boolean }

/** 상속 회차를 제한하려 하면 서버가 409 `EPISODE_INHERITED`로 거절한다. */
export const EPISODE_INHERITED_MESSAGE = '원작에서 상속한 회차는 직접 제한할 수 없어요. 원작 작품의 같은 회차를 제한해 주세요.'

const PUBLICATION_LABELS: Record<string, string> = { draft: '작성 중', published: '발행', suspended: '공개 중단' }
export const publicationStatusLabel = (status: string) => PUBLICATION_LABELS[status] ?? status

/** 작품의 권리 표시값(작품 표와 작품 상세가 같이 쓴다). 작품 검색도 화면에 보이는 이 문구로 한다. */
export const rightsLabel = (w: Pick<OperationsWork, 'creationType' | 'rightsConfirmed'>) =>
  `${w.creationType === 'external_derivative' ? '외부 2차 창작' : '원작'} · ${w.rightsConfirmed ? '권리 확인됨' : '권리 미확인'}`

export type ForkIntegrity = {
  basisEpisode: number
  forkHash: string
  sourceHash: string
  matches: boolean
  characterStateStatus: 'unavailable'
}

/** 점검 결과. 서버가 이 포크는 점검할 수 없다고 안내하면(404·409) 실패가 아니라 그 문구가 영구 상태이므로 다시 시도하게 하지 않습니다. */
export type ForkIntegrityResult = { available: true; report: ForkIntegrity } | { available: false; message: string }

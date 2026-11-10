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

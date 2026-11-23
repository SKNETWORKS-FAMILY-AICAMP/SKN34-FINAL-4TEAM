/**
 * 운영 세계관 조회(결정 B): 지우지 않은 전체 세계관을 최신순으로 보여 준다. 정본과 제한은 Content가 소유하고 `ownerName`은 운영 서비스가
 * Core 닉네임으로 붙인다. 제한은 공개 세계관 경로(목록·상세·카드 검색·이미지·가져오기)만 막고 연결된 소설 위키·Fork 이어받기는 건드리지 않는다.
 */
export type OperationsWorld = {
  worldId: string
  ownerId: string
  ownerName: string | null
  name: string
  visibility: 'public' | 'private'
  /** 저장 버전이 있어 공개 목록에 나올 수 있는 세계관이다(공개 설정이어도 저장 버전이 없으면 false). */
  published: boolean
  restricted: boolean
  genre: string | null
  createdAt: string
  /** 이 세계관에 연결된 작품(1:1, DEC-46). 연결이 없으면 null이다. */
  linkedWorkId: string | null
}

/** 공개 목록에 실제로 나오는 세계관: 공개 설정 + 저장 버전 + 운영 제한 없음. */
export const isListedWorld = (w: Pick<OperationsWorld, 'visibility' | 'published' | 'restricted'>) => w.visibility === 'public' && w.published && !w.restricted

/** 공개 상태 글자(운영 제한이 먼저): 공개 설정이어도 저장 버전이 없으면 아직 공개 목록에 나오지 않는다. */
export const worldStatusLabel = (w: Pick<OperationsWorld, 'visibility' | 'published' | 'restricted'>) =>
  w.restricted ? '운영 제한' : w.visibility === 'private' ? '비공개' : w.published ? '공개' : '공개 대기 · 저장 버전 없음'

/** 세계관 조회·제한은 `works`(화면 이름 '작품 관리') 권한이 필요하다. 403이면 다시 시도 대신 이 안내만 보인다. */
export const WORLDS_FORBIDDEN = "세계관을 보고 제한하려면 '작품 관리' 권한이 필요해요."

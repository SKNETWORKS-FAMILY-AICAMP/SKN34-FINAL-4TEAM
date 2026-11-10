/** 운영 댓글 조회(75). 댓글 정본과 실제 숨김은 Content가, 관리자 권한은 운영 서비스가 소유하며 값은 서버가 계산해 줍니다. */
export type OperationsComment = {
  commentId: string
  workId: string
  workTitle: string
  episodeNumber: number
  authorId: string
  /** 탈퇴한 회원이면 서버가 `탈퇴한 회원`으로 채웁니다. */
  authorName: string
  /** 숨긴 댓글도 운영자에게는 원문을 보여 줍니다. 독자 화면의 자리표시는 공개 API가 만듭니다. */
  body: string
  /** 공감 수는 좋아요 수입니다. */
  likeCount: number
  hidden: boolean
  createdAt: string
}

/** 작품 필터 선택지 [작품 id, 표시 이름]: 작품명 가나다순이고, 제목이 같은 작품은 id를 붙여 구분합니다. */
export function commentWorkOptions(rows: OperationsComment[]): [string, string][] {
  const works = [...new Map(rows.map((c) => [c.workId, c.workTitle])).entries()].sort((a, b) => a[1].localeCompare(b[1], 'ko'))
  return works.map(([id, title]): [string, string] => [id, works.filter((w) => w[1] === title).length > 1 ? `${title} · ${id}` : title])
}

/** 작품(`all`이면 전체)·검색(내용·작품명·작성자)·공감순(`likesAsc`만 적은순) 계산. 공감이 같으면 최신 댓글이 먼저입니다. */
export function filterOperationsComments(rows: OperationsComment[], { workId, query, sort }: { workId: string; query: string; sort: string }) {
  const q = query.toLocaleLowerCase()
  const direction = sort === 'likesAsc' ? -1 : 1
  return rows
    .filter((c) => (workId === 'all' || c.workId === workId) && (!q || [c.body, c.workTitle, c.authorName].join(' ').toLocaleLowerCase().includes(q)))
    .sort((a, b) => direction * (b.likeCount - a.likeCount) || Date.parse(b.createdAt) - Date.parse(a.createdAt))
}

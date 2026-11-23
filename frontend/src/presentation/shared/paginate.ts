const PAGE_SIZE = 10

/** page(1부터)를 1과 총 쪽 수 사이로 보정해, 그 쪽에 보일 항목을 돌려 준다. 빈 목록도 1쪽으로 본다. */
export function paginate<T>(list: readonly T[], page: number) {
  const pages = Math.max(1, Math.ceil(list.length / PAGE_SIZE))
  const current = Math.min(Math.max(page, 1), pages)
  return { items: list.slice((current - 1) * PAGE_SIZE, current * PAGE_SIZE), page: current, pages }
}

/**
 * 쪽 번호 버튼에 보일 목록(page는 1부터). 7쪽까지는 전부, 그보다 많으면 처음·끝과 현재 쪽 주변만 두고 사이는 '…'로 줄인다(항상 7칸이라 쪽을 넘겨도 줄이 흔들리지 않는다).
 */
export function pageNumbers(page: number, pages: number): (number | '…')[] {
  if (pages <= 7) return Array.from({ length: pages }, (_, i) => i + 1)
  if (page <= 4) return [1, 2, 3, 4, 5, '…', pages]
  if (page >= pages - 3) return [1, '…', pages - 4, pages - 3, pages - 2, pages - 1, pages]
  return [1, '…', page - 1, page, page + 1, '…', pages]
}

/** 주소 `page`(1부터)를 읽는다. 1 이상의 정수 글자(6자리까지)만 그 쪽이고, 그 밖(없음·0·음수·소수·글자·너무 큰 값)은 1쪽이다. */
export const pageParam = (value: string | null) => (/^\d{1,6}$/.test(value ?? '') ? Math.max(1, Number(value)) : 1)

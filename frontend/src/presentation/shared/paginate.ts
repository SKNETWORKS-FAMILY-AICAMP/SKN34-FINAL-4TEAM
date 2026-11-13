const PAGE_SIZE = 10

/** page(1부터)를 1과 총 쪽 수 사이로 보정해, 그 쪽에 보일 항목을 돌려 준다. 빈 목록도 1쪽으로 본다. */
export function paginate<T>(list: readonly T[], page: number) {
  const pages = Math.max(1, Math.ceil(list.length / PAGE_SIZE))
  const current = Math.min(Math.max(page, 1), pages)
  return { items: list.slice((current - 1) * PAGE_SIZE, current * PAGE_SIZE), page: current, pages }
}

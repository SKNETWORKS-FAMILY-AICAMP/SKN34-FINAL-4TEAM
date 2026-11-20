export function pageItems<T>(items: readonly T[], requested: number, size: number) {
  const pages = Math.max(1, Math.ceil(items.length / size))
  const page = Math.max(0, Math.min(requested, pages - 1))
  return { items: items.slice(page * size, (page + 1) * size), page, pages }
}

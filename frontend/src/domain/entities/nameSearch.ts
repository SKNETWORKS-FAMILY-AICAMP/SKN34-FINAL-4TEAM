/**
 * 이름에 검색어가 들어 있는 항목만 원래 순서대로 남긴다. 대소문자와 검색어 앞뒤 공백은 무시하고, 검색어가 비면 전체가 남는다(빈 문자열은 어느 이름에나 들어 있다).
 * ponytail: 단순 부분 일치다. 초성 검색이나 띄어쓰기를 무시한 검색은 하지 않는다.
 */
export function filterByName<T extends { name: string }>(items: readonly T[], query: string): T[] {
  const q = query.trim().toLowerCase()
  return items.filter((item) => item.name.toLowerCase().includes(q))
}

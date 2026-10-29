export const kfmt = (n: number) => n >= 10000 ? (n / 10000).toFixed(1).replace(/\.0$/, '') + '만' : n >= 1000 ? (n / 1000).toFixed(1).replace(/\.0$/, '') + '천' : String(n)
export const ago = (m: number) => m < 1 ? '방금' : m < 60 ? m + '분 전' : m < 1440 ? Math.floor(m / 60) + '시간 전' : Math.floor(m / 1440) + '일 전'

/** 목업 rng(): 같은 seed면 같은 그림이 나오는 난수 */
export function rng(seed: string) {
  let s = 0
  for (const c of String(seed)) s = (s * 31 + c.charCodeAt(0)) >>> 0
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296)
}

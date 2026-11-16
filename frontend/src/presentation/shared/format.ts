export const kfmt = (n: number) => n >= 10000 ? (n / 10000).toFixed(1).replace(/\.0$/, '') + '만' : n >= 1000 ? (n / 1000).toFixed(1).replace(/\.0$/, '') + '천' : String(n)
export const ago = (m: number) => m < 1 ? '방금' : m < 60 ? m + '분 전' : m < 1440 ? Math.floor(m / 60) + '시간 전' : Math.floor(m / 1440) + '일 전'

/** 목업 rng(): 같은 seed면 같은 그림이 나오는 난수 */
export function rng(seed: string) {
  let s = 0
  for (const c of String(seed)) s = (s * 31 + c.charCodeAt(0)) >>> 0
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296)
}

/** 목업 qs(): 빈 값을 뺀 검색 조건 주소 */
export function qs(base: string, o: Record<string, string | undefined>) {
  const p = Object.entries(o).filter((e): e is [string, string] => e[1] !== '' && e[1] != null).map(([k, v]) => k + '=' + encodeURIComponent(v)).join('&')
  return base + (p ? '?' + p : '')
}

const kstClock = new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
/** 서버가 순위를 계산한 시각을 한국시간 "HH:mm 기준"으로 표시합니다(자정 직후는 00:05). */
export const asOf = (at: Date) => `${kstClock.format(at)} 기준`

const kst = new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', dateStyle: 'short', timeStyle: 'short' })
/** 서버 UTC 시각을 한국시간으로 표시합니다. */
export const kstDateTime = (iso: string) => kst.format(new Date(iso))
/** 서버 UTC 기간을 한국시간 문구로 바꿉니다. 비어 있는 쪽은 미정입니다. */
export const kstPeriod = ({ startsAt, endsAt }: { startsAt: string | null; endsAt: string | null }) =>
  `${startsAt ? kstDateTime(startsAt) : '시작 미정'} ~ ${endsAt ? kstDateTime(endsAt) : '종료 미정'} · 한국시간`

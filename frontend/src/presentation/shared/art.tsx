import type { ReactNode } from 'react'

import type { Theme, Work } from '../../domain/entities/work'
import { kfmt, rng } from './format'

/** 목업 art(): 테마별 인라인 SVG 표지 (외부 이미지 없음) */
export function Art({ theme, w, h, seed, title = '' }: { theme: Theme; w: number; h: number; seed: string; title?: string }) {
  const r = rng(seed + theme)
  const id = 'a' + Math.floor(r() * 1e9)
  const els: ReactNode[] = []
  if (theme === 'hanji') {
    els.push(
      <defs key="d"><linearGradient id={id} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#F4ECDC" /><stop offset="1" stopColor="#E4D6BC" /></linearGradient></defs>,
      <rect key="bg" width={w} height={h} fill={`url(#${id})`} />,
      <circle key="sun" cx={w * (0.62 + r() * 0.15)} cy={h * 0.26} r={Math.min(w, h) * 0.12} fill="#D9A15B" opacity=".85" />,
    )
    for (const [i, [y, c, o]] of ([[0.42, '#9C9284', 0.45], [0.55, '#6E655A', 0.6], [0.7, '#3B352E', 0.85]] as const).entries()) {
      let d = `M0 ${h} L0 ${h * y}`
      let x = 0
      while (x < w) {
        const nx = x + w * (0.12 + r() * 0.16)
        d += ` Q${(x + nx) / 2} ${h * (y - 0.08 - r() * 0.14)} ${nx} ${h * (y + (r() - 0.5) * 0.06)}`
        x = nx
      }
      els.push(<path key={'m' + i} d={`${d} L${w} ${h} Z`} fill={c} opacity={o} />)
    }
    for (let k = 0; k < 5; k++) els.push(<path key={'b' + k} d={`M${w * (0.1 + r() * 0.3)} ${h * (0.18 + r() * 0.1)} q12 -6 24 0 q12 6 24 0`} stroke="#7A6A55" strokeWidth="1.2" fill="none" opacity=".45" />)
    if (title) {
      els.push(<rect key="tb" x={w - 58} y={h * 0.08} width="38" height={title.length * 30 + 20} fill="#F7F0E2" stroke="#3B352E" strokeWidth="2" />)
      ;[...title].forEach((c, i) => els.push(<text key={'t' + i} x={w - 39} y={h * 0.08 + 38 + i * 30} fontFamily="serif" fontSize="24" fontWeight="700" fill="#2A241D" textAnchor="middle">{c}</text>))
    }
  } else if (theme === 'star') {
    els.push(
      <defs key="d">
        <linearGradient id={id} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#070A1F" /><stop offset=".7" stopColor="#2A2F6E" /><stop offset="1" stopColor="#5A3E7A" /></linearGradient>
        <radialGradient id={id + 'g'}><stop offset="0" stopColor="#FFF3C4" /><stop offset="1" stopColor="#FFF3C4" stopOpacity="0" /></radialGradient>
      </defs>,
      <rect key="bg" width={w} height={h} fill={`url(#${id})`} />,
    )
    for (let k = 0; k < 60; k++) els.push(<circle key={'s' + k} cx={(r() * w).toFixed(1)} cy={(r() * h * 0.7).toFixed(1)} r={(r() * 1.4 + 0.3).toFixed(2)} fill="#fff" opacity={(r() * 0.8 + 0.2).toFixed(2)} />)
    const cx = w * 0.5
    els.push(
      <circle key="g" cx={cx} cy={h * 0.24} r={w * 0.2} fill={`url(#${id}g)`} opacity=".7" />,
      <circle key="c" cx={cx} cy={h * 0.24} r={w * 0.035} fill="#FFF3C4" />,
      <path key="t" d={`M${cx - w * 0.07} ${h} L${cx - w * 0.05} ${h * 0.36} L${cx} ${h * 0.28} L${cx + w * 0.05} ${h * 0.36} L${cx + w * 0.07} ${h}Z`} fill="#05061A" />,
      <path key="h" d={`M0 ${h} L0 ${h * 0.84} Q${w * 0.25} ${h * 0.75} ${w * 0.42} ${h * 0.86} L${w * 0.58} ${h * 0.86} Q${w * 0.78} ${h * 0.76} ${w} ${h * 0.82} L${w} ${h}Z`} fill="#05061A" />,
    )
  } else {
    els.push(
      <defs key="d"><linearGradient id={id} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#05080C" /><stop offset="1" stopColor="#123038" /></linearGradient></defs>,
      <rect key="bg" width={w} height={h} fill={`url(#${id})`} />,
    )
    for (let x = 0, k = 0; x < w; x += w * 0.085, k++) {
      const bh = h * (0.3 + r() * 0.45)
      els.push(<rect key={'b' + k} x={x} y={h - bh} width={w * 0.075} height={bh} fill="#081217" stroke="#1E4A52" strokeWidth=".6" />)
      for (let y = h - bh + 10; y < h - 8; y += 14) if (r() > 0.62) els.push(<rect key={`w${k}-${y}`} x={x + 5} y={y} width="5" height="4" fill="#33E1D0" opacity=".8" />)
    }
    for (let k = 0; k < 40; k++) {
      const x = r() * w
      const y = r() * h
      els.push(<line key={'r' + k} x1={x} y1={y} x2={x - 3} y2={y + 14} stroke="#7FEFE4" strokeWidth=".7" opacity=".35" />)
    }
  }
  return <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="xMidYMid slice" aria-hidden="true">{els}</svg>
}

export function CoverOf({ w, k = '' }: { w: Work; k?: string }) {
  if (w.coverImg) return <img className="cimg" src={w.coverImg} alt="" />
  return <Art theme={w.theme} w={300} h={400} seed={w.id + k} title={w.theme === 'hanji' && !w.parent && w.hanja ? w.hanja : ''} />
}

const TAGS: Record<string, [string, string]> = { up: ['tag', 'UP'], new: ['tag new', '신작'], free: ['tag free', '무료'], if: ['tag if', '포크'] }
export const Tags = ({ w }: { w: Work }) => <>{w.tags.map((t) => TAGS[t] && <span key={t} className={TAGS[t][0]}>{TAGS[t][1]}</span>)}</>

/** 목업 cov(): 표지 + 태그 + 좋아요 수 */
export function Cov({ w, k = '', likes = false }: { w: Work; k?: string; likes?: boolean }) {
  return (
    <div className="cov">
      <CoverOf w={w} k={k} />
      <div className="tg"><Tags w={w} /></div>
      {likes && <span className="lk">♥ {kfmt(w.likes)}</span>}
    </div>
  )
}

import type { CSSProperties, ReactNode } from 'react'

import type { Theme } from '../../../../domain/entities/work'
import { rng } from '../../../shared/format'

/** 목업 amb(t, lite, band): 소설 분위기 배경 효과 (꽃잎·별·반딧불·빗줄기) */
export function Amb({ t, lite = false, band = false }: { t: Theme; lite?: boolean; band?: boolean }) {
  const r = rng('amb' + t + (lite ? 'l' : ''))
  const els: ReactNode[] = []
  const add = (n: number, cls: string, style: (i: number) => CSSProperties) => { for (let i = 0; i < n; i++) els.push(<span key={cls + i} className={cls} style={style(i)} />) }
  if (lite) {
    if (t === 'hanji') {
      add(16, 'p', () => ({ left: `${(r() * 100).toFixed(1)}%`, animationDuration: `${(12 + r() * 10).toFixed(1)}s`, animationDelay: `-${(r() * 20).toFixed(1)}s`, transform: `scale(${(0.7 + r() * 0.6).toFixed(2)})` }))
      add(3, 'cl', (i) => ({ top: `${8 + i * 22}%`, animationDuration: `${60 + i * 25}s`, animationDelay: `-${(r() * 60).toFixed(0)}s`, opacity: (0.35 + r() * 0.25).toFixed(2) }))
    }
    if (t === 'star') add(28, 'ff', () => ({ left: `${(r() * 100).toFixed(1)}%`, top: `${(20 + r() * 80).toFixed(1)}%`, animationDuration: `${(9 + r() * 9).toFixed(1)}s,${(2 + r() * 2).toFixed(1)}s`, animationDelay: `-${(r() * 12).toFixed(1)}s,-${(r() * 3).toFixed(1)}s` }))
    if (t === 'neon') add(46, 'rl', () => ({ left: `${(r() * 110 - 5).toFixed(1)}%`, animationDuration: `${(1.1 + r() * 0.9).toFixed(2)}s`, animationDelay: `-${(r() * 2).toFixed(1)}s`, opacity: (0.35 + r() * 0.4).toFixed(2) }))
    return <div className={`amb lite${band ? ' band-amb' : ''}`} aria-hidden="true">{els}</div>
  }
  if (t === 'hanji') add(14, 'p', () => ({ left: `${(r() * 100).toFixed(1)}%`, animationDuration: `${(9 + r() * 10).toFixed(1)}s`, animationDelay: `-${(r() * 15).toFixed(1)}s` }))
  if (t === 'star') add(70, 's', () => ({ left: `${(r() * 100).toFixed(1)}%`, top: `${(r() * 100).toFixed(1)}%`, animationDelay: `-${(r() * 3).toFixed(1)}s` }))
  if (t === 'neon') add(40, 'r', () => ({ left: `${(r() * 100).toFixed(1)}%`, animationDuration: `${(0.8 + r() * 0.9).toFixed(2)}s`, animationDelay: `-${(r() * 2).toFixed(1)}s` }))
  return <div className="amb" aria-hidden="true">{els}</div>
}

import { portraitSvg } from './portraitSvg'

/** 목업 portrait(name, size)를 이미지로 그립니다 (문자열 HTML을 DOM에 넣지 않습니다). */
export function Portrait({ name, size = 40 }: { name: string; size?: number }) {
  const svg = portraitSvg(name, size).replace('<svg ', '<svg xmlns="http://www.w3.org/2000/svg" ')
  return <img src={'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg)} width={size} height={size} alt="" style={{ display: 'block', width: '100%', height: '100%' }} />
}

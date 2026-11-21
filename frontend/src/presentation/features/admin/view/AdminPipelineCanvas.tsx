import { useEffect, useMemo, useRef, useState } from 'react'
import ForceGraph2D, { type ForceGraphMethods } from 'react-force-graph-2d'

import { NODE_HEIGHT, NODE_WIDTH, layoutPipeline, nodeStats, pipelineSummary, type PipelineNode, type PlacedNode } from '../../../../domain/entities/llmOpsPipeline'

type GraphNode = PlacedNode & { fx: number; fy: number }
/** force-graph가 그래프를 읽을 때 source·target을 노드 객체로 바꾸므로 둘 다 받는다. */
type GraphLink = { source: string | GraphNode; target: string | GraphNode }
type Palette = { ink: string; sub: string; line: string; surface: string; danger: string; pri: string; font: string }

const PAD = 24
const FALLBACK: Palette = { ink: '#191A1F', sub: '#5F6370', line: '#DEE2E6', surface: '#FFFFFF', danger: '#B42318', pri: '#6D4AE0', font: 'system-ui, sans-serif' }

/** 캔버스는 CSS 변수를 못 읽으므로, 그릴 때마다 호스트에 계산된 테마 토큰(밝은·어두운 테마 값)을 글자로 읽는다. */
function readPalette(el: Element | null): Palette {
  if (!el) return FALLBACK
  const style = getComputedStyle(el)
  const token = (name: string, fallback: string) => style.getPropertyValue(name).trim() || fallback
  return {
    ink: token('--ink', FALLBACK.ink), sub: token('--sub', FALLBACK.sub), line: token('--line2', FALLBACK.line), surface: token('--surface', FALLBACK.surface),
    danger: token('--danger', FALLBACK.danger), pri: token('--pri', FALLBACK.pri), font: token('--ui', FALLBACK.font),
  }
}

/**
 * AI 파이프라인 캔버스(DEC-58). 노드는 layoutPipeline이 정한 고정 좌표(fx·fy)라 움직이지 않고, 끌기·이동·확대는 끄며(페이지 스크롤을 가로채지 않는다) 크기에 맞춰 전체가 들어오는 비율만 맞춘다.
 * 이름·건수·오류 수를 상자에 직접 그리고(오류가 있으면 위험 색, 고른 노드는 주 색 테두리) 선은 앞 노드 오른쪽에서 다음 노드 왼쪽으로 잇는다.
 * 캔버스는 보조라 role="img" 요약만 갖고, 같은 노드를 키보드로 고르는 버튼 목록은 화면이 캔버스 아래에 둔다. ResizeObserver가 없는 jsdom에서는 크기를 못 재 틀(role="img")만 그린다.
 */
export default function AdminPipelineCanvas({ nodes, selected, onSelect }: { nodes: PipelineNode[]; selected: string | null; onSelect: (id: string) => void }) {
  const host = useRef<HTMLDivElement>(null)
  const graph = useRef<ForceGraphMethods<GraphNode, GraphLink>>(undefined)
  const palette = useRef(FALLBACK)
  const [width, setWidth] = useState(0)
  const layout = useMemo(() => layoutPipeline(nodes), [nodes])
  // ForceGraph는 링크 객체를 고쳐 쓰는 가변 데이터라 배치가 바뀔 때만 새로 만든다.
  const data = useMemo(() => ({ nodes: layout.nodes.map((n): GraphNode => ({ ...n, fx: n.x, fy: n.y })), links: layout.links.map((link): GraphLink => ({ ...link })) }), [layout])
  const height = width && layout.width ? Math.round(Math.min(Math.max((width * layout.height) / layout.width, 240), 760)) : 0
  const scale = width && layout.width ? Math.min((width - PAD * 2) / layout.width, (height - PAD * 2) / layout.height) : 1

  useEffect(() => {
    const el = host.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(([entry]) => setWidth(Math.round(entry.contentRect.width)))
    observer.observe(el)
    return () => observer.disconnect()
  }, [])
  // 배치가 원점 가운데라 확대 비율만 맞추면 된다. force-graph가 새 크기를 캔버스에 반영한 뒤(마운트·속성 변경 1ms 뒤)에 맞춘다.
  useEffect(() => {
    if (!width) return
    const refit = setTimeout(() => { graph.current?.centerAt(0, 0, 0); graph.current?.zoom(scale, 0) }, 60)
    return () => clearTimeout(refit)
  }, [width, scale, data])

  const endOf = (end: unknown) => (typeof end === 'object' && end !== null ? (end as GraphNode) : data.nodes.find((n) => n.id === end))
  const paintNode = (node: GraphNode, ctx: CanvasRenderingContext2D, zoom: number) => {
    const p = palette.current, on = node.id === selected, bad = node.errors > 0
    ctx.beginPath()
    ctx.roundRect(node.x - NODE_WIDTH / 2, node.y - NODE_HEIGHT / 2, NODE_WIDTH, NODE_HEIGHT, 8)
    ctx.fillStyle = p.surface
    ctx.fill()
    ctx.lineWidth = (on ? 2 : 1) / zoom
    ctx.strokeStyle = on ? p.pri : bad ? p.danger : p.line
    ctx.stroke()
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.font = `600 12px ${p.font}`
    ctx.fillStyle = p.ink
    ctx.fillText(node.label, node.x, node.y - 8, NODE_WIDTH - 16) // maxWidth: 상자보다 길면 글자 폭을 줄여 맞춘다
    ctx.font = `500 10.5px ${p.font}`
    ctx.fillStyle = bad ? p.danger : p.sub
    ctx.fillText(nodeStats(node), node.x, node.y + 11, NODE_WIDTH - 12)
  }
  const paintLink = (link: { source?: unknown; target?: unknown }, ctx: CanvasRenderingContext2D, zoom: number) => {
    const from = endOf(link.source), to = endOf(link.target)
    if (!from || !to) return
    const p = palette.current, hot = selected !== null && (from.id === selected || to.id === selected)
    const startX = from.x + NODE_WIDTH / 2, endX = to.x - NODE_WIDTH / 2, middle = (startX + endX) / 2
    ctx.strokeStyle = ctx.fillStyle = hot ? p.pri : p.line
    ctx.lineWidth = (hot ? 1.5 : 1) / zoom
    ctx.beginPath()
    ctx.moveTo(startX, from.y)
    ctx.bezierCurveTo(middle, from.y, middle, to.y, endX, to.y)
    ctx.stroke()
    ctx.beginPath()
    ctx.moveTo(endX, to.y)
    ctx.lineTo(endX - 7, to.y - 4)
    ctx.lineTo(endX - 7, to.y + 4)
    ctx.closePath()
    ctx.fill()
  }

  return (
    <div ref={host} className="pipe-canvas" role="img" aria-label={pipelineSummary(nodes)} style={height ? { height } : undefined}>
      {width > 0 && (
        <ForceGraph2D<GraphNode, GraphLink>
          ref={graph} graphData={data} width={width} height={height} backgroundColor="rgba(0,0,0,0)"
          cooldownTicks={0} warmupTicks={0} enableNodeDrag={false} enablePanInteraction={false} enableZoomInteraction={false}
          nodeLabel={() => ''} onRenderFramePre={() => { palette.current = readPalette(host.current) }}
          nodeCanvasObject={paintNode}
          nodePointerAreaPaint={(node, color, ctx) => { ctx.fillStyle = color; ctx.fillRect(node.x - NODE_WIDTH / 2, node.y - NODE_HEIGHT / 2, NODE_WIDTH, NODE_HEIGHT) }}
          linkCanvasObjectMode={() => 'replace'} linkCanvasObject={paintLink}
          onNodeClick={(node) => onSelect(node.id)}
        />
      )}
    </div>
  )
}

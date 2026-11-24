import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import ForceGraph2D, { type ForceGraphMethods } from 'react-force-graph-2d'

import { NODE_HEIGHT, NODE_WIDTH, layoutPipeline, linkCurve, nodeStats, pipelineSummary, type PipelineNode, type PlacedNode } from '../../../../domain/entities/llmOpsPipeline'

type GraphNode = PlacedNode & { fx: number; fy: number }
/** force-graph가 그래프를 읽을 때 source·target을 노드 객체로 바꾸므로 둘 다 받는다. back은 되돌아가는 선이다. */
type GraphLink = { source: string | GraphNode; target: string | GraphNode; back: boolean }
type Palette = { ink: string; sub: string; line: string; surface: string; danger: string; pri: string; font: string }

const PAD = 24
/** 이보다 작게 줄어든 캔버스에서는 노드 위 부품(프롬프트 보기)이 노드보다 커져 서로 겹치므로 얹지 않는다(노드 버튼 목록에 같은 부품이 있다). 칩은 약 78px, 노드는 132 × 비율이다. */
const LINK_MIN_SCALE = 0.6
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
 * 이름·건수·오류 수를 상자에 직접 그리고(오류가 있으면 위험 색, 고른 노드는 주 색 테두리) 선은 앞 노드 오른쪽에서 다음 노드 왼쪽으로 잇는다. 결과를 메인에 돌려주는
 * 되돌아가는 선(업무 Agent→메인)은 같은 길의 선과 겹치지 않게 비켜 점선으로 따로 그리고, 업무 Agent 묶음 라벨(읽기·검토·작성)은 선·노드 아래에 글자로 그린다.
 * 캔버스는 보조라 role="img" 요약만 갖고, 같은 노드를 키보드로 고르는 버튼 목록은 화면이 캔버스 아래에 둔다. ResizeObserver가 없는 jsdom에서는 크기를 못 재 틀(role="img")만 그린다.
 * nodeLink가 있으면 그 노드 위(상자 위 오른쪽 가장자리)에 눌러 쓰는 부품(프롬프트 보기, #857)을 HTML로 얹는다. role="img"의 자식은 보조 기술에 안 읽히므로 캔버스 바깥 형제 자리에 두고,
 * 위치는 배치 좌표와 확대 비율(scale)로 계산한다(원점이 캔버스 가운데, 아래·오른쪽 끝 기준). 부품이 없는 노드(null)는 자리도 만들지 않고, 비율이 LINK_MIN_SCALE보다 작으면(좁은 화면) 겹치지 않게 아예 얹지 않는다.
 */
export default function AdminPipelineCanvas({ nodes, selected, onSelect, nodeLink }: { nodes: PipelineNode[]; selected: string | null; onSelect: (id: string) => void; nodeLink?: (node: PipelineNode) => ReactNode }) {
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
  const paintLabels = (ctx: CanvasRenderingContext2D) => {
    const p = palette.current
    ctx.save()
    ctx.textAlign = 'left'
    ctx.textBaseline = 'middle'
    ctx.font = `600 10.5px ${p.font}`
    ctx.fillStyle = p.sub
    for (const label of layout.labels) ctx.fillText(label.text, label.x, label.y)
    ctx.restore()
  }
  const paintLink = (link: { source?: unknown; target?: unknown; back?: boolean }, ctx: CanvasRenderingContext2D, zoom: number) => {
    const from = endOf(link.source), to = endOf(link.target)
    if (!from || !to) return
    const p = palette.current, hot = selected !== null && (from.id === selected || to.id === selected), back = link.back === true
    const { points: [start, bendFrom, bendTo, end], dir } = linkCurve(from, to, back)
    ctx.strokeStyle = ctx.fillStyle = hot ? p.pri : p.line
    ctx.lineWidth = (hot ? 1.5 : 1) / zoom
    ctx.setLineDash(back ? [4 / zoom, 3 / zoom] : []) // 되돌아가는 선은 점선이라 앞으로 가는 선보다 옅다
    ctx.beginPath()
    ctx.moveTo(start.x, start.y)
    ctx.bezierCurveTo(bendFrom.x, bendFrom.y, bendTo.x, bendTo.y, end.x, end.y)
    ctx.stroke()
    ctx.setLineDash([])
    ctx.beginPath()
    ctx.moveTo(end.x, end.y)
    ctx.lineTo(end.x - dir * 7, end.y - 4)
    ctx.lineTo(end.x - dir * 7, end.y + 4)
    ctx.closePath()
    ctx.fill()
  }

  return (
    <div className="pipe-canvas-wrap">
    <div ref={host} className="pipe-canvas" role="img" aria-label={pipelineSummary(nodes)} style={height ? { height } : undefined}>
      {width > 0 && (
        <ForceGraph2D<GraphNode, GraphLink>
          ref={graph} graphData={data} width={width} height={height} backgroundColor="rgba(0,0,0,0)"
          cooldownTicks={0} warmupTicks={0} enableNodeDrag={false} enablePanInteraction={false} enableZoomInteraction={false}
          nodeLabel={() => ''} onRenderFramePre={(ctx) => { palette.current = readPalette(host.current); paintLabels(ctx) }}
          nodeCanvasObject={paintNode}
          nodePointerAreaPaint={(node, color, ctx) => { ctx.fillStyle = color; ctx.fillRect(node.x - NODE_WIDTH / 2, node.y - NODE_HEIGHT / 2, NODE_WIDTH, NODE_HEIGHT) }}
          linkCanvasObjectMode={() => 'replace'} linkCanvasObject={paintLink}
          onNodeClick={(node) => onSelect(node.id)}
        />
      )}
    </div>
    {nodeLink && width > 0 && scale >= LINK_MIN_SCALE && (
      <div className="pipe-node-links" style={{ width, height }}>
        {layout.nodes.map((n) => {
          const link = nodeLink(n)
          // transform으로 비키면 안쪽 메뉴(fixed)의 기준이 이 칸으로 바뀌어 어긋나므로 right·bottom으로 앉힌다(칩의 아래 끝이 상자 위 가장자리 5px 아래, 오른쪽 끝이 상자 오른쪽 끝 6px 안쪽).
          return link && <div key={n.id} className="pipe-node-link" style={{ right: width / 2 - (n.x + NODE_WIDTH / 2) * scale + 6, bottom: height / 2 - (n.y - NODE_HEIGHT / 2) * scale - 5 }}>{link}</div>
        })}
      </div>
    )}
    </div>
  )
}

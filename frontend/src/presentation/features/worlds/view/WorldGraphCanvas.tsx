import { useLayoutEffect, useState } from 'react'
import ForceGraph2D from 'react-force-graph-2d'

import { MapControls, useMapCanvas } from '../../worldstudio/view/useMapCanvas'
import { CANVAS_FONT, aspectGravity } from '../worldAtlas'
import { detailEndpoint, showsDetailLabel, type DetailGraph, type DetailLink, type DetailNode } from '../worldDetail'
import { useRelayout } from './useRelayout'

// 힘의 세기. 수치는 데모 세계관 26개로 d3-force를 돌려 골랐다(데스크톱 1072×460·모바일 327×340 캔버스에서 이름이 겹치지 않고 가로를 60~70% 채움).
// 노드가 지도보다 훨씬 적어 반발을 세게, 가로로 긴 화면을 채우도록 중력을 지도(0.08)보다 세게 둔다.
// 설정 그래프는 중심에서 카드로 뻗는 별 모양이고 인물관계도는 인물 서넛이 서로 멀리 떨어진다. 인물관계도에는 중심 노드·중심 선이 없어 `world` 값은 쓰이지 않는다(키만 맞춘 자리).
const FORCES = {
  setting: { gravity: 0.4, charge: { card: -700, world: -1050 }, distance: { world: 110, link: 90 }, strength: { world: 0.7, link: 0.25 } },
  people: { gravity: 0.2, charge: { card: -600, world: 0 }, distance: { world: 0, link: 130 }, strength: { world: 0, link: 0.5 } },
} as const
/** 노드 크기(px). 노드가 적어 맞춤 배율이 커도 점이 커지지 않게 이름처럼 확대 배율과 상관없이 같은 픽셀로 그린다. */
const radiusOf = (n: DetailNode) => (n.kind === '세계관' ? 12 : n.kind === '인물' ? 9 : 7)

/**
 * 공개 세계관 상세의 설정 그래프(`mode="setting"`)·인물관계도(`mode="people"`) 캔버스. 세계관 지도(`WorldAtlasCanvas`)와 같은 훅·컨트롤·마크업(`.atlas-*`)을 쓴다.
 * 이름은 HTML 툴팁(`nodeLabel`) 대신 캔버스에 직접 그린다. 노드가 적어 이름을 늘 그리고(`showsDetailLabel`) 인물관계도는 관계 라벨을 선 위에 그린다.
 * 노드를 누르면 `onOpen`으로 알려 그 설정 카드의 페이지(중심은 설정집 탭)로 건너가게 한다. `data`는 ForceGraph가 좌표를 붙이고 링크 끝점을 바꾸는 가변 객체라 세계관마다 한 번 만든 것을 그대로 넘긴다.
 */
export default function WorldGraphCanvas({ data, mode, summary, onOpen }: { data: DetailGraph; mode: keyof typeof FORCES; summary: string; onOpen: (node: DetailNode) => void }) {
  const canvas = useMapCanvas<DetailNode, DetailLink>()
  const { host, graph, width, reduced, paused } = canvas
  const forces = FORCES[mode]
  const [hover, setHover] = useState<string>()
  const [height, setHeight] = useState(460)
  const compact = width < 480
  const { replay, onEngineStop } = useRelayout(canvas, data.nodes, 48)

  // 높이는 CSS(데스크톱 460px·모바일 340px)가 정하고 캔버스가 같은 값을 읽는다. 그리기 전에 맞춰 크기가 튀지 않는다.
  useLayoutEffect(() => setHeight(host.current?.clientHeight || 460), [host, width])
  // 데이터가 들어와 예열 틱이 돌기 전에 힘을 정한다(WorldAtlasCanvas와 같은 이유).
  useLayoutEffect(() => {
    const g = graph.current
    g?.d3Force('charge')?.strength((n: DetailNode) => (n.kind === '세계관' ? forces.charge.world : forces.charge.card))
    g?.d3Force('link')?.distance((l: DetailLink) => forces.distance[l.kind]).strength((l: DetailLink) => forces.strength[l.kind])
    g?.d3Force('gravity', aspectGravity<DetailNode>(() => (host.current?.clientWidth ?? 0) / (host.current?.clientHeight || 1), forces.gravity))
  }, [graph, host, forces])

  const touches = (l: DetailLink) => !!hover && (detailEndpoint(l.source) === hover || detailEndpoint(l.target) === hover)

  const paintNode = (node: DetailNode, ctx: CanvasRenderingContext2D, scale: number) => {
    const x = node.x ?? 0
    const y = node.y ?? 0
    const r = radiusOf(node) / scale
    ctx.shadowColor = node.color
    ctx.shadowBlur = 12
    ctx.beginPath()
    ctx.arc(x, y, r, 0, 2 * Math.PI)
    ctx.fillStyle = node.color
    ctx.fill()
    ctx.shadowBlur = 0
    ctx.lineWidth = 1.5 / scale
    ctx.strokeStyle = 'rgba(255,255,255,.85)'
    ctx.stroke()
    if (hover === node.id) {
      ctx.beginPath()
      ctx.arc(x, y, r + 4 / scale, 0, 2 * Math.PI)
      ctx.strokeStyle = '#fff'
      ctx.stroke()
    }
  }

  // 이름은 모든 노드를 그린 뒤 한 번에 얹는다(노드 안에서 그리면 뒤에 그려지는 큰 원에 가려진다). 좁은 화면은 짧게 줄이고 가리킨 노드는 전체 이름을 보인다.
  const paintLabels = (ctx: CanvasRenderingContext2D, scale: number) => {
    const limit = compact ? 10 : 18
    for (const node of data.nodes) {
      if (!showsDetailLabel(node, data.nodes.length, hover)) continue
      const text = node.id === hover || node.name.length <= limit ? node.name : `${node.name.slice(0, limit - 1)}…`
      const x = node.x ?? 0
      const y = (node.y ?? 0) + (radiusOf(node) + 3) / scale
      ctx.font = `700 ${(node.kind === '세계관' ? 13 : compact ? 10.5 : 11.5) / scale}px ${CANVAS_FONT}`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'top'
      ctx.lineJoin = 'round'
      ctx.lineWidth = 3 / scale
      ctx.strokeStyle = 'rgba(8,14,27,.9)'
      ctx.strokeText(text, x, y)
      ctx.fillStyle = '#EAF0FF'
      ctx.fillText(text, x, y)
    }
  }

  // 관계 라벨은 선 한가운데에 얹고, 선이 글자를 가르지 않게 뒤를 어두운 테두리로 비운다.
  const paintLinkLabel = (link: DetailLink, ctx: CanvasRenderingContext2D, scale: number) => {
    const { source: a, target: b, label } = link
    if (!label || typeof a !== 'object' || typeof b !== 'object') return
    const x = ((a.x ?? 0) + (b.x ?? 0)) / 2
    const y = ((a.y ?? 0) + (b.y ?? 0)) / 2
    ctx.font = `700 ${(compact ? 10.5 : 11.5) / scale}px ${CANVAS_FONT}`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.lineJoin = 'round'
    ctx.lineWidth = 4 / scale
    ctx.strokeStyle = 'rgba(8,14,27,.95)'
    ctx.strokeText(label, x, y)
    ctx.fillStyle = '#FFD98A'
    ctx.fillText(label, x, y)
  }

  return (
    <>
      <div className="atlas-view">
        <div ref={host} className="atlas-canvas" role="img" aria-label={summary}>
          <ForceGraph2D<DetailNode, DetailLink>
            ref={graph} graphData={data} width={width} height={height} backgroundColor="rgba(0,0,0,0)"
            cooldownTicks={paused ? 0 : 240} warmupTicks={reduced ? 270 : 30} minZoom={0.25} maxZoom={8}
            nodeLabel={() => ''} nodeCanvasObject={paintNode} onRenderFramePost={paintLabels}
            nodePointerAreaPaint={(n, color, ctx, scale) => {
              ctx.fillStyle = color
              ctx.beginPath()
              ctx.arc(n.x ?? 0, n.y ?? 0, (radiusOf(n) + 6) / scale, 0, 2 * Math.PI)
              ctx.fill()
            }}
            linkColor={(l) => (touches(l) ? 'rgba(234,240,255,.95)' : l.kind === 'world' ? 'rgba(160,178,210,.2)' : 'rgba(160,178,210,.6)')}
            linkWidth={(l) => (l.kind === 'world' ? 0.8 : 1.6) + (touches(l) ? 0.8 : 0)}
            linkCanvasObject={paintLinkLabel} linkCanvasObjectMode={(l) => (mode === 'people' && l.label ? 'after' : undefined)}
            enableZoomInteraction={(e) => e.ctrlKey || e.metaKey}
            onNodeHover={(n) => setHover(n?.id)} onNodeClick={(n) => onOpen(n)} onNodeDragEnd={(n) => { n.fx = n.x; n.fy = n.y }}
            onEngineStop={onEngineStop}
          />
        </div>
        {/* role="img"의 자식은 보조기기에서 그림의 일부가 되므로 상태 안내는 캔버스 바깥 형제로, 레이아웃에 영향이 없게 겹쳐 둔다. */}
        <p className="atlas-note"><span role="status">{canvas.status}</span><span className="atlas-hint"> · 노드를 누르면 설정 페이지로 · Ctrl(⌘)+휠로 확대</span></p>
      </div>
      <div className="atlas-foot">
        <MapControls<DetailNode, DetailLink> canvas={canvas} onReplay={replay} />
      </div>
    </>
  )
}

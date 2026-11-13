import { useLayoutEffect, useState } from 'react'
import ForceGraph2D from 'react-force-graph-2d'

import { CANVAS_FONT, LINEAGE_COLORS, aspectGravity, atlasEndpoint, atlasFeatures, nodeRadius, showsLabel, type AtlasLink, type AtlasNode, type WorldAtlas } from '../worldAtlas'
import { MapControls, useMapCanvas } from './useMapCanvas'
import { useNodePointer } from './useNodePointer'
import { useRelayout } from './useRelayout'

// 힘의 세기. 장르 허브는 서로 멀리, 설정 카드는 자기 세계관 곁에 촘촘히 모이게 하고, 파생·조합 선은 약하게 당겨 장르 무리를 흩뜨리지 않으면서 무리 사이를 가로지르게 한다.
// 수치는 데모 26개·카드 108장으로 d3-force를 돌려 골랐다(허브 간격 130 이상, 카드는 세계관에서 평균 26, 세계관 사이 15 이상).
const CHARGE = { genre: -320, world: -110, card: -12 }
const DISTANCE = { genre: 60, card: 18, derive: 70, combine: 70 }
const STRENGTH = { genre: 0.4, card: 0.9, derive: 0.05, combine: 0.05 }

const isLineage = (l: AtlasLink) => l.kind === 'derive' || l.kind === 'combine'

/**
 * 공개 세계관 지도의 캔버스. 노드 이름은 HTML 툴팁(`nodeLabel`) 대신 캔버스에 직접 그린다(툴팁은 문자열을 HTML로 넣는다).
 * 늘 그리는 이름은 장르뿐이고 세계관·카드 이름은 마우스를 올린 노드 하나만 그린다(`showsLabel`, 확대와 연동하지 않는다).
 * 터치 기기에서는 한 손가락 끌기가 페이지 스크롤이 되도록 지도 이동·노드 끌기를 끄고, 올리기가 없으므로 첫 탭에 이름을 보이고 다음 탭에 연다(`useNodePointer`).
 * 장르 칩이 골라지면 그 장르와 이어진 노드만 밝다. 위치는 저장하지 않는다.
 * `atlas`는 ForceGraph가 좌표를 붙이고 링크 끝점을 바꾸는 가변 객체라 화면마다 새로 만든 것을 그대로 넘기고, 읽을 때는 `atlasEndpoint`를 쓴다.
 */
export default function WorldAtlasCanvas({ atlas, lit, onOpen }: { atlas: WorldAtlas; lit?: ReadonlySet<string>; onOpen: (node: AtlasNode) => void }) {
  const canvas = useMapCanvas<AtlasNode, AtlasLink>()
  const { host, graph, width, reduced, paused } = canvas
  const pointer = useNodePointer(showsLabel, onOpen)
  const hover = pointer.shown
  const [height, setHeight] = useState(380)
  const { worlds, derived, combined } = atlas.stats
  const summary = atlasFeatures(atlas).lineage ? `공개 세계관 ${worlds}개가 파생 ${derived}개, 조합 ${combined}개로 이어진 지도` : `공개 세계관 ${worlds}개를 장르별로 모은 지도`
  const { replay, onEngineStop } = useRelayout(canvas, atlas.nodes, 40)

  // 높이는 CSS(데스크톱 380px·모바일 340px)가 정하고 캔버스가 같은 값을 읽는다. 그리기 전에 맞춰 크기가 튀지 않는다.
  useLayoutEffect(() => setHeight(host.current?.clientHeight || 380), [host, width])
  // 데이터가 들어와 예열 틱이 돌기 전에(kapsule은 마운트 1ms 뒤에 반영한다) 힘을 정한다.
  useLayoutEffect(() => {
    const g = graph.current
    g?.d3Force('charge')?.strength((n: AtlasNode) => CHARGE[n.kind])
    g?.d3Force('link')?.distance((l: AtlasLink) => DISTANCE[l.kind]).strength((l: AtlasLink) => STRENGTH[l.kind])
    g?.d3Force('gravity', aspectGravity(() => (host.current?.clientWidth ?? 0) / (host.current?.clientHeight || 1)))
  }, [graph, host])

  // 터치에서 첫 탭으로 이름을 보인 노드(다음 탭에 열린다). 마우스의 올리기는 알리지 않는다.
  const revealed = pointer.coarse ? atlas.nodes.find((n) => n.id === hover) : undefined
  const touchesHover = (l: AtlasLink) => !!hover && (atlasEndpoint(l.source) === hover || atlasEndpoint(l.target) === hover)

  // 가리킨 노드는 장르 칩으로 흐려져 있어도 또렷하게 보인다.
  const alphaOf = (node: AtlasNode) => (lit && !lit.has(node.id) && hover !== node.id ? 0.12 : 1)

  const paintNode = (node: AtlasNode, ctx: CanvasRenderingContext2D, scale: number) => {
    const x = node.x ?? 0
    const y = node.y ?? 0
    const r = nodeRadius(node)
    const alpha = alphaOf(node)
    ctx.globalAlpha = alpha
    if (node.kind !== 'card' && alpha === 1) {
      ctx.shadowColor = node.color
      ctx.shadowBlur = node.kind === 'genre' ? 24 : 10
    }
    ctx.beginPath()
    ctx.arc(x, y, r, 0, 2 * Math.PI)
    ctx.fillStyle = node.color
    ctx.fill()
    ctx.shadowBlur = 0
    if (node.kind !== 'card') {
      ctx.lineWidth = (node.kind === 'genre' ? 2.5 : 1.2) / scale
      ctx.strokeStyle = 'rgba(255,255,255,.85)'
      ctx.stroke()
    }
    if (hover === node.id) {
      ctx.beginPath()
      ctx.arc(x, y, r + 4 / scale, 0, 2 * Math.PI)
      ctx.lineWidth = 1.5 / scale
      ctx.strokeStyle = '#fff'
      ctx.stroke()
    }
    ctx.globalAlpha = 1
  }

  // 이름은 모든 노드를 그린 뒤 한 번에 얹는다. 노드 안에서 그리면 뒤에 그려지는 세계관·장르 원에 가려진다.
  const paintLabels = (ctx: CanvasRenderingContext2D, scale: number) => {
    for (const node of atlas.nodes) {
      if (!showsLabel(node, hover)) continue
      const text = node.name.length > 18 ? `${node.name.slice(0, 17)}…` : node.name
      const x = node.x ?? 0
      const y = (node.y ?? 0) + nodeRadius(node) + 3 / scale
      ctx.globalAlpha = alphaOf(node)
      ctx.font = `700 ${(node.kind === 'genre' ? 14 : node.kind === 'world' ? 12 : 10.5) / scale}px ${CANVAS_FONT}`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'top'
      ctx.lineJoin = 'round'
      ctx.lineWidth = 3 / scale
      ctx.strokeStyle = 'rgba(8,14,27,.9)'
      ctx.strokeText(text, x, y)
      ctx.fillStyle = '#EAF0FF'
      ctx.fillText(text, x, y)
    }
    ctx.globalAlpha = 1
  }

  const linkColor = (l: AtlasLink) => {
    const bright = !lit || (lit.has(atlasEndpoint(l.source)) && lit.has(atlasEndpoint(l.target)))
    if (l.kind === 'derive' || l.kind === 'combine') return bright ? LINEAGE_COLORS[l.kind] : 'rgba(255,255,255,.06)'
    if (!bright) return 'rgba(160,178,210,.04)'
    return l.kind === 'genre' ? 'rgba(160,178,210,.3)' : 'rgba(160,178,210,.17)'
  }

  return (
    <>
      <div className="atlas-view">
        <div ref={host} className="atlas-canvas" role="img" aria-label={summary}>
          <ForceGraph2D<AtlasNode, AtlasLink>
            ref={graph} graphData={atlas} width={width} height={height} backgroundColor="rgba(0,0,0,0)"
            cooldownTicks={paused ? 0 : 240} warmupTicks={reduced ? 270 : 30} minZoom={0.25} maxZoom={8}
            nodeLabel={() => ''} nodeCanvasObject={paintNode} onRenderFramePost={paintLabels}
            nodePointerAreaPaint={(n, color, ctx, scale) => {
              ctx.fillStyle = color
              ctx.beginPath()
              ctx.arc(n.x ?? 0, n.y ?? 0, Math.max(nodeRadius(n) + 2, 7 / scale), 0, 2 * Math.PI)
              ctx.fill()
            }}
            linkColor={linkColor} linkWidth={(l) => (isLineage(l) ? 1.6 : l.kind === 'genre' ? 0.9 : 0.5) + (touchesHover(l) ? 0.8 : 0)}
            linkCurvature={(l) => (isLineage(l) ? 0.16 : 0)} linkLineDash={(l) => (l.kind === 'combine' ? [5, 4] : null)}
            linkDirectionalArrowLength={(l) => (isLineage(l) ? 6 : 0)} linkDirectionalArrowRelPos={0.82}
            enableZoomInteraction={(e) => e.ctrlKey || e.metaKey} {...pointer.graphProps}
            onNodeDragEnd={(n) => { n.fx = n.x; n.fy = n.y }}
            onEngineStop={onEngineStop}
          />
        </div>
        {/* role="img"의 자식은 보조기기에서 그림의 일부가 되므로 상태 안내는 캔버스 바깥 형제로, 레이아웃에 영향이 없게 겹쳐 둔다. 터치에서 첫 탭으로 이름을 보인 노드는 여기서도 알린다(이름이 길어 잘려도 안내는 남게 안내를 앞에 둔다). */}
        <p className="atlas-note">
          <span role="status">{revealed ? `한 번 더 누르면 열려요 · ${revealed.name}` : canvas.status}</span>
          <span className="atlas-hint">{pointer.coarse ? ' · 노드를 누르면 이름, 한 번 더 누르면 열려요 · 화살표 버튼으로 지도 이동' : ' · 노드에 올리면 이름 · Ctrl(⌘)+휠로 확대'}</span>
        </p>
      </div>
      <div className="atlas-foot">
        <MapControls<AtlasNode, AtlasLink> canvas={canvas} onReplay={replay} />
      </div>
    </>
  )
}

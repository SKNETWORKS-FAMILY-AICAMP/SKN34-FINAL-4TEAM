// @vitest-environment jsdom
import { render, cleanup } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { newSetting } from '../../../../domain/entities/studioWorld'
import { useWorldMapViewModel, type MapNode } from '../viewmodel/useWorldMapViewModel'
import WorldMapCanvas from './WorldMapCanvas'

vi.mock('react-force-graph-2d',()=>({default:({graphData,nodeCanvasObject}:{graphData:{nodes:MapNode[]};nodeCanvasObject:(n:MapNode,c:CanvasRenderingContext2D,s:number)=>void})=>{
 const context={canvas:document.createElement('canvas'),beginPath(){},arc(){},fill(){},fillText(){}} as unknown as CanvasRenderingContext2D
 nodeCanvasObject(graphData.nodes[0],context,1)
 return <div>canvas initialized</div>
}}))
afterEach(()=>{cleanup();vi.unstubAllGlobals()})
it('can paint during graph initialization before the host ref is attached',()=>{
 vi.stubGlobal('ResizeObserver',class{observe(){}disconnect(){}})
 function Harness(){const vm=useWorldMapViewModel([newSetting('people')]);return <WorldMapCanvas vm={vm}/>}
 expect(()=>render(<Harness/>)).not.toThrow()
})

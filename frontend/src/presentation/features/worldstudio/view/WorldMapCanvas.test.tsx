// @vitest-environment jsdom
import { render, cleanup } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { newSetting } from '../../../../domain/entities/studioWorld'
import { useWorldMapViewModel, type MapLink, type MapNode } from '../viewmodel/useWorldMapViewModel'
import WorldMapCanvas from './WorldMapCanvas'

const callbacks=vi.hoisted(()=>({current:null as null | {linkCurvature:(l:MapLink)=>number;linkDirectionalArrowLength:(l:MapLink)=>number}}))
vi.mock('react-force-graph-2d',()=>({default:({graphData,nodeCanvasObject,linkCurvature,linkDirectionalArrowLength}:{graphData:{nodes:MapNode[]};nodeCanvasObject:(n:MapNode,c:CanvasRenderingContext2D,s:number)=>void;linkCurvature:(l:MapLink)=>number;linkDirectionalArrowLength:(l:MapLink)=>number})=>{
 callbacks.current={linkCurvature,linkDirectionalArrowLength}
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

it('supplies curvature and static arrows only for directional character relationships',()=>{
 vi.stubGlobal('ResizeObserver',class{observe(){}disconnect(){}})
 vi.stubGlobal('matchMedia',()=>({matches:true,addEventListener(){},removeEventListener(){}}))
 function Harness(){const vm=useWorldMapViewModel([newSetting('people')]);return <WorldMapCanvas vm={vm}/>}
 render(<Harness/>)
 const directional:MapLink={source:'a',target:'b',label:'신뢰',symmetric:false,curve:.35}
 const symmetric:MapLink={...directional,symmetric:true}
 const generic:MapLink={source:'a',target:'b',label:'관련 설정'}
 expect(callbacks.current?.linkCurvature(directional)).toBe(.35)
 expect(callbacks.current?.linkDirectionalArrowLength(directional)).toBeGreaterThan(0)
 expect(callbacks.current?.linkDirectionalArrowLength(symmetric)).toBe(0)
 expect(callbacks.current?.linkDirectionalArrowLength(generic)).toBe(0)
 expect(callbacks.current?.linkCurvature(generic)).toBe(0)
})

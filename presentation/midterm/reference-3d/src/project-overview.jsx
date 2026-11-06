import React,{useEffect,useRef} from 'react';
import {createRoot} from 'react-dom/client';
import ForceGraph3D from 'react-force-graph-3d';
import * as THREE from 'three';
import {bloomRenderer,glow,lightStream,dust} from './cinematic.js';

const W=920,H=680;
const colors={hub:'#e8d7ff',story:'#ac8cff',world:'#59d9e8',ai:'#eb9edf'};
const entries=[
 ['hub','STORYFORK','hub',0,0,26],
 ['work','원작','story',-99,36,-1], ['episode','회차','story',-107,-29,17],
 ['version','저장 버전','story',-58,-78,4], ['fork','Fork 작품','story',9,-84,-10],
 ['world','세계관','world',16,64,-12], ['person','인물','world',-53,97,-44],
 ['place','장소','world',78,102,-41], ['event','사건','world',120,49,-42],
 ['studio','집필실','ai',70,-15,15], ['ai','AI 제안','ai',118,-67,-23],
 ['review','작가 검토','ai',126,-6,-47]
];
const nodes=entries.map(([id,label,type,x,y,z])=>({id,label,type,x,y,z,fx:x,fy:y,fz:z}));
const links=[
 ['hub','work'],['hub','world'],['hub','studio'],['work','episode'],['episode','version'],
 ['episode','fork'],['version','fork'],['fork','studio'],['studio','version'],['world','person'],
 ['world','place'],['world','event'],['world','ai'],['studio','ai'],['ai','review'],['review','studio']
].map(([a,b])=>({source:a,target:b}));
const graph={nodes,links};
function orb(n){
 const group=new THREE.Group(),r=n.id==='hub'?3.7:2.3,color=colors[n.type];
 group.add(new THREE.Mesh(new THREE.SphereGeometry(r,24,16),new THREE.MeshBasicMaterial({color:new THREE.Color(color).multiplyScalar(2.6)})));
 group.add(glow(color,n.id==='hub'?43:24,.95));return group;
}
function drawLabels(camera){
 nodes.forEach(n=>{const point=new THREE.Vector3(n.x,n.y,n.z).project(camera),el=document.getElementById('n-'+n.id);
 el.style.left=((point.x+1)*W*.5)+'px';el.style.top=((1-point.y)*H*.5+(n.id==='hub'?17:10))+'px';});
}
function Graph(){const ref=useRef(null);
 useEffect(()=>{const timer=setInterval(()=>{const fg=ref.current;
 if(!fg?.scene()||!(links[0].__lineObj?.scale.z>1))return;
 clearInterval(timer);fg.pauseAnimation();
 fg.cameraPosition({x:23,y:13,z:278},{x:8,y:4,z:0},0);
 const camera=fg.camera();camera.fov=48;camera.updateProjectionMatrix();camera.updateMatrixWorld(true);
 const scene=fg.scene(),renderer=fg.renderer(),render=bloomRenderer(renderer,scene,camera,W,H,1.05);
 scene.background=new THREE.Color('#111021');dust(scene,480,2300)(1.4);
 for(const [j,l] of links.entries()){
  const a=l.source,b=l.target;
  const curve=new THREE.LineCurve3(new THREE.Vector3(a.x,a.y,a.z),new THREE.Vector3(b.x,b.y,b.z));
  lightStream(scene,curve,{color:colors[b.type],width:1.35,fibers:6,particles:57,seed:j+1}).update(2.3,1,.85);
 }
 for(let k=0;k<2;k++){const curve=new THREE.CatmullRomCurve3(Array.from({length:13},(_,j)=>new THREE.Vector3(-250+j*42,Math.sin(j*.62+k*.7)*24-2,-80-k*8)));lightStream(scene,curve,{color:k?'#7951ba':'#4167ae',width:6,fibers:11,particles:300}).update(2.3,1,.33);}
 render();drawLabels(camera);window.projectGraphReady=true;
 },100);return()=>clearInterval(timer)},[]);
 return <><ForceGraph3D ref={ref} width={W} height={H} graphData={graph} nodeThreeObject={orb} linkWidth={.5} linkColor={()=>'#9294ef'} linkOpacity={.52} showNavInfo={false} enableNavigationControls={false} enableNodeDrag={false} warmupTicks={1} cooldownTicks={1}/>{nodes.map(n=><span key={n.id} id={'n-'+n.id} className={n.id==='hub'?'hub':''}>{n.label}</span>)}</>;
}
document.fonts.load('600 22px Local').then(()=>createRoot(document.getElementById('root')).render(<Graph/>));

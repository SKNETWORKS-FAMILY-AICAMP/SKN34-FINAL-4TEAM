import React, {useEffect,useRef,useState} from 'react';
import {createRoot} from 'react-dom/client';
import ForceGraph3D from 'react-force-graph-3d';
import * as THREE from 'three';
import SpriteText from 'three-spritetext';
import {nodes,links,palette,ease} from './data';
import './style.css';
import {bloomRenderer,glow,lightStream,dust} from './cinematic';

const params=new URLSearchParams(location.search);
const mode=params.get('scene')==='fork'?'fork':'graph';
const duration=mode==='graph'?14:11;
const exportMode=params.has('export');
const W=1920,H=1080;
const nodeObjects=new Map();
const graphData={nodes:nodes.map(n=>({...n})),links:links.map(l=>({...l}))};
const nearby=new Set(['gildong',...links.filter(l=>l.source==='gildong'||l.target==='gildong').map(l=>l.source==='gildong'?l.target:l.source)]);

function nodeObject(n){
 const g=new THREE.Group(); const color=palette[n.type];
 const ball=new THREE.Mesh(new THREE.SphereGeometry(n.id==='gildong'?3.6:2.1,24,16),new THREE.MeshBasicMaterial({color:new THREE.Color(color).multiplyScalar(2.5),transparent:true}));g.add(ball);
 const halo=glow(color,n.id==='gildong'?75:48,1);g.add(halo);
 const label=new SpriteText(n.label,8.4,'#f3f2ff');label.fontFace='Presentation, Malgun Gothic, sans-serif';label.fontWeight='600';label.backgroundColor='#101032';label.padding=[3,1.6];label.borderRadius=2;label.position.y=-15;label.layers.set(1);g.add(label);
 nodeObjects.set(n.id,{g,ball,halo,label});return g;
}
function GraphImpl({onReady}){
 const ref=useRef();
 useEffect(()=>{let timer=setInterval(()=>{const fg=ref.current;if(!fg?.scene() || !(graphData.links[0]?.__lineObj?.scale.z>2))return;clearInterval(timer);
  fg.pauseAnimation();const animateDust=dust(fg.scene(),800,3500);window.debugGraph=fg;
  const renderer=fg.renderer();renderer.setPixelRatio(1);
  const render=bloomRenderer(renderer,fg.scene(),fg.camera(),1290,820,1.25);
  const streams=graphData.links.map(l=>{const a=l.source,b=l.target;const curve=new THREE.LineCurve3(new THREE.Vector3(a.x,a.y,a.z),new THREE.Vector3(b.x,b.y,b.z));return {active:a.id==='gildong'||b.id==='gildong',fx:lightStream(fg.scene(),curve,{color:palette[b.type],width:4.5,fibers:9,particles:95,speed:.16})};});
  const ribbons=[];
  for(let k=0;k<3;k++){const curve=new THREE.CatmullRomCurve3(Array.from({length:11},(_,i)=>new THREE.Vector3(-430+i*86,Math.sin(i*.65+k*.7)*75-10,-170+k*22)));ribbons.push(lightStream(fg.scene(),curve,{color:k===1?'#4581ed':'#8746db',width:14,fibers:14,particles:600,speed:.06}));}

  window.drawScene=t=>{
   const focus=ease((t-3)/6);const drift=Math.sin(t*.18)*32*(1-focus);
   fg.cameraPosition({x:75*(1-focus)+drift,y:35*(1-focus)+8,z:560-180*focus},{x:-5,y:0,z:0},0);
   for(const [id,o] of nodeObjects){const opacity=nearby.has(id)?1:1-focus*.82;o.ball.material.opacity=opacity;o.halo.material.opacity=(.85+.15*Math.sin(t*1.6))*opacity;o.label.material.opacity=opacity;}
   // Render the actual react-force-graph Three.js scene at an explicit movie time.
   fg.scene().traverse(o=>{if(o.__graphObjType==='link'&&o.__data){const l=o.__data;const a=typeof l.source==='object'?l.source.id:l.source;const b=typeof l.target==='object'?l.target.id:l.target;const active=a==='gildong'||b==='gildong';if(o.material){o.material.transparent=true;o.material.opacity=active?.45+.5*focus:.35-.26*focus;}}});
   streams.forEach(s=>s.fx.update(t,1,s.active?.75+.25*focus:.55-.39*focus));ribbons.forEach(s=>s.update(t,1,.18));animateDust(t);render();
  };window.drawScene(0);onReady();
 },100);return()=>clearInterval(timer);},[]);
 return <div className="graph-space"><ForceGraph3D ref={ref} width={1290} height={820} graphData={graphData} nodeThreeObject={nodeObject} nodeLabel="" backgroundColor="#00000000" showNavInfo={false} enableNavigationControls={false} enableNodeDrag={false} warmupTicks={1} cooldownTicks={1} linkColor={l=>(l.source.id||l.source)==='gildong'||(l.target.id||l.target)==='gildong'?'#8fbfff':'#554d8b'} linkWidth={l=>(l.source.id||l.source)==='gildong'||(l.target.id||l.target)==='gildong'?1.1:.45} linkOpacity={.6}/></div>;
}

const Graph=React.memo(GraphImpl,()=>true);
function ForkImpl({onReady}){
 const host=useRef();
 useEffect(()=>{
  const scene=new THREE.Scene();const camera=new THREE.PerspectiveCamera(35,W/H,.1,200);camera.position.set(0,4,35);camera.lookAt(0,0,0);
  const renderer=new THREE.WebGLRenderer({antialias:true,alpha:true,preserveDrawingBuffer:true});renderer.setSize(W,H);renderer.setPixelRatio(1);host.current.appendChild(renderer.domElement);const animateDust=dust(scene,60,3000);const render=bloomRenderer(renderer,scene,camera,W,H,1.4);
  const original=new THREE.CatmullRomCurve3([new THREE.Vector3(-14,-.3,0),new THREE.Vector3(-8,0,0),new THREE.Vector3(-2,.3,0),new THREE.Vector3(5,0,0),new THREE.Vector3(14,.5,0)]);
  const pA=original.getPoint(.32),pB=original.getPoint(.54);
  const branch=(p,y,z)=>new THREE.CatmullRomCurve3([p.clone(),p.clone().add(new THREE.Vector3(2,y*.15,z*.4)),new THREE.Vector3(6,y,z),new THREE.Vector3(14,y+.3,z*.7)]);
  const curves=[original,branch(pA,4.1,-2.5),branch(pB,-4.1,2.5)];const colors=['#839aff','#c19aff','#58dbef'];
  const paths=curves.map((curve,i)=>{
   const stream=lightStream(scene,curve,{color:colors[i],width:i===0?.65:.48,fibers:76,particles:3200,seed:i+1,speed:.07+i*.015});
   const head=glow('#d9ecff',2.5,1.2);scene.add(head);return {stream,head,curve};
  });
  const junctions=[pA,pB].map((p,i)=>{const group=new THREE.Group();group.position.copy(p);group.add(glow(colors[i+1],2.6,.85));const core=glow('#eff9ff',.65,.9);group.add(core);const streak=glow(colors[i+1],1,.55);streak.scale.set(7,.18,1);group.add(streak);scene.add(group);return group;});
  const anchors={original:new THREE.Vector3(11,2.1,0),a:new THREE.Vector3(10,6.2,-2),b:new THREE.Vector3(10,-6.2,2),ep2:pA.clone().add(new THREE.Vector3(0,-1.1,0)),ep3:pB.clone().add(new THREE.Vector3(.4,-1.6,0))};
  window.drawScene=t=>{
   camera.position.set(Math.sin(t*.14)*.7,4-t*.08,35);camera.lookAt(0,0,0);
   paths.forEach((p,i)=>{const start=[0,2.7,4.4][i];const progress=ease((t-start)/[4,4.8,4.8][i]);p.stream.update(t,progress,1);p.head.visible=progress>0&&progress<1;p.head.position.copy(p.curve.getPoint(progress));});
   junctions.forEach((j,i)=>{j.visible=t>[2.7,4.4][i];j.scale.setScalar(1+Math.sin(t*2-i)*.12);});
   Object.entries(anchors).forEach(([id,p])=>{const v=p.clone().project(camera);const e=document.getElementById(id);if(e){e.style.left=`${(v.x+1)*W/2}px`;e.style.top=`${(1-v.y)*H/2}px`;}});
   animateDust(t);render();
  };window.drawScene(0);onReady();return()=>renderer.dispose();
 },[]);
 return <div className="fork-space" ref={host}/>;
}

const Fork=React.memo(ForkImpl,()=>true);
function App(){
 const [ready,setReady]=useState(false);const [time,setTime]=useState(0);const clockRef=useRef(0);const [playing,setPlaying]=useState(!exportMode);
 useEffect(()=>{const fit=()=>{document.documentElement.style.setProperty('--scale',Math.min(innerWidth/W,innerHeight/H));};fit();addEventListener('resize',fit);return()=>removeEventListener('resize',fit);},[]);
 useEffect(()=>{if(!ready)return;window.renderAt=async t=>{clockRef.current=Math.max(0,Math.min(duration,t));setTime(clockRef.current);await new Promise(requestAnimationFrame);window.drawScene(clockRef.current);await new Promise(requestAnimationFrame);return {time:clockRef.current,mode};};window.presentationReady=true;},[ready]);
 useEffect(()=>{if(!ready||!playing)return;let frame;let previous;const loop=now=>{if(previous){clockRef.current=(clockRef.current+(now-previous)/1000)%duration;}previous=now;setTime(clockRef.current);window.drawScene(clockRef.current);frame=requestAnimationFrame(loop);};frame=requestAnimationFrame(loop);return()=>cancelAnimationFrame(frame);},[ready,playing]);
 return <>
 <main className="stage" aria-label="STORYFORK 발표 영상">
  <header><span className="wordmark">STORYFORK<span className="mark">/</span></span><span className="prototype">발표용 시각화 프로토타입 · 실제 서비스 화면 아님</span></header>
  {mode==='graph'?<>
   <Graph onReady={()=>setReady(true)}/>
   <section className="intro"><h1>이야기의 관계가<br/>하나의 세계로.</h1><p>홍길동전의 인물과 사건을<br/>입체적인 맥락으로 연결합니다.</p></section>
   <section className="focus"><div className="focus-line"/><h2>{time<5?'홍길동전':'홍길동을 중심으로'}</h2><p>{time<5?'전체 맥락에서 인물의 이야기로':'부모 · 탄생 · 신분의 갈등 · 모자 대화'}</p><div className="relations"><span>홍문 <b>부친</b></span><span>춘섬 <b>모친</b></span></div><small>로컬 입력 원문 1–2회차에 근거한 관계<br/>후속 조직 가입·왕위 관계는 표시하지 않음</small></section>
   <div className="legend">{Object.entries({world:'세계관',person:'인물',place:'장소',organization:'조직',event:'사건'}).map(([k,v])=><span key={k}><i style={{background:palette[k]}}/>{v}</span>)}</div>
  </>:<>
   <Fork onReady={()=>setReady(true)}/>
   <section className="intro fork-intro"><h1>하나의 원작,<br/>서로 다른 다음 이야기.</h1><p>허용된 회차에서 시작해, 각자의 시간선으로.</p></section>
   <div className="path-label original" id="original" style={{opacity:ease((time-2)/1)}}>원작 <small>계속되는 원래 이야기</small></div>
   <div className="path-label a" id="a" style={{opacity:ease((time-5.7)/1)}}>Fork A <small>독립적으로 이어지는 전개</small></div>
   <div className="path-label b" id="b" style={{opacity:ease((time-7)/1)}}>Fork B <small>또 하나의 독립된 전개</small></div>
   <div className="episode" id="ep2" style={{opacity:ease((time-2.7)/.6)}}>EP.02 <span>Fork 허용</span></div>
   <div className="episode" id="ep3" style={{opacity:ease((time-4.4)/.6)}}>EP.03 <span>Fork 허용</span></div>
   <div className="fork-note">원작에서만 분기 <span>·</span> 분기 이후 독립 진행 <span>·</span> 재Fork 없음</div>
  </>}
  <footer><span>{mode==='graph'?'연결: 원문 근거 · 주변 입자와 리본: 장식 연출':'EP.02 · EP.03 허용은 발표용 설정 예시 · 실제 작품의 권한 설정과 무관'}</span><span>{mode==='graph'?'WORLD KNOWLEDGE GRAPH':'FORK TIMELINE'}</span></footer>
  <div className="progress" style={{width:`${time/duration*100}%`}}/>
 </main>
 {!exportMode&&<nav className="controls"><a href="?scene=graph">지식 그래프</a><a href="?scene=fork">Fork 시간선</a><button onClick={()=>setPlaying(v=>!v)}>{playing?'일시 정지':'재생'}</button><button onClick={()=>{clockRef.current=0;window.renderAt?.(0);}}>처음부터</button><span>{time.toFixed(1)} / {duration}s</span></nav>}
 </>;
}
document.fonts.load('600 20px Presentation').then(()=>createRoot(document.getElementById('root')).render(<App/>));

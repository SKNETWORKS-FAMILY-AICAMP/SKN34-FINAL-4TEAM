import * as THREE from 'three';
import {EffectComposer} from 'three/addons/postprocessing/EffectComposer.js';
import {RenderPass} from 'three/addons/postprocessing/RenderPass.js';
import {UnrealBloomPass} from 'three/addons/postprocessing/UnrealBloomPass.js';
import {OutputPass} from 'three/addons/postprocessing/OutputPass.js';

export function bloomRenderer(renderer,scene,camera,w,h,strength=1.05){
 scene.background=new THREE.Color('#060b24');
 renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=.8;
 const composer=new EffectComposer(renderer);composer.setSize(w,h);
 composer.addPass(new RenderPass(scene,camera));
 composer.addPass(new UnrealBloomPass(new THREE.Vector2(w,h),strength*.85,.55,.40));
 composer.addPass(new OutputPass());
 return ()=>{
  camera.layers.set(0);composer.render();
  const background=scene.background;scene.background=null;
  renderer.autoClear=false;renderer.clearDepth();camera.layers.set(1);renderer.render(scene,camera);
  camera.layers.set(0);renderer.autoClear=true;scene.background=background;
 };
}

let glowTexture;
export function glow(color,size,opacity=.8){
 if(!glowTexture){const c=document.createElement('canvas');c.width=c.height=128;const ctx=c.getContext('2d');const g=ctx.createRadialGradient(64,64,0,64,64,64);g.addColorStop(0,'rgba(255,255,255,1)');g.addColorStop(.08,'rgba(255,255,255,.96)');g.addColorStop(.22,'rgba(255,255,255,.3)');g.addColorStop(.5,'rgba(255,255,255,.05)');g.addColorStop(1,'rgba(255,255,255,0)');ctx.fillStyle=g;ctx.fillRect(0,0,128,128);glowTexture=new THREE.CanvasTexture(c);}
 const s=new THREE.Sprite(new THREE.SpriteMaterial({map:glowTexture,color,transparent:true,opacity,blending:THREE.AdditiveBlending,depthWrite:false}));s.scale.set(size,size,1);return s;
}

// Decorative fibers follow a single semantic path; they never create new endpoints.
export function lightStream(scene,curve,{color='#97aaff',width=.25,fibers=48,particles=1400,seed=1,speed=.12}={}){
 const group=new THREE.Group();scene.add(group);const uniforms={uTime:{value:0},uProgress:{value:1},uOpacity:{value:1},uColor:{value:new THREE.Color(color)}};
 const segments=220;
 const vertex=`attribute float along; attribute float strand; varying float vAlong; varying float vStrand; void main(){vAlong=along;vStrand=strand;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`;
 const fragment=`uniform float uTime;uniform float uProgress;uniform float uOpacity;uniform vec3 uColor;varying float vAlong;varying float vStrand;void main(){if(vAlong>uProgress)discard;float pulse=pow(.5+.5*sin(vAlong*48.-uTime*3.+vStrand),8.);float flicker=.6+.4*sin(vAlong*130.+uTime*1.3+vStrand);gl_FragColor=vec4(uColor*(1.15+pulse*.3),(.20+pulse*.08)*uOpacity*flicker);}`;
 const material=new THREE.ShaderMaterial({uniforms,vertexShader:vertex,fragmentShader:fragment,transparent:true,depthWrite:false,blending:THREE.AdditiveBlending});
 for(let j=0;j<fibers;j++){
  const positions=[],along=[];const phase=j*2.39996+seed;
  for(let i=0;i<=segments;i++){
   const u=i/segments,p=curve.getPoint(u);const envelope=Math.pow(Math.sin(Math.PI*u),.65);const radius=width*(.2+.8*(j/fibers))*envelope;
   p.y+=radius*(Math.sin(u*17+phase)+.3*Math.sin(u*63+phase*2));
   p.z+=radius*(Math.cos(u*15+phase)+.25*Math.cos(u*47+phase));
   positions.push(...p.toArray());along.push(u);
  }
  const geo=new THREE.BufferGeometry();geo.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));geo.setAttribute('along',new THREE.Float32BufferAttribute(along,1));geo.setAttribute('strand',new THREE.Float32BufferAttribute(Array(segments+1).fill(phase),1));group.add(new THREE.Line(geo,material));
 }
 const positions=new Float32Array(particles*3),ages=new Float32Array(particles),sizes=new Float32Array(particles);
 for(let i=0;i<particles;i++){ages[i]=i/particles;sizes[i]=1+(Math.sin(i*71.71)*.5+.5)*2;}
 const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.BufferAttribute(positions,3));geometry.setAttribute('along',new THREE.BufferAttribute(ages,1));geometry.setAttribute('size',new THREE.BufferAttribute(sizes,1));
 const pointMaterial=new THREE.ShaderMaterial({uniforms,transparent:true,depthWrite:false,blending:THREE.AdditiveBlending,vertexShader:`attribute float along;attribute float size;varying float vAlong;void main(){vAlong=along;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);gl_PointSize=size;}`,fragmentShader:`uniform float uProgress;uniform float uOpacity;uniform vec3 uColor;varying float vAlong;void main(){if(vAlong>uProgress)discard;float r=length(gl_PointCoord-.5)*2.;float a=pow(max(0.,1.-r),2.);gl_FragColor=vec4(uColor*1.7,a*.7*uOpacity);}`});
 group.add(new THREE.Points(geometry,pointMaterial));
 // Sample once; deterministic per-frame lookup keeps export fast.
 const samples=Array.from({length:1001},(_,i)=>curve.getPoint(i/1000));
 return {group,uniforms,update(t,progress=1,opacity=1){
  uniforms.uTime.value=t;uniforms.uProgress.value=progress;uniforms.uOpacity.value=opacity;
  for(let i=0;i<particles;i++){
   const u=(i/particles+t*speed)%1,p=samples[Math.floor(u*1000)];const envelope=Math.pow(Math.sin(Math.PI*u),.5);const r=width*(.3+(Math.sin(i*17.31)*.5+.5)*1.8)*envelope;const a=i*2.39996+t*.15;
   positions[i*3]=p.x;positions[i*3+1]=p.y+Math.sin(a)*r;positions[i*3+2]=p.z+Math.cos(a)*r;ages[i]=u;
  }
  geometry.attributes.position.needsUpdate=true;geometry.attributes.along.needsUpdate=true;
 }};
}

export function dust(scene,spread,count=2200){
 const p=[],c=[];for(let i=0;i<count;i++){const rand=n=>{const s=Math.sin(i*127.1+n*311.7)*43758.5453;return s-Math.floor(s);};p.push((rand(1)-.5)*spread*2,(rand(2)-.5)*spread,-rand(3)*spread);const color=new THREE.Color(i%3?'#6578bc':'#a775d7');c.push(color.r,color.g,color.b);}
 const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(p,3));g.setAttribute('color',new THREE.Float32BufferAttribute(c,3));const points=new THREE.Points(g,new THREE.PointsMaterial({size:spread/1800,vertexColors:true,transparent:true,opacity:.5,blending:THREE.AdditiveBlending,depthWrite:false}));scene.add(points);return t=>{points.rotation.z=t*.003;};
}

import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
const browser=await chromium.launch({channel:'chrome',headless:true});
const page=await browser.newPage({viewport:{width:1920,height:1080}});
const errors=[];page.on('pageerror',e=>errors.push(String(e)));
const report={};
try{
 await page.goto('http://127.0.0.1:5186/?scene=graph');await page.waitForFunction(()=>window.presentationReady);
 await page.getByRole('button',{name:'일시 정지',exact:true}).click();assert(await page.getByRole('button',{name:'재생',exact:true}).isVisible());
 await page.getByRole('button',{name:'처음부터',exact:true}).click();await page.waitForFunction(()=>document.querySelector('.controls span').textContent.startsWith('0.0'));
 report.controls={pause:true,restart:true};
 await page.getByRole('button',{name:'재생',exact:true}).click();await page.waitForFunction(()=>parseFloat(document.querySelector('.controls span').textContent)>.2);report.controls.resume=true;
 await page.getByRole('button',{name:'일시 정지',exact:true}).click();
 report.graph=[];
 for(const t of [0,3,7,11,14]){
  await page.evaluate(t=>window.renderAt(t),t);
  const result=await page.evaluate(()=>{
   const fg=window.debugGraph;const camera=fg.camera();camera.updateMatrixWorld();const list=[];let links=0;
   fg.scene().traverse(o=>{
    if(o.__graphObjType==='link'&&o.scale.z>2)links++;
    if(o.isSprite&&o.text){const center=o.position.clone();o.getWorldPosition(center);center.project(camera);const size=o.scale.clone();const origin=o.position.clone();o.getWorldPosition(origin);const right=origin.clone();right.x+=size.x/2;right.project(camera);const extent=Math.abs(right.x-center.x);list.push({label:o.text,opacity:o.material.opacity,inside:Math.abs(center.x)+extent<1&&Math.abs(center.y)<.95});}
   });return {links,labels:list};
  });assert.equal(result.links,20);assert(result.labels.every(n=>n.inside),'Graph label outside canvas');report.graph.push({time:t,...result});
 }
 await page.getByRole('link',{name:'Fork 시간선',exact:true}).click();await page.waitForFunction(()=>window.presentationReady);assert(await page.getByRole('heading',{name:/하나의 원작/}).isVisible());report.controls.sceneSwitch=true;
 report.errors=errors;assert.equal(errors.length,0);
 await fs.writeFile('renders/browser-check.json',JSON.stringify(report,null,2));console.log('PASS: pause / resume / restart / scene switch; 20 rendered edges; graph labels stay in frame at five timestamps; no page errors.');
}finally{await browser.close();}

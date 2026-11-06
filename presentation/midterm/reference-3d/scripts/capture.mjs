import {chromium} from 'playwright';
import fs from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
const qa=process.argv.includes('--qa');
const browser=await chromium.launch({channel:process.env.BROWSER_CHANNEL||'chrome',headless:true,args:['--enable-webgl','--ignore-gpu-blocklist']});
const page=await browser.newPage({viewport:{width:1920,height:1080},deviceScaleFactor:1});
const errors=[];page.on('pageerror',e=>errors.push(String(e)));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
await fs.mkdir('renders',{recursive:true});
const report={resolution:[1920,1080],fps:30,mode:qa?'QA screenshots':'deterministic frames',scenes:{},errors};
try{
 for(const [scene,duration] of [['graph',14],['fork',11]]){
  await page.goto(`http://127.0.0.1:5186/?scene=${scene}&export=1`);await page.waitForFunction(()=>window.presentationReady);await page.evaluate(()=>document.fonts.ready);
  const samples=scene==='graph'?[0,4,9,13.9667]:[0,3,6,10.9667];
  for(const t of samples){await page.evaluate(t=>window.renderAt(t),t);await page.screenshot({path:`renders/${scene}-${t.toFixed(1)}s.png`});}
  await page.evaluate(t=>window.renderAt(t),scene==='graph'?11:10.5);await page.screenshot({path:`renders/${scene}-poster.png`});
  const bounds=await page.locator('header,.intro,.focus,.legend,footer,.fork-note,.path-label,.episode').evaluateAll(elements=>elements.map(e=>{const b=e.getBoundingClientRect();return {text:e.textContent,visible:getComputedStyle(e).opacity!=='0',x:b.x,y:b.y,width:b.width,height:b.height,inside:b.x>=0&&b.y>=0&&b.right<=1920&&b.bottom<=1080};}));
  const perf=await page.evaluate(async()=>{let previous;const intervals=[];for(let i=0;i<121;i++){const now=await new Promise(requestAnimationFrame);if(previous)intervals.push(now-previous);previous=now;window.drawScene(i/30);}intervals.sort((a,b)=>a-b);return {meanFps:1000/(intervals.reduce((a,b)=>a+b,0)/intervals.length),p95FrameMs:intervals[Math.floor(intervals.length*.95)],renderer:document.querySelector('canvas').getContext('webgl2')?.getParameter(7937)};});
  report.scenes[scene]={duration,bounds,perf};console.log(scene,JSON.stringify(perf));
  if(!qa){
   const encoder=spawn('ffmpeg',['-y','-hide_banner','-loglevel','error','-f','image2pipe','-vcodec','png','-r','30','-i','pipe:0','-an','-c:v','libx264','-preset','medium','-crf','18','-pix_fmt','yuv420p','-movflags','+faststart',`renders/${scene}.mp4`],{stdio:['pipe','inherit','inherit']});
   const finished=once(encoder,'close');
   for(let i=0;i<duration*30;i++){
    await page.evaluate(t=>window.renderAt(t),i/30);const buffer=await page.screenshot();if(!encoder.stdin.write(buffer))await once(encoder.stdin,'drain');
    if(i%90===0)console.log(`${scene}: frame ${i}/${duration*30}`);
   }
   encoder.stdin.end();const [code]=await finished;if(code!==0)throw Error(`ffmpeg exited ${code}`);
  }
 }
}finally{await fs.writeFile(`renders/${qa?'qa':'capture'}-report.json`,JSON.stringify(report,null,2));await browser.close();}
if(errors.length)throw Error(errors.join('\n'));
if(Object.values(report.scenes).some(s=>s.bounds.some(b=>b.visible&&!b.inside)))throw Error('Text outside frame');
console.log('Finished: renders/');

import {chromium} from 'playwright';
import fs from 'node:fs/promises';
const b=await chromium.launch({channel:'chrome',headless:true});
const p=await b.newPage();
await p.goto('http://127.0.0.1:5186/');
const result={};
for(const scene of ['graph','fork'])result[scene]=await p.evaluate(async name=>{
 const v=document.createElement('video');v.src=`/renders/${name}.mp4`;v.muted=true;document.body.append(v);
 await new Promise((resolve,reject)=>{v.onloadeddata=resolve;v.onerror=()=>reject(Error('Video decode error'));});
 await v.play();await new Promise(resolve=>v.requestVideoFrameCallback(resolve));v.pause();
 const out={width:v.videoWidth,height:v.videoHeight,duration:v.duration,played:true,readyState:v.readyState};v.remove();return out;
},scene);
await fs.writeFile('renders/video-playback.json',JSON.stringify(result,null,2));console.log(result);await b.close();

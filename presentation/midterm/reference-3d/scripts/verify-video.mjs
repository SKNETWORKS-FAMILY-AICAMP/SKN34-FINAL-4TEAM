import {spawnSync} from 'node:child_process';
import fs from 'node:fs';
import assert from 'node:assert/strict';
const run=(command,args)=>{const r=spawnSync(command,args,{encoding:'utf8',maxBuffer:20*1024*1024});if(r.error)throw r.error;assert.equal(r.status,0,r.stderr);return r.stdout;};
const result={};
for(const [scene,duration] of [['graph',14],['fork',11]]){
 const file=`renders/${scene}.mp4`;
 const data=JSON.parse(run('ffprobe',['-v','error','-count_frames','-show_entries','stream=codec_name,width,height,pix_fmt,r_frame_rate,nb_read_frames,duration:format=duration,size','-of','json',file]));
 const s=data.streams[0];assert.equal(s.codec_name,'h264');assert.equal(s.width,1920);assert.equal(s.height,1080);assert.equal(s.pix_fmt,'yuv420p');assert.equal(s.r_frame_rate,'30/1');assert.equal(+s.nb_read_frames,duration*30);assert(Math.abs(+data.format.duration-duration)<.01);
 run('ffmpeg',['-v','error','-i',file,'-f','null','-']);
 const md5=run('ffmpeg',['-v','error','-i',file,'-f','framemd5','-']).split('\n').filter(l=>l&&!l.startsWith('#')).map(l=>l.split(',').at(-1).trim());
 assert(new Set(md5).size>duration*25,'Unexpectedly repeated/frozen frames');
 for(const t of [0,duration/2,duration-1/30])run('ffmpeg',['-y','-v','error','-ss',String(t),'-i',file,'-frames:v','1',`renders/${scene}-decoded-${t.toFixed(2)}.png`]);
 result[scene]={...data,decodedWithoutErrors:true,uniqueFrames:new Set(md5).size,bytes:fs.statSync(file).size};
}
fs.writeFileSync('renders/encoding-report.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));

// 격리 브라우저 QA 전용. 인증 토큰/비밀번호/쿠키는 기록하지 않는다.
import {defineConfig,mergeConfig} from 'vite'
import base from './vite.config'
import {appendFileSync,mkdirSync,readFileSync} from 'node:fs'
import {resolve} from 'node:path'
export default defineConfig(async env=>mergeConfig(await (typeof base==='function'?base(env):base),{
 plugins:[{name:'qa-http-evidence',transformIndexHtml(){return [{tag:'div',attrs:{style:'position:fixed;bottom:0;right:0;z-index:99999;background:#fff2cc;padding:8px;font:14px sans-serif'},children:'격리 QA · AI 예시 대역 · <a href="/qa-guide" target="_blank">입력 예시/테스트 안내</a>',injectTo:'body'}]},configureServer(server){
  const dir=resolve('../docs/verification/two-path-qa/browser-evidence');mkdirSync(dir,{recursive:true})
  server.middlewares.use((req,res,next)=>{
   if(req.method==='GET'&&(req.url==='/qa-guide'||/^\/qa-fixtures\/0[1-4]\.txt$/.test(req.url??''))){
    const guide=req.url==='/qa-guide'
    res.setHeader('Content-Type',guide?'text/html; charset=utf-8':'text/plain; charset=utf-8')
    res.end(readFileSync(resolve('../docs/verification/two-path-qa',guide?'manual.html':`manual-fixtures/${req.url!.split('/').pop()}`)))
    return
   }
   const url=req.url??'',content=/^\/api\/v1\/(works|world-studios)(\/|$|\?)/.test(url),login=url==='/api/v1/auth/login'
   if(!content&&!login){next();return}
   const chunks:Buffer[]=[],write=res.write.bind(res),end=res.end.bind(res)
   res.write=((chunk,...args)=>{if(content&&chunk)chunks.push(Buffer.from(chunk));return write(chunk,...args)}) as typeof res.write
   res.end=((chunk,...args)=>{if(content&&chunk)chunks.push(Buffer.from(chunk));return end(chunk,...args)}) as typeof res.end
   res.on('finish',()=>{let body:unknown;try{body=content?JSON.parse(Buffer.concat(chunks).toString()):undefined}catch{body='non-json'}
    appendFileSync(resolve(dir,'http.ndjson'),JSON.stringify({at:new Date().toISOString(),method:req.method,url,status:res.statusCode,...(content?{body}:{})})+'\n')
   });next()
  })
 }}]
}))

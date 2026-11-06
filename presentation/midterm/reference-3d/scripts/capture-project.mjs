import {chromium} from 'playwright';
const b=await chromium.launch({channel:'chrome',headless:true});try{const p=await b.newPage({viewport:{width:920,height:680},deviceScaleFactor:2});
p.on('pageerror',e=>console.error(e));await p.goto('http://127.0.0.1:5189/project-overview.html');await p.waitForFunction(()=>window.projectGraphReady);await p.screenshot({path:'renders/project-overview.png'});console.log(await p.locator('#root span').allTextContents());}finally{await b.close()}

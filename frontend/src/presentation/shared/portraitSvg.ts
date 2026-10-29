// 목업(frontend/mockup/index.html) 940~1003행의 인물 초상 그림을 그대로 옮겼습니다. 이름은 코드 안 상수만 씁니다.
type Pt = { bg: string[]; [k: string]: string | string[] | number | undefined }

/** 목업 PT: 인물 초상 설정 */
const PT: Record<string, Pt> = {
 '성진':{bg:['#F6EBD6','#DCC6A2'],skin:'#F3D3B5',hair:'shaved',hc:'#6B5A4C',out:'robe',oc:'#8F8D86',oc2:'#E9E4D8',acc:'beads',age:'y'},
 '육관대사':{bg:['#F3E7CF','#CDB48A'],skin:'#EDC9A8',hair:'shaved',hc:'#DCD7CF',out:'kasaya',oc:'#9C6B2E',oc2:'#E9E4D8',beard:'long',age:'o'},
 '팔선녀':{bg:['#F7EEF6','#D9CBEA'],skin:'#F8DDCB',hair:'updo',hc:'#2B2430',out:'hanbok',oc:'#E7D3EC',oc2:'#B58AA6',acc:'binyeo',age:'y',f:1},
 '양소유':{bg:['#EEF0E6','#C7CDB2'],skin:'#F2D1B3',hair:'topknot',hc:'#231F1C',out:'dopo',oc:'#EEF1F4',oc2:'#7C8A9E',hat:'gat',age:'y'},
 '리안':{bg:['#2E3577','#0F1338'],skin:'#F4D6C0',hair:'bob',hc:'#8A5A3B',out:'cloak',oc:'#2B2F63',oc2:'#E9C46A',acc:'star',age:'y',f:1},
 '카엘':{bg:['#28305E','#0D1030'],skin:'#E9C3A3',hair:'short',hc:'#C9A86A',out:'armor',oc:'#9AA3B5',oc2:'#3B4466',age:'m'},
 '세라핀':{bg:['#3A2B4E','#140E24'],skin:'#F1D2C2',hair:'long',hc:'#E8E2EE',out:'cloak',oc:'#7E3445',oc2:'#E9C46A',age:'m',f:1},
 '도윤':{bg:['#174A50','#071C20'],skin:'#EFCDB0',hair:'messy',hc:'#1E1E22',out:'rain',oc:'#E9C46A',oc2:'#2D3B40',hat:'cap',age:'y'},
 '하람':{bg:['#1E4A52','#081A1E'],skin:'#F2D4BE',hair:'pony',hc:'#2A2026',out:'scarf',oc:'#5B6B70',oc2:'#5FA89A',age:'y',f:1},
 '길동':{bg:['#EFE6D6','#BFA584'],skin:'#EFCBA9',hair:'topknot',hc:'#1F1A17',out:'dopo',oc:'#E8E4DA',oc2:'#5B4A3A',acc:'band',age:'y',brow:'firm'},
 '홍 판서':{bg:['#EAE3D6','#A99780'],skin:'#E8C3A2',hair:'topknot',hc:'#2A2522',out:'dopo',oc:'#2F3A55',oc2:'#E8E4DA',hat:'gat',beard:'goatee',age:'o'}
};
/** 목업 portrait(name, size): 인물 초상 SVG 문자열 (목업 코드 그대로) */
export function portraitSvg(name: string, size?: number) {
 const p=PT[name];const s=size||40;const id='pt'+[...name].reduce((a,c)=>a+c.charCodeAt(0),0)+'_'+s;
 if(!p)return `<svg viewBox="0 0 100 100" width="${s}" height="${s}" aria-hidden="true"><defs><radialGradient id="${id}" cx="50%" cy="35%" r="75%"><stop offset="0" stop-color="#C9CAD3"/><stop offset="1" stop-color="#8C8E97"/></radialGradient></defs><circle cx="50" cy="50" r="50" fill="url(#${id})"/><circle cx="50" cy="44" r="17" fill="#6B6F78"/><path d="M14 100c4-22 18-30 36-30s32 8 36 30z" fill="#6B6F78"/><text x="50" y="52" text-anchor="middle" font-size="22" font-weight="800" fill="#ECECF1">?</text></svg>`;
 const k=p.skin,sh='rgba(120,70,40,.18)';let back='',hair='',hat='',out='',face='',extra='';
 // 뒷머리
 if(p.hair==='long')back=`<path d="M28 44c-4 18-2 34 2 46h40c4-12 6-28 2-46z" fill="${p.hc}"/>`;
 if(p.hair==='pony')back=`<path d="M66 40c10 6 12 22 6 36-3-10-6-18-10-24z" fill="${p.hc}"/>`;
 if(p.out==='cloak')back+=`<path d="M24 52c0-22 12-36 26-36s26 14 26 36c-6-10-14-14-26-14s-20 4-26 14z" fill="${p.oc}" opacity=".95"/>`;
 // 옷
 const body='M8 100c3-17 17-28 42-28s39 11 42 28z';
 if(p.out==='robe')out=`<path d="${body}" fill="${p.oc}"/><path d="M40 72l10 16 10-16" fill="none" stroke="${p.oc2}" stroke-width="4"/>`;
 if(p.out==='kasaya')out=`<path d="${body}" fill="#8F8D86"/><path d="M20 82c18-6 36 2 52 18H40c-6-6-14-12-20-18z" fill="${p.oc}"/><path d="M42 72l8 13 8-13" fill="none" stroke="${p.oc2}" stroke-width="3.5"/>`;
 if(p.out==='hanbok')out=`<path d="${body}" fill="${p.oc}"/><path d="M38 72l12 14 12-14" fill="none" stroke="#fff" stroke-width="3.5"/><path d="M50 86l-6 12M50 86l7 11" stroke="${p.oc2}" stroke-width="3" stroke-linecap="round"/><circle cx="50" cy="86" r="2.6" fill="${p.oc2}"/>`;
 if(p.out==='dopo')out=`<path d="${body}" fill="${p.oc}"/><path d="M36 72l14 18 14-18" fill="none" stroke="${p.oc2}" stroke-width="4"/><path d="M50 90v10" stroke="${p.oc2}" stroke-width="2" opacity=".5"/>`;
 if(p.out==='cloak')out=`<path d="${body}" fill="${p.oc}"/><path d="M40 73l10 10 10-10" fill="none" stroke="rgba(255,255,255,.35)" stroke-width="2.5"/>`;
 if(p.out==='armor')out=`<path d="${body}" fill="${p.oc2}"/><path d="M30 78c6-5 13-6 20-6s14 1 20 6l-4 22H34z" fill="${p.oc}"/><ellipse cx="17" cy="86" rx="12" ry="9" fill="${p.oc}"/><ellipse cx="83" cy="86" rx="12" ry="9" fill="${p.oc}"/><path d="M50 74v26" stroke="rgba(0,0,0,.18)" stroke-width="2"/>`;
 if(p.out==='rain')out=`<path d="${body}" fill="${p.oc}"/><path d="M40 72l10 9 10-9v4l-10 9-10-9z" fill="#C9A04A"/><path d="M50 82v18" stroke="#8A6A1E" stroke-width="2"/><rect x="63" y="80" width="18" height="4" rx="2" transform="rotate(-25 72 82)" fill="${p.oc2}"/>`;
 if(p.out==='scarf')out=`<path d="${body}" fill="${p.oc}"/><path d="M34 70c8 6 24 6 32 0l2 8c-10 7-26 7-36 0z" fill="${p.oc2}"/><path d="M60 76l4 16-7-2z" fill="${p.oc2}"/>`;
 if(p.acc==='beads')extra+=[...Array(9)].map((_,i)=>{const a=Math.PI*(.15+.7*i/8);return `<circle cx="${(50-15*Math.cos(a)).toFixed(1)}" cy="${(72+9*Math.sin(a)).toFixed(1)}" r="2.3" fill="#7A4E2A"/>`}).join('');
 if(p.acc==='star')extra+=`<path d="M50 80l2 4.5 4.5.6-3.3 3 .9 4.6L50 90.5l-4.1 2.2.9-4.6-3.3-3 4.5-.6z" fill="${p.oc2}"/>`;
 // 목·얼굴
 face=`<rect x="43" y="58" width="14" height="16" rx="6" fill="${k}"/><rect x="43" y="62" width="14" height="5" fill="${sh}"/>
 <ellipse cx="31.5" cy="47" rx="3.5" ry="5" fill="${k}"/><ellipse cx="68.5" cy="47" rx="3.5" ry="5" fill="${k}"/>
 <path d="M32 42c0-13 8-22 18-22s18 9 18 22c0 12-7 22-18 22s-18-10-18-22z" fill="${k}"/>`;
 // 앞머리
 if(p.hair==='shaved')hair=`<path d="M32.5 40c1-12 8-19 17.5-19s16.5 7 17.5 19c-5-6-11-8-17.5-8s-12.5 2-17.5 8z" fill="${p.hc}" opacity=".28"/>`;
 if(p.hair==='short')hair=`<path d="M31 43c-2-15 7-25 19-25s21 9 19 25c-3-7-8-11-14-12-2 3-6 5-11 5-5 0-9 2-13 7z" fill="${p.hc}"/>`;
 if(p.hair==='messy')hair=`<path d="M30 44c-3-16 6-27 20-27s23 10 20 27c-2-5-5-8-8-9l-2 5-4-6-4 5-4-5-4 6-3-5c-5 1-9 4-11 9z" fill="${p.hc}"/>`;
 if(p.hair==='bob')hair=`<path d="M29 56c-4-22 4-38 21-38s25 16 21 38c-2-8-3-14-5-18-7 1-14-2-18-7-4 6-10 9-16 9-2 4-3 10-3 16z" fill="${p.hc}"/>`;
 if(p.hair==='long')hair=`<path d="M30 50c-3-20 6-32 20-32s23 12 20 32c-3-10-8-15-14-17-5 4-12 6-19 6-3 3-6 6-7 11z" fill="${p.hc}"/>`;
 if(p.hair==='pony')hair=`<path d="M31 44c-2-15 7-25 19-25s21 10 19 25c-4-7-9-11-17-11s-14 4-21 11z" fill="${p.hc}"/><circle cx="66" cy="34" r="4" fill="${p.oc2}"/>`;
 if(p.hair==='updo')hair=`<ellipse cx="50" cy="15" rx="10" ry="7" fill="${p.hc}"/><path d="M31 45c-2-15 7-25 19-25s21 10 19 25c-3-8-9-13-19-13-4 0-7 1-9 3-4-1-7 2-10 10z" fill="${p.hc}"/><path d="M33 15h34" stroke="#E9C46A" stroke-width="2.4" stroke-linecap="round"/><circle cx="66" cy="15" r="3" fill="#F2C6D0"/><circle cx="34" cy="15" r="2" fill="#E9C46A"/>`;
 if(p.hair==='topknot')hair=`<path d="M32 40c1-12 8-19 18-19s17 7 18 19c-5-5-11-7-18-7s-13 2-18 7z" fill="${p.hc}"/><ellipse cx="50" cy="18" rx="5.5" ry="5" fill="${p.hc}"/><rect x="47.5" y="20" width="5" height="4" fill="${p.hc}"/>`;
 if(p.acc==='band')hair+=`<path d="M32.5 37c5-4 11-6 17.5-6s12.5 2 17.5 6" fill="none" stroke="#2A2522" stroke-width="3"/>`;
 if(p.acc==='binyeo')hair+='';
 // 모자
 if(p.hat==='gat')hat=`<path d="M38 29c0-9 5-13 12-13s12 4 12 13z" fill="#1A1A1D" opacity=".88"/><ellipse cx="50" cy="29" rx="27" ry="4.2" fill="#1A1A1D" opacity=".78"/><path d="M33 31c1 12 6 26 13 34M67 31c-1 12-6 26-13 34" fill="none" stroke="#1A1A1D" stroke-width=".9" opacity=".6"/>`;
 if(p.hat==='cap')hat=`<path d="M30 37c0-12 9-19 20-19s20 7 20 19z" fill="#2F6F78"/><path d="M48 36h28c0 3-4 5-10 5H48z" fill="#245860"/><circle cx="50" cy="19" r="2" fill="#245860"/>`;
 // 이목구비
 const ey=48;const fem=p.f;const old=p.age==='o';
 const eyes=old?`<path d="M38 ${ey}q4 3 8 0M54 ${ey}q4 3 8 0" fill="none" stroke="#2A221D" stroke-width="2" stroke-linecap="round"/>`
  :`<ellipse cx="42" cy="${ey}" rx="${fem?3:2.6}" ry="${fem?3.6:3.1}" fill="#2A221D"/><ellipse cx="58" cy="${ey}" rx="${fem?3:2.6}" ry="${fem?3.6:3.1}" fill="#2A221D"/><circle cx="43" cy="${ey-1.2}" r="1" fill="#fff"/><circle cx="59" cy="${ey-1.2}" r="1" fill="#fff"/>${fem?`<path d="M38.5 ${ey-3}l-2-1.5M61.5 ${ey-3}l2-1.5" stroke="#2A221D" stroke-width="1.3" stroke-linecap="round"/>`:''}`;
 const bc=old&&(p.hair==='shaved')?'#DCD7CF':(p.hair==='shaved'?'#6B5A4C':p.hc);
 const brows=p.brow==='firm'?`<path d="M37 ${ey-7}l9 2M63 ${ey-7}l-9 2" stroke="${bc}" stroke-width="2.4" stroke-linecap="round"/>`:`<path d="M37.5 ${ey-6.5}q4.5-2.5 9 0M53.5 ${ey-6.5}q4.5-2.5 9 0" fill="none" stroke="${bc}" stroke-width="${old?2.6:1.9}" stroke-linecap="round"/>`;
 const mouth=`<path d="M46 57q4 ${fem?3:2.4} 8 0" fill="none" stroke="#9A5B4A" stroke-width="1.8" stroke-linecap="round"/>`;
 const blush=`<ellipse cx="38" cy="54" rx="3.6" ry="2" fill="#F08F8F" opacity="${fem?.35:.18}"/><ellipse cx="62" cy="54" rx="3.6" ry="2" fill="#F08F8F" opacity="${fem?.35:.18}"/>`;
 const wr=old?`<path d="M36 52q2 2 4 1.5M64 52q-2 2-4 1.5" stroke="rgba(90,60,40,.35)" stroke-width="1" fill="none"/>`:'';
 let beard='';
 if(p.beard==='long')beard=`<path d="M38 56c2 12 6 24 12 30 6-6 10-18 12-30-4 4-8 6-12 6s-8-2-12-6z" fill="#EEEAE4"/><path d="M42 56q8 4 16 0" stroke="#EEEAE4" stroke-width="3.2" fill="none" stroke-linecap="round"/>`;
 if(p.beard==='goatee')beard=`<path d="M43 57q7 3 14 0" stroke="#3A3532" stroke-width="2.4" fill="none" stroke-linecap="round"/><path d="M46 62c1 6 3 10 4 12 1-2 3-6 4-12-2 1-6 1-8 0z" fill="#3A3532"/>`;
 return `<svg viewBox="0 0 100 100" width="${s}" height="${s}" aria-hidden="true"><defs><radialGradient id="${id}" cx="50%" cy="30%" r="80%"><stop offset="0" stop-color="${p.bg[0]}"/><stop offset="1" stop-color="${p.bg[1]}"/></radialGradient><clipPath id="${id}c"><circle cx="50" cy="50" r="50"/></clipPath></defs><g clip-path="url(#${id}c)"><rect width="100" height="100" fill="url(#${id})"/>${back}${out}${extra}${face}${hair}${hat}${eyes}${brows}${blush}${wr}${beard}${mouth}</g></svg>`;
}

export const palette = { world:'#aa94ff', person:'#59bcff', place:'#5fe1d0', organization:'#ffbd75', event:'#ed91d1' };
// Coordinates are editorial staging, not a measured semantic distance.
export const nodes = [
  ['gildong','홍길동','person',0,0,20],
  ['hong','홍문','person',-95,60,0],
  ['chun','춘섬','person',100,45,12],
  ['birth','길동의 탄생','event',65,-70,25],
  ['lament','호부호형의 한','event',-90,-65,15],
  ['world','조선국','world',-165,130,-65],
  ['court','조정','organization',-220,40,-70],
  ['gate','홍희문','place',-215,-50,-20],
  ['dream','청룡의 꿈','event',-70,150,-85],
  ['wife','홍문의 부인','person',50,145,-60],
  ['yard','뜰','place',-15,-145,-30],
  ['sword','월하의 검무','event',130,-140,-55],
  ['mother','모자 대화','event',200,30,-45],
  ['inner','내당','place',180,135,-100]
].map(([id,label,type,x,y,z])=>({id,label,type,x,y,z,fx:x,fy:y,fz:z}));

// Every semantic edge has a local original-text anchor. No future affiliations.
export const links = [
 ['hong','birth','탄생 사흘 뒤 아이를 봄','episode-1.txt','승상이 드러와 보시니'],
 ['chun','birth','길동을 낳음','episode-1.txt','춘셤이 비록'],
 ['hong','lament','길동을 꾸짖음','episode-1.txt','방ᄌᆞᄒᆞᆫ 마음'],
 ['hong','sword','길동의 거동을 봄','episode-1.txt','길동의 거동을 보시고'],
 ['gildong','yard','뜰에서 배회','episode-1.txt','졍하의'],
 ['hong','inner','내당에 들어감','episode-1.txt','ᄂᆡ당의 드러ᄀᆞ'],
 ['hong','gildong','부친','episode-1.txt','일홈을 길동이라'],
 ['chun','gildong','모친','episode-1.txt','춘셤이 비록'],
 ['gildong','birth','탄생','episode-1.txt','일ᄀᆡ 긔남ᄌᆞ'],
 ['gildong','lament','신분의 갈등','episode-1.txt','부친을 부친이라 못'],
 ['hong','world','조선의 재상','episode-1.txt','됴션국'],
 ['hong','court','조정의 관직','episode-1.txt','명망이 됴졍'],
 ['hong','gate','문 밖에 거주','episode-1.txt','홍희문 밧긔'],
 ['hong','dream','꿈을 꿈','episode-1.txt','쳥용이'],
 ['hong','wife','부부','episode-1.txt','부인을 익그러'],
 ['wife','inner','내당에 있음','episode-1.txt','ᄂᆡ당의 드러ᄀᆞ'],
 ['gildong','sword','칼춤을 춤','episode-1.txt','칼을 잡고 월하의'],
 ['sword','yard','뜰에서 배회 후','episode-1.txt','졍하의'],
 ['gildong','mother','모친과 대화','episode-2.txt','모친은 소'],
 ['chun','mother','아들과 대화','episode-2.txt','그 어미']
].map(([source,target,label,file,quote])=>({source,target,label,evidence:{file,quote}}));

export const forkPolicy = {kind:'presentation-example',allowedEpisodes:[2,3],branches:[{id:'A',parent:'original',episode:2},{id:'B',parent:'original',episode:3}]};
export const ease = x => { x=Math.min(1,Math.max(0,x)); return x*x*x*(x*(x*6-15)+10); };

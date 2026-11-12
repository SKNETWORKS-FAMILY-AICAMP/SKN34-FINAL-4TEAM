import type { PublicWorldGenre, PublicWorldWork } from '../../domain/entities/publicWorld'
import type { CardType } from '../../domain/entities/studioCards'

/*
 * 메모리 데모(`--mode mockup`·테스트)의 공개 세계관 데이터 26개. `InMemoryPublicWorldRepository`가 서버 공개 세계관 API와 같은 모양으로 바꿔 돌려준다.
 * 실제 모드는 이 데이터를 쓰지 않는다(Content `GET /api/v1/public/world-studios`, `HttpPublicWorldRepository`).
 *
 * ponytail: 서버에 파생·조합(`world_lineage`)·작품-세계관 연결이 아직 없어(DEC-35, 범위 밖) 계보(`derivedFrom`·`combinedFrom`)와 작품(`works`)은 이 데모에만 있다.
 * 한계: 새로고침해도 같은 목록이고 내 세계관·서버 저장과 이어지지 않는다. 읽기 전용이며 이용·복사·작품 연결은 없다. 서버에는 공개 시각만 있어
 * 데모는 배열 뒤쪽일수록 최근에 공개됐다고 본다(목록은 최근 공개 순). 표지는 장르별 테마 아트라 서버 값이 아니다.
 * 서버 계보·작품이 생기면 계약에 필드를 더하고 이 파일의 `derivedFrom`·`combinedFrom`·`works`를 그 응답으로 바꾼다.
 * 노드가 수백 개를 넘으면 서버가 장르·최근 공개 순으로 줄여 보낸다.
 */

/**
 * `links`는 같은 세계관의 다른 카드와의 연관이다. `to`는 대상 카드 제목(세계관 안에서 유일)이고 인물끼리는 `label`이 관계(스승-제자·적대·연인·혈연 …)다.
 * 방향이 없어 한쪽 카드에만 적는다(같은 두 카드를 두 번 이으면 먼저 나온 하나만 센다). 저장소가 카드 위치를 id로, links를 서버와 같은 관계 목록으로 바꾼다.
 */
type DemoWorldCard = { type: CardType; title: string; text: string; links?: readonly { to: string; label?: string }[] }
/**
 * hook은 상세 화면 제목 아래에 붙는 13자 이하의 한 줄 소개다.
 * `derivedFrom`은 한 세계관을 가져다 새로 만든 파생의 원본 id, `combinedFrom`은 여러 세계관을 섞은 조합의 원본 id들(둘 이상)이다. 둘 다 없으면 처음부터 만든 세계관이다.
 * `works`는 이 세계관 자체에 연결된 작품(파생·조합 원본의 작품은 포함하지 않는다)이고 없으면 아직 쓴 작품이 없는 세계관이다.
 */
export type DemoWorld = {
  id: string; name: string; hook: string; genre: PublicWorldGenre; author: string; description: string; cards: readonly DemoWorldCard[]
  derivedFrom?: string; combinedFrom?: readonly string[]; works?: readonly PublicWorldWork[]
}

export const DEMO_WORLDS: readonly DemoWorld[] = [
  {
    id: 'moonhalo-isles', name: '달무리 군도', hook: '달이 지면 섬이 움직인다', genre: 'fantasy', author: '달무리',
    description: '달이 질 때마다 섬들이 한 칸씩 흘러가는 바다. 항해사는 해도 대신 기억에 항로를 적고, 잊힌 항로는 지도에서도 사라진다.',
    cards: [
      { type: 'other', title: '우주관 · 물때의 달', text: '하루는 해가 아니라 달이 지는 횟수로 센다. 물때가 바뀌면 섬 하나가 이웃 섬의 자리로 옮겨 앉는다.' },
      { type: 'character', title: '조석신 하엘', text: '달을 끌어 물때를 만든다고 믿는 신. 이름을 부르며 항해하면 길을 잃지 않는다고 전해진다.',
        links: [{ to: '우주관 · 물때의 달', label: '관장' }] },
      { type: 'character', title: '늙은 항해사 오르', text: '기억에 항로를 적는 마지막 항해사. 일곱 번째 섬의 항로를 혼자 기억한다고 한다.',
        links: [{ to: '견습 항해사 미라', label: '스승-제자' }, { to: '조석신 하엘', label: '숭배' }, { to: '일곱 번째 섬의 실종', label: '목격' }] },
      { type: 'character', title: '견습 항해사 미라', text: '해도를 베끼지 않고 말로 항로를 전해 받는 견습생. 하엘의 이름을 부르는 일을 아직 믿지 못한다.',
        links: [{ to: '조석신 하엘', label: '의심' }, { to: '새벽항', label: '머무는 곳' }] },
      { type: 'location', title: '새벽항', text: '군도에서 가장 오래된 항구. 달이 지는 시각에 맞춰 부두가 열리고 닫힌다.',
        links: [{ to: '우주관 · 물때의 달', label: '물때에 맞춰 열림' }] },
      { type: 'rule', title: '금기 · 해도를 베끼지 않는다', text: '항로를 종이에 옮기면 그 항로는 기억에서 먼저 지워진다. 그래서 항해사는 말로만 전한다.',
        links: [{ to: '일곱 번째 섬의 실종', label: '유래' }] },
      { type: 'event', title: '일곱 번째 섬의 실종', text: '백 년 전 하룻밤 사이 섬 하나가 바다와 사람들의 기억에서 함께 사라졌다.' },
    ],
    works: [
      { title: '일곱 번째 섬을 찾아서', author: '파도결', episodes: 42, genre: 'fantasy' },
      { title: '기억으로 쓰는 항로', author: '뱃노래', episodes: 18, genre: 'fantasy' },
    ],
  },
  {
    id: 'silent-orbit', name: '침묵 궤도', hook: '열두 개의 작은 나라', genre: 'sf', author: '궤도서기',
    description: '통신이 끊긴 지 3년, 지구 궤도의 열두 정거장은 저마다 다른 법과 다른 시간을 가진 작은 나라가 되었다.',
    cards: [
      { type: 'other', title: '우주관 · 닫힌 궤도', text: '연료가 바닥나 정거장은 더 멀리 가지 못한다. 열두 정거장은 같은 궤도를 돌며 서로를 볼 수만 있다.' },
      { type: 'location', title: '7번 정거장 온실', text: '정거장 산소의 절반을 만드는 식물 구역. 들어가려면 두 사람의 서명이 필요하다.' },
      { type: 'organization', title: '관제 잔류단', text: '지상 관제가 끊긴 뒤에도 교신 절차를 지키는 사람들. 응답이 오리라 믿는 쪽과 아닌 쪽으로 갈라섰다.' },
      { type: 'rule', title: '침묵 협약', text: '어느 정거장도 먼저 도킹하지 않는다. 열두 정거장이 3년 전에 맺은 유일한 약속이다.',
        links: [{ to: '우주관 · 닫힌 궤도', label: '전제' }] },
      { type: 'event', title: '마지막 교신', text: '지상이 보낸 마지막 문장은 "기다리십시오" 한 줄이었다. 그 뒤로 모든 주파수가 비었다.' },
      { type: 'character', title: '교신사 하린', text: '관제 잔류단의 교신사. 마지막 교신을 받은 사람이며 응답이 오리라 믿는 쪽이다.',
        links: [{ to: '온실지기 도윤', label: '적대' }, { to: '중재자 세나', label: '동료' }, { to: '마지막 교신', label: '수신' }, { to: '관제 잔류단', label: '소속' }] },
      { type: 'character', title: '온실지기 도윤', text: '7번 정거장 온실을 돌보는 사람. 응답을 기다리지 않고 식물의 생장만 기록한다.',
        links: [{ to: '중재자 세나', label: '혈연' }, { to: '7번 정거장 온실', label: '관리' }] },
      { type: 'character', title: '중재자 세나', text: '정거장 사이를 오가며 침묵 협약을 지키게 하는 중재자. 어느 쪽의 편도 들지 않는다고 말한다.',
        links: [{ to: '침묵 협약', label: '중재' }] },
    ],
    works: [
      { title: '열세 번째 정거장', author: '궤도사서', episodes: 56, genre: 'sf' },
      { title: '응답하라, 침묵 협약', author: '교신잡음', episodes: 23, genre: 'mystery' },
      { title: '온실의 마지막 생장 기록', author: '푸른잎', episodes: 31, genre: 'sf' },
    ],
  },
  {
    id: 'rain-gate', name: '우중문의 강호', hook: '비 오는 날에만 열린다', genre: 'wuxia', author: '우중객',
    description: '비 오는 날에만 산문을 여는 문파가 있다. 해가 뜬 동안 칼을 뽑지 않는 것이 첫째 가르침이며, 어기면 문적에서 이름이 지워진다.',
    cards: [
      { type: 'organization', title: '우중문(雨中門)', text: '맑은 날에는 산문 밖 누구도 들이지 않고, 비가 오면 처음 온 손님부터 맞는다.' },
      { type: 'rule', title: '금기 · 불발도(不拔刀)', text: '해가 떠 있는 동안 칼을 뽑지 않는다. 어긴 문도는 문적에서 이름이 지워진다.' },
      { type: 'character', title: '문주 연하', text: '백 일 가뭄 끝에 처음으로 산문을 나선 문주. 칼을 뽑아 본 적이 없다고 알려져 있다.',
        links: [{ to: '대제자 청우', label: '스승-제자' }, { to: '떠돌이 검객 무진', label: '적대' }, { to: '우중문(雨中門)', label: '문주' }, { to: '금기 · 불발도(不拔刀)', label: '지킴' }] },
      { type: 'character', title: '대제자 청우', text: '문주의 오랜 제자. 비 오는 날에만 칼을 손질하고 빗결 보법을 가장 먼저 익혔다.',
        links: [{ to: '떠돌이 검객 무진', label: '옛 벗' }, { to: '빗결 보법', label: '전수' }] },
      { type: 'character', title: '떠돌이 검객 무진', text: '백 일의 가뭄 끝에 산문을 찾아온 검객. 맑은 날에도 칼을 뽑는다는 소문이 있다.',
        links: [{ to: '백 일의 가뭄', label: '가뭄 끝에 도착' }] },
      { type: 'ability', title: '빗결 보법', text: '빗줄기 사이로 걷는 보법. 비가 그치면 한 걸음도 쓸 수 없다.' },
      { type: 'event', title: '백 일의 가뭄', text: '비가 오지 않아 산문이 백 일 동안 닫혔다. 그 사이 강호는 문파의 이름을 잊기 시작했다.' },
    ],
    works: [
      { title: '비 오는 날의 문주', author: '청우검', episodes: 88, genre: 'wuxia' },
    ],
  },
  {
    id: 'midnight-theatre', name: '열두 시의 극장', hook: '밤마다 다른 배역의 만남', genre: 'romance', author: '열두시',
    description: '자정이 되면 낡은 극장 무대 위에서만 서로를 알아보는 두 사람이 있다. 낮의 이름은 모른 채, 밤마다 다른 배역으로 만난다.',
    cards: [
      { type: 'location', title: '열두 시의 극장', text: '문 닫은 지 오래된 소극장. 자정이 되면 무대 조명 한 줄만 켜진다.' },
      { type: 'rule', title: '금기 · 낮의 이름을 묻지 않는다', text: '무대 위에서는 배역 이름으로만 부른다. 낮의 이름을 묻는 순간 그날 밤의 막이 내린다.',
        links: [{ to: '열두 시의 극장', label: '지켜지는 곳' }] },
      { type: 'character', title: '배역 하나, 이안', text: '밤마다 다른 배역을 맡는 사람. 낮에 무엇을 하는지는 극장 안의 누구도 모른다.',
        links: [{ to: '배역 둘, 서연', label: '연인' }, { to: '열두 시의 극장', label: '무대' }, { to: '찢어진 대본 한 장', label: '첫 만남' }] },
      { type: 'character', title: '배역 둘, 서연', text: '낮의 이름을 모른 채 밤마다 이안과 다른 배역으로 만나는 사람. 마침표만은 늘 같은 자리에 찍는다.',
        links: [{ to: '조명지기 노인', label: '혈연' }, { to: '찢어진 대본 한 장', label: '소지' }] },
      { type: 'character', title: '조명지기 노인', text: '자정에 조명 한 줄을 켜는 극장지기. 낮에는 극장 문을 한 번도 열지 않는다.',
        links: [{ to: '배역 하나, 이안', label: '후견' }, { to: '열두 시의 극장', label: '관리' }] },
      { type: 'object', title: '찢어진 대본 한 장', text: '두 사람이 처음 만난 날의 대사만 남은 종이. 뒷면은 그을려서 읽을 수 없다.' },
    ],
    works: [
      { title: '자정의 배역들', author: '막이내리면', episodes: 36, genre: 'romance' },
      { title: '낮의 이름은 묻지 않기로', author: '조명지기', episodes: 14, genre: 'romance' },
    ],
  },
  {
    id: 'dawn-store', name: '새벽 세 시의 편의점', hook: '후회로 값을 치르는 곳', genre: 'modern', author: '가온지기',
    description: '밤 열한 시부터 새벽 여섯 시까지만 문을 여는 편의점. 계산대 앞에서는 그날 가장 후회한 일 하나를 값으로 낼 수 있다.',
    cards: [
      { type: 'location', title: '24시 가온 편의점', text: '골목마다 위치가 바뀌지만 간판 불빛은 언제나 같은 초록색이다.' },
      { type: 'rule', title: '금기 · 낸 후회는 돌려받지 않는다', text: '값으로 낸 후회는 점원도 돌려줄 수 없다. 계산하고 나면 그 일은 기억에서 가벼워진다.',
        links: [{ to: '후회 영수증', label: '남는 기록' }] },
      { type: 'character', title: '야간 점원 도겸', text: '계산대를 지킨 지 몇 해인지 본인도 모른다. 손님의 후회를 되묻지 않는다.',
        links: [{ to: '단골 유나', label: '단골' }, { to: '낮 점장 가온', label: '교대' }, { to: '24시 가온 편의점', label: '근무' }] },
      { type: 'character', title: '단골 유나', text: '매일 새벽 같은 후회를 값으로 내고 가는 단골. 영수증은 한 장도 버리지 않는다.',
        links: [{ to: '낮 점장 가온', label: '혈연' }, { to: '후회 영수증', label: '모아 둠' }] },
      { type: 'character', title: '낮 점장 가온', text: '낮에만 가게를 맡는 점장. 야간 점원과는 한 번도 마주친 적이 없다.',
        links: [{ to: '24시 가온 편의점', label: '주인' }] },
      { type: 'object', title: '후회 영수증', text: '계산하면 값으로 낸 일이 한 줄로 적힌 영수증이 나온다. 아침이 오면 글자가 사라진다.' },
    ],
    works: [
      { title: '새벽 세 시, 후회 한 줄', author: '야간근무', episodes: 64, genre: 'modern' },
    ],
  },
  {
    id: 'night-market', name: '인경 뒤의 도깨비 장터', hook: '도깨비와 사람의 야시', genre: 'classic', author: '야시꾼',
    description: '인경이 울려 성문이 닫힌 뒤 한양 종로 뒷골목에 서는 장터. 도깨비와 사람이 같은 저울을 쓰되 값은 서로 다른 것으로 치른다.',
    cards: [
      { type: 'location', title: '종로 뒷골목 야시', text: '인경이 울린 뒤에만 서는 장터. 날이 밝기 전에 장막이 걷히면 흔적도 남지 않는다.' },
      { type: 'rule', title: '금기 · 맨손으로 거래한다', text: '장터 안에서는 저울도 칼도 쓰지 않는다. 거래는 손바닥을 마주쳐 맺는다.',
        links: [{ to: '종로 뒷골목 야시', label: '거래 규칙' }] },
      { type: 'character', title: '장돌뱅이 막동', text: '도깨비와 사람 사이를 오가며 값을 흥정하는 사내. 어느 쪽 이름으로도 불린다.',
        links: [{ to: '도감 어른 백동', label: '외상' }, { to: '약장수 달례', label: '단짝' }, { to: '종로 뒷골목 야시', label: '터줏대감' }] },
      { type: 'character', title: '도감 어른 백동', text: '야시 도감을 이끄는 늙은 도깨비. 외상이 닷새를 넘긴 손님의 이름을 장부에서 지운다.',
        links: [{ to: '약장수 달례', label: '적대' }, { to: '야시 도감(都監)', label: '수장' }] },
      { type: 'character', title: '약장수 달례', text: '사람 약장수. 도깨비에게 진 외상이 닷새를 넘긴 적이 있는데도 아직 장터에 선다.',
        links: [{ to: '인경이 사흘 멈춘 밤', label: '목격' }] },
      { type: 'organization', title: '야시 도감(都監)', text: '장터의 질서를 지키는 도깨비들의 모임. 외상은 닷새를 넘기지 못하게 한다.' },
      { type: 'event', title: '인경이 사흘 멈춘 밤', text: '성문이 사흘 밤 닫히지 않자 장터가 대낮의 거리까지 번졌다.',
        links: [{ to: '종로 뒷골목 야시', label: '번진 곳' }] },
    ],
    works: [
      { title: '인경이 울리면', author: '종로야시', episodes: 27, genre: 'classic' },
      { title: '맨손 거래', author: '손뼉소리', episodes: 12, genre: 'classic' },
    ],
  },
  {
    id: 'fog-clinic', name: '묵현리 안개 병원', hook: '밤마다 느는 환자 명부', genre: 'mystery', author: '묵현',
    description: '섬마을 묵현리에는 안개가 끼면 문을 잠그는 병원이 있다. 환자 명부에는 세상을 떠난 이름이 밤마다 한 줄씩 늘어난다.',
    cards: [
      { type: 'location', title: '묵현 요양원', text: '섬에서 하나뿐인 병원. 안개주의보가 내리면 정문과 2층 병동이 안에서 잠긴다.',
        links: [{ to: '2층 병동 폐쇄', label: '폐쇄된 층' }] },
      { type: 'rule', title: '금기 · 안개 속에서 이름을 부르지 않는다', text: '안개가 낀 날 이름을 부르면 병동 어딘가에서 대답이 돌아온다고 한다.',
        links: [{ to: '환자 명부', label: '늘어나는 이름' }] },
      { type: 'character', title: '당직의 서진', text: '부임한 지 사흘 만에 명부의 이상함을 알아챈 의사. 이 섬에 연고가 없다고 말한다.',
        links: [{ to: '간호사 은조', label: '의심' }, { to: '원장 한서림', label: '숨긴 혈연' }, { to: '환자 명부', label: '발견' }] },
      { type: 'character', title: '간호사 은조', text: '이십 년째 야간 병동을 지킨 간호사. 안개가 끼면 말수가 줄고 서진을 피한다.',
        links: [{ to: '원장 한서림', label: '스승-제자' }, { to: '2층 병동 폐쇄', label: '목격' }] },
      { type: 'character', title: '원장 한서림', text: '십 년 전 큰불로 세상을 떠난 원장. 명부에 늘어나는 이름의 필체가 그의 것이다.',
        links: [{ to: '환자 명부', label: '필체 주인' }] },
      { type: 'object', title: '환자 명부', text: '밤마다 한 줄씩 늘어난다. 새로 적힌 이름의 필체는 모두 돌아가신 원장의 것이다.' },
      { type: 'event', title: '2층 병동 폐쇄', text: '십 년 전 큰불 이후 문을 닫은 층. 지금도 밤이면 환자 호출벨이 울린다.' },
    ],
    works: [
      { title: '명부에 없는 이름', author: '안개낀섬', episodes: 49, genre: 'mystery' },
    ],
  },
  {
    id: 'root-library', name: '뿌리 아래의 도서관', hook: '읽힌 책은 잎을 틔운다', genre: 'fantasy', author: '뿌리사서',
    description: '거대한 나무의 뿌리 속에서 책이 자라는 도서관. 읽힌 책은 잎을 틔우고 읽히지 않은 책은 말라, 사서들은 책의 계절을 따라 산다.',
    cards: [
      { type: 'other', title: '우주관 · 책의 계절', text: '이 세계의 사계절은 하늘이 아니라 책이 정한다. 첫 책이 싹틀 때 봄이 오고 마지막 장이 마르면 겨울이 온다.' },
      { type: 'location', title: '뿌리 서고', text: '나무뿌리가 서가를 이루는 가장 깊은 층. 빛은 책장이 틔운 잎에서만 나온다.' },
      { type: 'organization', title: '계절 사서회', text: '책의 계절을 기록하고 순서를 지키는 사서들의 모임. 사서장은 해마다 가장 늦게 자란 책이 정한다.',
        links: [{ to: '우주관 · 책의 계절', label: '기록' }] },
      { type: 'character', title: '사서장 라온', text: '해마다 가장 늦게 자란 책이 정한 사서장. 책의 계절 순서를 한 번도 어긴 적이 없다.',
        links: [{ to: '견습 사서 이솔', label: '스승-제자' }, { to: '잎 읽는 노인 마루', label: '오랜 벗' }, { to: '계절 사서회', label: '사서장' }] },
      { type: 'character', title: '견습 사서 이솔', text: '읽다 만 책을 덮었다가 한 권을 뿌리로 돌려보낸 견습 사서. 그 책의 마지막 장을 찾고 있다.',
        links: [{ to: '잎 읽는 노인 마루', label: '조력' }, { to: '금기 · 읽다 만 책을 덮지 않는다', label: '위반' }] },
      { type: 'character', title: '잎 읽는 노인 마루', text: '잎 한 장을 쥐고 마지막 독자의 목소리를 듣는 노인. 첫 번째 씨앗 책만은 쥐어 보지 못했다.',
        links: [{ to: '책장 속삭임', label: '능력자' }] },
      { type: 'rule', title: '금기 · 읽다 만 책을 덮지 않는다', text: '펼친 책은 끝까지 읽거나 표시를 남기고 닫아야 한다. 그냥 덮은 책은 뿌리로 돌아가 사라진다.' },
      { type: 'ability', title: '책장 속삭임', text: '잎 한 장을 쥐면 그 책을 마지막으로 읽은 이의 목소리가 들린다.' },
      { type: 'object', title: '첫 번째 씨앗 책', text: '도서관의 첫 책. 한 번도 펼쳐진 적이 없는데도 가장 크게 자랐다.',
        links: [{ to: '뿌리 서고', label: '보관' }] },
    ],
    works: [
      { title: '잎이 돋는 서가', author: '뿌리밑', episodes: 33, genre: 'fantasy' },
      { title: '읽다 만 책의 마지막 장', author: '책벌레', episodes: 9, genre: 'fantasy' },
      { title: '계절 사서의 일기', author: '서고지기', episodes: 21, genre: 'modern' },
    ],
  },
  // 아래는 위 세계관을 가져다 새로 만든 파생(derivedFrom)과 여럿을 섞은 조합(combinedFrom)이다. 원본이 앞에 오고 파생·조합이 뒤따른다.
  {
    id: 'tide-compass', name: '조수의 나침반', hook: '물때가 길을 가리킨다', genre: 'fantasy', author: '물때서기', derivedFrom: 'moonhalo-isles',
    description: '달무리 군도에서 달 대신 조수가 길을 정하는 쪽으로 가지를 친 세계. 나침반 바늘은 북쪽이 아니라 밀물이 들어오는 방향을 가리킨다.',
    cards: [
      { type: 'object', title: '조수 나침반', text: '바늘이 물때를 따라 돈다. 썰물에는 멈추고 밀물에는 가장 가까운 섬을 가리킨다.' },
      { type: 'location', title: '물때 관측소', text: '섬 가장자리에 서 있는 낮은 탑. 하루 네 번 종을 쳐 물때를 알린다.' },
      { type: 'rule', title: '금기 · 썰물에는 닻을 내리지 않는다', text: '썰물 때 내린 닻은 섬이 움직일 때 항로째 끌려간다고 한다.' },
      { type: 'character', title: '관측수 해랑', text: '물때표를 한 번도 틀린 적 없는 사람. 대신 자기 나이는 자주 틀린다.' },
    ],
  },
  {
    id: 'orbit-graveyard', name: '궤도 무덤', hook: '버려진 정거장의 묘지', genre: 'sf', author: '잔해수집가', derivedFrom: 'silent-orbit',
    description: '침묵 궤도에서 갈라져 나와, 버려진 정거장이 한 궤도에 모여 쌓이는 이야기. 사람들은 그곳을 무덤이라 부르고 가끔 켜지는 불에는 아무도 다가가지 않는다.',
    cards: [
      { type: 'location', title: '무덤 궤도', text: '폐기된 정거장 마흔 개가 한 고리를 이룬다. 어느 것도 서로 닿지 않는다.' },
      { type: 'rule', title: '관제 협정 · 잔해는 건드리지 않는다', text: '무덤 궤도의 어떤 것도 가져가지 않는다. 가져간 자의 정거장은 이듬해 고리에 합류한다.' },
      { type: 'event', title: '31번 정거장의 점등', text: '십 년째 꺼져 있던 31번에 어느 날 생명 유지 불빛이 들어왔다.' },
    ],
  },
  {
    id: 'rain-inn', name: '빗속의 객잔', hook: '비가 와야 문을 연다', genre: 'wuxia', author: '객잔주인', derivedFrom: 'rain-gate',
    description: '우중문의 강호에서 산문 밖 갈림길에 선 객잔의 이야기. 비 오는 날 처음 온 손님에게만 방을 내주고, 그 손님이 문파의 소식을 가장 먼저 듣는다.',
    cards: [
      { type: 'location', title: '빗길 객잔', text: '산문 아래 갈림길의 이층 객잔. 처마 끝에 놋쇠 풍경 하나가 걸려 있다.' },
      { type: 'rule', title: '금기 · 마른 옷으로 들어오지 않는다', text: '비를 맞지 않고 문을 연 손님은 방도 술도 받지 못한다.' },
      { type: 'character', title: '주모 설아', text: '문주의 소식을 가장 먼저 아는 사람. 아는 것을 팔지는 않는다.' },
      { type: 'object', title: '놋쇠 풍경', text: '비가 오면 소리가 달라지고 비가 그치면 아무 소리도 내지 않는다.' },
    ],
  },
  {
    id: 'backstage-letters', name: '막 뒤의 편지', hook: '무대 뒤에서 오는 답장', genre: 'romance', author: '막뒤필경', derivedFrom: 'midnight-theatre',
    description: '열두 시의 극장에서 이어진, 무대 뒤 서랍에 편지를 남기는 두 사람의 이야기. 낮의 이름은 몰라도 필체는 서로 알아본다.',
    cards: [
      { type: 'location', title: '분장실 서랍', text: '막이 내린 뒤에만 열리는 서랍. 편지는 언제나 아침 전에 사라진다.' },
      { type: 'rule', title: '금기 · 필체를 바꾸지 않는다', text: '편지의 필체를 바꾸는 순간 답장도 오지 않는다.' },
      { type: 'character', title: '배역 둘, 서연', text: '밤마다 다른 배역으로 편지를 쓰지만 마침표만은 늘 같다.' },
      { type: 'object', title: '잉크 묻은 대본', text: '두 사람의 대사 사이사이에 편지의 답이 적혀 있다.' },
    ],
  },
  {
    id: 'dawn-pharmacy', name: '새벽 약국', hook: '후회에 맞는 약', genre: 'modern', author: '가온약사', derivedFrom: 'dawn-store',
    description: '새벽 세 시의 편의점 맞은편에 문을 연 약국. 처방전 대신 가장 가벼워진 후회 한 줄을 적어 내면 그 값만큼 약을 지어 준다.',
    cards: [
      { type: 'location', title: '초록 십자 약국', text: '편의점과 같은 초록 불빛을 쓰지만 문은 새벽 다섯 시에 닫는다.' },
      { type: 'rule', title: '금기 · 약은 한 번에 한 알만', text: '후회를 한꺼번에 여러 알로 줄이면 기억도 함께 흐려진다.' },
      { type: 'character', title: '약사 윤하', text: '야간 점원 도겸과 오래된 이웃. 서로의 가게에 들르지 않는 것이 규칙이다.' },
      { type: 'object', title: '처방 영수증', text: '약값으로 낸 후회가 한 줄로 적혀 나온다. 낮이 되면 글씨가 사라진다.' },
    ],
  },
  {
    id: 'goblin-bridge', name: '도깨비 다리', hook: '다리 위의 도깨비불', genre: 'classic', author: '다리밑', derivedFrom: 'night-market',
    description: '인경 뒤의 도깨비 장터에서 청계천 다리 쪽으로 번진 이야기. 다리를 건너는 동안은 사람의 값도 도깨비의 값도 치르지 않는다.',
    cards: [
      { type: 'location', title: '광통교 도깨비불', text: '다리 난간마다 푸른 불이 걸린다. 건너편 사람은 불의 개수로 값을 가늠한다.' },
      { type: 'rule', title: '금기 · 다리 위에서 흥정하지 않는다', text: '다리 위의 거래는 효력이 없고 흥정한 사람은 건너편에 닿지 못한다.' },
      { type: 'character', title: '다리지기 소월', text: '밤마다 다리 한가운데서 건너는 사람의 수를 센다.' },
      { type: 'event', title: '불이 꺼진 사흘', text: '다리의 도깨비불이 사흘 꺼져 장터가 반대편으로 옮겨 앉았다.' },
    ],
  },
  {
    id: 'fog-ferry', name: '안개 나루', hook: '건너편이 없는 배', genre: 'mystery', author: '나룻배', derivedFrom: 'fog-clinic',
    description: '묵현리 안개 병원에서 이어진 이야기. 안개가 낀 날 병원 아래 나루에서만 배가 뜨고, 건너간 사람의 이름은 명부에 한 줄 더 늘어난다.',
    cards: [
      { type: 'location', title: '묵현 나루', text: '병원 아래 선착장. 안개주의보가 내리면 나룻배 한 척만 불이 켜진다.' },
      { type: 'rule', title: '금기 · 건너편을 묻지 않는다', text: '배에 오른 뒤 어디로 가느냐고 물으면 배는 제자리로 돌아온다.' },
      { type: 'character', title: '사공 영도', text: '노를 저을 때마다 한 사람 몫의 이름을 외운다.' },
      { type: 'event', title: '비어 있던 배', text: '안개가 걷힌 아침 나룻배가 빈 채로 돌아왔고 명부는 두 줄이 늘어 있었다.' },
    ],
  },
  {
    id: 'drowned-lighthouse', name: '가라앉은 등대', hook: '등불이 물속에서 켜진다', genre: 'fantasy', author: '등대지기', derivedFrom: 'tide-compass',
    description: '조수의 나침반에서 이어진 이야기. 물에 잠긴 등대가 밀물 때마다 스스로 불을 켜 길을 잃은 배를 바다 밑으로 이끈다.',
    cards: [
      { type: 'location', title: '가라앉은 등대', text: '탑의 윗부분만 수면 위로 남았다. 불빛은 아래에서 위로 올라온다.' },
      { type: 'event', title: '마지막 점등', text: '백 년 전 등대지기가 마지막으로 켠 불이 지금도 꺼지지 않는다.' },
      { type: 'ability', title: '물속 숨결', text: '등불을 마주 본 사람은 한 번의 밀물 동안 물속에서 숨을 쉴 수 있다.' },
    ],
  },
  {
    id: 'green-ring', name: '온실 고리', hook: '정거장의 숨은 온실', genre: 'sf', author: '온실지기', derivedFrom: 'silent-orbit',
    description: '침묵 궤도의 7번 정거장 온실이 열두 정거장의 산소를 책임지게 된 뒤의 이야기. 식물을 돌보는 사람이 곧 정거장의 법이 된다.',
    cards: [
      { type: 'location', title: '고리 온실', text: '정거장 바깥 고리를 따라 이어진 식물 구역. 한 바퀴를 돌면 하루가 간다.' },
      { type: 'organization', title: '잎 위원회', text: '산소 배급을 정하는 온실지기들의 모임. 투표는 식물의 생장으로 센다.' },
      { type: 'rule', title: '배급 원칙 · 먼저 심은 자가 먼저 숨 쉰다', text: '온실에 처음 씨를 심은 정거장부터 산소를 받는다.' },
      { type: 'character', title: '정원사 소담', text: '식물에게 말을 거는 습관 때문에 관제 잔류단에 불려 간 적이 있다.' },
    ],
  },
  {
    id: 'dry-blade-hall', name: '마른 칼의 문파', hook: '비 없이 칼을 쓴다', genre: 'wuxia', author: '마른칼', derivedFrom: 'rain-inn',
    description: '빗속의 객잔에서 쫓겨난 문도들이 비가 오지 않는 땅에 세운 문파. 우중문과 반대로 해가 뜬 동안에만 칼을 뽑는다.',
    cards: [
      { type: 'organization', title: '마른 칼의 문파', text: '가뭄이 든 땅에서만 문을 여는 문파. 우중문과는 서로의 이름을 부르지 않는다.' },
      { type: 'rule', title: '금기 · 그늘에서 칼을 뽑지 않는다', text: '그늘 아래에서 뽑은 칼은 그 문도의 이름을 문적에서 지운다.' },
      { type: 'ability', title: '볕 가르기', text: '햇살을 칼날로 가르는 검법. 구름이 끼면 위력이 반으로 준다.' },
    ],
  },
  {
    id: 'dawn-laundromat', name: '새벽 빨래방', hook: '기억을 빨아 말린다', genre: 'modern', author: '건조기', derivedFrom: 'dawn-store',
    description: '새벽 세 시의 편의점 골목 끝에 문을 연 무인 빨래방. 빨래 대신 하룻밤 치 기억을 돌리면 후회는 가볍게, 좋은 기억은 조금 바래 돌아온다.',
    cards: [
      { type: 'location', title: '24시 코인 빨래방', text: '건조기 일곱 대가 놓인 가게. 맨 끝 한 대만 언제나 따뜻하다.' },
      { type: 'rule', title: '금기 · 남의 기억은 돌리지 않는다', text: '다른 사람의 기억을 넣으면 건조기가 멈추고 문이 잠긴다.' },
      { type: 'object', title: '코인 한 닢', text: '동전 대신 후회 한 조각을 넣는다. 거스름돈은 오지 않는다.' },
      { type: 'event', title: '건조기 일곱 대의 밤', text: '일곱 대가 동시에 돌던 밤 골목의 가로등이 한꺼번에 꺼졌다.' },
    ],
  },
  {
    id: 'bell-keepers', name: '인경지기', hook: '종을 지키는 사람들', genre: 'classic', author: '종각지기', derivedFrom: 'goblin-bridge',
    description: '도깨비 다리 이야기에서 갈라져 나온, 인경 치는 일을 대대로 물려받는 가문의 이야기. 종을 치는 순서가 곧 한양의 하루를 정한다.',
    cards: [
      { type: 'organization', title: '인경 가문', text: '종을 치는 일을 대대로 물려받는 집안. 장자는 종소리의 높이를 외워 둔다.' },
      { type: 'rule', title: '금기 · 종은 스물여덟 번만', text: '인경은 스물여덟 번만 친다. 그 이상 치면 장터가 낮에도 열린다.' },
      { type: 'object', title: '종 채', text: '대대로 이어져 온 종 채. 손잡이에 가문의 이름이 모두 새겨져 있다.' },
    ],
  },
  {
    id: 'star-tide-station', name: '별물결 정거장', hook: '중력이 달을 끈다', genre: 'sf', author: '별물결', combinedFrom: ['silent-orbit', 'moonhalo-isles'],
    description: '침묵 궤도의 닫힌 정거장과 달무리 군도의 물때를 섞어, 정거장이 달 대신 중력의 물때에 맞춰 움직이는 세계.',
    cards: [
      { type: 'other', title: '우주관 · 중력 물때', text: '정거장은 하루에 두 번 중력이 약해지는 시각에 서로 자리를 바꾼다.' },
      { type: 'location', title: '물결 도킹 베이', text: '중력이 약한 시각에만 열리는 도킹 구역. 놓치면 다음 물때까지 기다린다.' },
      { type: 'rule', title: '물때 협약', text: '도킹은 물때가 바뀐 직후에만, 먼저 도착한 정거장이 먼저 한다.' },
      { type: 'character', title: '항법사 하엘라', text: '조석신의 이름을 부르며 항법을 계산하는 습관이 있다.' },
    ],
  },
  {
    id: 'book-greenhouse', name: '책의 온실', hook: '책이 꽃으로 피는 곳', genre: 'fantasy', author: '온실사서', combinedFrom: ['root-library', 'green-ring'],
    description: '뿌리 아래의 도서관과 온실 고리를 섞어 만든 세계. 읽힌 책은 잎이 아니라 꽃을 피우고, 꽃가루가 닿은 독자는 그 책의 꿈을 꾼다.',
    cards: [
      { type: 'location', title: '유리 서고', text: '온실 천장 아래 서가가 줄지어 서 있다. 낮에는 책이 볕을, 밤에는 별빛을 먹는다.' },
      { type: 'rule', title: '금기 · 꽃을 꺾어 읽지 않는다', text: '핀 책은 제자리에서만 읽는다. 꺾어 간 책은 다음 날 아침 씨앗으로 돌아가 있다.' },
      { type: 'object', title: '꽃가루 서표', text: '책갈피로 꽂아 두면 다음에 펴는 사람에게 앞서 읽은 이의 꿈을 건넨다.' },
      { type: 'organization', title: '화분 사서회', text: '책의 개화 시기를 기록하고 물 주는 순서를 정하는 모임.' },
    ],
  },
  {
    id: 'mist-sword-sect', name: '안개비 검문', hook: '안개 속의 비 문파', genre: 'wuxia', author: '안개객', combinedFrom: ['rain-gate', 'fog-clinic'],
    description: '우중문과 묵현리 안개 병원을 섞은 이야기. 안개비가 내리는 날에만 산문이 열리고 문도의 이름은 안개 속에서 한 줄씩 늘어난다.',
    cards: [
      { type: 'organization', title: '안개비 검문', text: '비와 안개가 함께 오는 날에만 산문을 연다. 평소에는 문 자리조차 보이지 않는다.' },
      { type: 'rule', title: '금기 · 안개비 속에서 이름을 부르지 않는다', text: '두 세계의 금기가 겹쳤다. 이름을 부르면 문도 명부가 한 줄 늘어난다.' },
      { type: 'object', title: '문도 명부', text: '비 오는 밤마다 한 줄씩 늘어나는 명부. 글씨체는 모두 돌아가신 문주의 것이다.' },
      { type: 'character', title: '검객 서진', text: '묵현리에서 온 의원의 이름을 쓰는 객. 칼은 쓰지 않는다고 말한다.' },
    ],
  },
  {
    id: 'lantern-lovers', name: '야시의 연인', hook: '등불 아래의 약속', genre: 'romance', author: '등불연가', combinedFrom: ['night-market', 'midnight-theatre'],
    description: '인경 뒤의 도깨비 장터와 열두 시의 극장을 섞은 이야기. 장터 등불이 켜지는 동안 극장 무대가 야시 한복판에 서고, 두 사람은 배역 대신 흥정으로 마음을 전한다.',
    cards: [
      { type: 'location', title: '등불 무대', text: '야시 한가운데 자정에 서는 가설 무대. 막은 닭이 울기 전에 내린다.' },
      { type: 'rule', title: '금기 · 사랑은 맨손으로 건넨다', text: '장터의 거래 규칙을 따라 마음도 손바닥을 마주쳐 맺는다.' },
      { type: 'character', title: '도깨비 배우 막동', text: '장돌뱅이 막동이 극장에서 얻은 배역. 두 사람 사이를 오가며 값을 흥정한다.' },
      { type: 'object', title: '흥정 대본', text: '대사 대신 값과 흥정이 적힌 대본. 마지막 장은 비어 있다.' },
    ],
  },
  {
    id: 'regret-bazaar', name: '후회 장터', hook: '후회를 거래하는 야시', genre: 'modern', author: '값치르기', combinedFrom: ['dawn-store', 'night-market', 'midnight-theatre'],
    description: '새벽 편의점의 후회 값, 도깨비 장터의 손뼉 거래, 극장의 배역을 한데 섞은 도시 괴담. 자정이 지나면 골목이 장터가 되고 손님은 저마다 다른 배역을 맡는다.',
    cards: [
      { type: 'location', title: '후회 골목 야시', text: '자정을 넘기면 편의점 앞 골목에 등불 장막이 선다. 새벽 여섯 시에 걷힌다.' },
      { type: 'rule', title: '금기 · 값으로 낸 후회는 흥정하지 않는다', text: '손바닥을 마주친 순간 거래는 이미 끝난 일이다.' },
      { type: 'organization', title: '야시 도감과 야간 조합', text: '도깨비와 편의점 점원들이 만든 합의체. 외상은 닷새를 넘기지 못한다.' },
      { type: 'character', title: '손님 하나, 이안', text: '밤마다 다른 배역으로 장터에 나타나 후회 한 줄을 사 간다.' },
      { type: 'object', title: '배역 영수증', text: '거래마다 손님이 맡은 배역이 한 줄 적혀 나온다.' },
    ],
  },
  {
    id: 'ghost-signal', name: '유령 교신', hook: '응답이 먼저 온다', genre: 'mystery', author: '교신기록', combinedFrom: ['silent-orbit', 'fog-clinic'],
    description: '침묵 궤도와 묵현리 안개 병원을 섞은 이야기. 정거장에서 보낸 적 없는 교신이 안개처럼 번지고 그 응답은 늘 한 사람의 이름으로 끝난다.',
    cards: [
      { type: 'event', title: '보낸 적 없는 교신', text: '지상과 끊긴 지 3년이 되던 밤 열두 정거장이 똑같은 문장을 동시에 받았다.' },
      { type: 'object', title: '교신 명부', text: '받은 교신마다 끝에 이름이 한 줄씩 붙는다. 글씨는 모두 같은 필체다.' },
      { type: 'rule', title: '금기 · 응답에 이름을 부르지 않는다', text: '교신에 이름으로 답하면 다음 교신은 그 이름으로 시작한다.' },
      { type: 'character', title: '통신사 서진', text: '두 곳의 명부를 모두 아는 사람. 어느 곳에서 왔는지는 말하지 않는다.' },
    ],
  },
]

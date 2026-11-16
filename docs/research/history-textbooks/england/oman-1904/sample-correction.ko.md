# Oman 1904 독립 표본 후속 교정 기록

- 교정일: 2026-11-13 (UTC).
- 근거: [독립 의미 표본 대조](review-independent-samples.ko.md)의 제1장 P19 의미 교정 1건과 제12장 P20 표현 명료화 권고 1건. 보존된 `source-en.txt`에서 해당 두 문단 전체를 직접 다시 읽고 적용했다.
- 번역 본문 변경은 **제1장 P19 한 문장과 제12장 P20 한 문장, 합계 두 문장**뿐이다. 변경 범위는 전체 파일 바이트 대조로 확인했다.
- 기존 파일 수정: `01-main-prose.ko.draft.md`, `12-main-prose.ko.draft.md`, `12-translation-qa.md`. QA는 변경된 초안의 바이트 수·해시 및 교정 후 검증 기록만 갱신했다. 제1장은 별도 QA가 없으므로 초안 내부의 기존 검수 주석과 누락 대조 기록을 수정하지 않았다.
- 새 파일: 이 기록 `sample-correction.ko.md`와 교정 전 세 파일의 동일 바이트 백업.
- `review-independent-samples.ko.md`는 교정 전 입력·인용·제안의 기록으로 그대로 보존했다. 그 파일에 적힌 두 초안의 해시는 교정 전 해시이며, 교정 후 단독 해시는 아래 표가 기준이다.
- 원문·manifest·서문·다른 제1–39장 단독 초안은 변경하지 않았다. README도 편집하지 않았다. 다른 작업에서 작성·갱신 중인 제40–44장 파일과 README는 이번 불변 비교 대상에서 제외했다.
- 이번 작업에서 44장 통합본을 생성하거나 수정하지 않았다. 단독 초안과 관련 QA만 검증했으며, 통합본 검증을 했다는 뜻이 아니다.

## 제1장 P19: 미실현 반사실 조건 복원

- 원문 위치: `source-en.txt` 618–627행. 번역 위치: `01-main-prose.ko.draft.md` P19, 94행.
- 원문 문단 전체:

```text
Only once more did the Romans make any endeavour to complete the
subjection of Britain by adding the Gaelic tribes of the Scottish
Highlands to the list of their tributaries. In 208-9-10 the warlike
emperor Severus led the legions north of the Wall of Antoninus, and
set to work to tame the Caledonians by felling their forests, building
roads across their hills, and erecting forts among them. He overran
the land beyond the Firth of Forth, and might perchance have ended
by conquering the whole island, but he died of disease at York early
in 211. His successors drew back, abandoned his conquests, and never
attempted again to subjugate the Caledonians.
```

- 교정 전: 그는 포스만 너머의 땅을 휩쓸었으며, 어쩌면 마침내 섬 전체를 정복했을지도 모른다.
- 교정 후: 그는 포스만 너머의 땅을 휩쓸었으며, 병으로 죽지 않았다면 어쩌면 마침내 섬 전체를 정복할 수도 있었을 것이다.

`might perchance have ended by conquering ... but he died`는 이미 정복했을 가능성을 추측하는 문장이 아니다. 사망 때문에 실현되지 않은 정복 가능성이므로 ‘병으로 죽지 않았다면’이라는 조건과 ‘정복할 수도 있었을 것이다’라는 유보를 명시했다. 바로 뒤의 ‘그러나 211년 초 요크에서 병으로 죽었다.’와 후계자들의 철수 문장은 원래 바이트 그대로다. 현대 역사 지식으로 원저의 정복 범위·날짜·가능성 평가를 고친 것이 아니다.

## 제12장 P20: 살해 목적과 방치·학대의 대상 명료화

- 원문 위치: `source-en.txt` 7243–7251행. 번역 위치: `12-main-prose.ko.draft.md` P20, 108행.
- 원문 문단 전체:

```text
Edward was constrained by force to resign his crown, and at once
thrown into prison. He was first consigned to the charge of Henry of
Lancaster, the brother of Earl Thomas; but Henry kept him safely, and
there were those who did not desire his safety. Presently the queen and
Mortimer took him from Lancaster's hands and removed him to Berkeley
Castle. There he was treated with gross neglect and cruelty, in the
deliberate design of ending his life; but when his constitution proved
strong enough to resist all privations, his keepers secretly put him to
death (September 21, 1327).
```

- 교정 전: 원문에 따르면 그곳에서 일부러 목숨을 끊게 하려는 의도로 극심한 방치와 학대를 당했다.
- 교정 후: 원문에 따르면 그곳에서는 에드워드를 죽게 하려는 이들이 그를 극심하게 방치하고 잔혹하게 학대했다.

‘목숨을 끊게 하려는’은 에드워드에게 자살하도록 강요했다는 뜻으로 읽힐 수 있었다. 원문은 다른 이들이 방치와 학대로 에드워드를 죽게 하려 했다는 목적을 서술한다. 행위자를 ‘에드워드를 죽게 하려는 이들’, 그 행위의 대상을 ‘그를’로 분리하고 방치·학대를 능동형으로 옮겼다. 원문의 수동태가 이 단계에서 특정 개인을 명시하지 않으므로 왕비·모티머의 직접 가해나 명령을 추가로 단정하지 않았다. 이어지는 `his keepers secretly put him to death`에 해당하는 감시자들의 비밀 살해 문장과 1327년 9월 21일은 그대로 유지했다. 이 수정은 자살 유도라는 원문 밖 해석을 막는 명료화이며, 실제 사망 경위에 대한 현대 역사학의 결론을 확정하는 작업이 아니다.

## 동일 바이트 백업 및 변경 파일 단독 해시

기존 파일을 수정하기 전에 아래 세 파일을 [교정 전 백업 폴더](revisions/pre-sample-correction/)에 같은 파일명으로 복사하고, 원본과 바이트 전체가 같은지 확인했다. 백업은 이후 수정하지 않았다.

| 파일 | 교정 전 바이트 | 교정 전 SHA-256 | 교정 후 바이트 | 교정 후 SHA-256 | 백업 |
|---|---:|---|---:|---|---|
| 01-main-prose.ko.draft.md | 38201 | C288A99171D449990CD97DE269737763655A3D7F198CFCA961524895D8DE64AA | 38239 | A22E7A897A167B2B29E68D8F45CAD566D27EAFDCCDCFA94D7D841EA545832B84 | [01-main-prose.ko.draft.md](revisions/pre-sample-correction/01-main-prose.ko.draft.md) |
| 12-main-prose.ko.draft.md | 24040 | 0F0C57447CD8CEAD6490C5B963D6A631FCCEAAB1A2C8ABFAEF4EA5018F6EE3AB | 24058 | B73F8254D37110649DC0E31A61AFFBE0A8FD41338B62602AC9168EFD3EB13736 | [12-main-prose.ko.draft.md](revisions/pre-sample-correction/12-main-prose.ko.draft.md) |
| 12-translation-qa.md | 7976 | D60908E93802CF0AFF2F8883D299EED5248FFA0BBE7481E9F956B1E1D9B28FF3 | 9305 | ABA63D7744DE4D5C1270CE2DD8CB2801C8301F8A0F81A991883B89C6F91C8ACD | [12-translation-qa.md](revisions/pre-sample-correction/12-translation-qa.md) |

## 검증 결과와 범위

- 두 초안 각각에서 지정한 원래 문장 하나를 새 문장 하나로 치환한 결과와 저장 파일의 전체 바이트가 일치한다. 각 파일에서 바뀐 물리적 줄은 1개뿐이고 다른 문장·주석·여백·줄바꿈은 동일하다.
- 제1장 P01–P29 29개, 방주 16개, 캡션 2개, 각주 [1]·[2]의 호출과 본문을 교정 전후 대조했다. 제12장 P01–P21 21개, 방주 16개, 캡션 1개, 각주 [19]–[21]의 호출과 본문도 같은 방식으로 확인했다.
- 각 초안의 제목 열·문단 표지와 순서·아라비아숫자 열·캡션·각주·줄바꿈은 교정 전후 동일하다. 새 번역·QA와 이 기록은 UTF-8 엄격 디코딩으로 읽을 수 있고 U+FFFD가 없다.
- 원문 1,881,002바이트 및 SHA-256 `74C6692775FDD51D7E8F2814C5FE0C26D41221E6DA790108DD895E6CD3E314A4`를 교정 전후 확인했다.
- 아래 원문·관리 파일 및 나머지 37개 제1–39장 단독 초안은 교정 전후 전체 바이트와 단독 해시가 같다. 변경하지 않은 기존 장별 QA도 동일함을 확인했다.
- 이 문서 교정에는 코드·로직 변경이 없어 단위·통합 테스트나 빌드를 실행하지 않았다. Git 조회·커밋·푸시를 실행하지 않았다.

### 변경하지 않은 원문·관리 파일

| 파일 | 바이트 | 교정 전후 동일 SHA-256 |
|---|---:|---|
| source-en.txt | 1881002 | 74C6692775FDD51D7E8F2814C5FE0C26D41221E6DA790108DD895E6CD3E314A4 |
| source-manifest.json | 386 | 36F1221B15BE8D608E2C320384F90BFBF3476688A7F15DE8635952E54C4A3DD5 |
| review-independent-samples.ko.md | 41386 | 8A3F021207675D7A1E2F7CC52E41F72146C8FBF7499355B122ADFABF303362A5 |
| prefaces.ko.draft.md | 5728 | 96B127AECF7B5CDBA0ADB3B6DF814359DBC215B737D7910B1995EE9C3EF7CEAD |

### 변경하지 않은 나머지 37개 단독 초안

제40–44장은 별도 작업 중이므로 이 표와 불변 비교 대상에 포함하지 않는다.

| 파일 | 바이트 | 교정 전후 동일 SHA-256 |
|---|---:|---|
| 02-coming-of-english.ko.draft.md | 26053 | 9F95A5C5B52F453551E646630A21CBCF7A814ED0A4E3E9C88C965CB29CED320B |
| 03-conversion-wessex.ko.draft.md | 30411 | 87109E0842EE498071F1119C2FD37A961E5DC559ADB530793BB3ABC4037CD93F |
| 04-main-prose.ko.draft.md | 47117 | F1BC70CB4BA5BFC3BBA0D6ABE3A49C5C14BEFE630DCD4636AC98CB2B230B13EB |
| 05-main-prose.ko.draft.md | 44794 | 1D4454E6C3B29DE081DB665C4BA3D98F5287FD5D4E30D0A2F1013BF121A1B83E |
| 06-main-prose.ko.draft.md | 39564 | E62BE5C335FB6FB3421936F4F95D4CF0D593FD95FFBB2C731AC835DAC9747F2C |
| 07-main-prose.ko.draft.md | 44214 | 861EB67B68B944C02EBE82C184F5CB71362DFF85652C42684B5E60F5256A12EF |
| 08-main-prose.ko.draft.md | 44746 | BB1AEAE7349254D8BCD3C0FBE0AFC8D3323FCB58889F432C776CADD680D0E7EF |
| 09-main-prose.ko.draft.md | 52402 | 75108A5E4B67C2690C0CE40DBA835C498BF572E577207DD9EBCEB41C22145ED8 |
| 10-main-prose.ko.draft.md | 36142 | 5FF956122DA4799AECAFDF3E69482FECA1E636C099D835F0DB611432578A062B |
| 11-main-prose.ko.draft.md | 61745 | F7752C1555B3E42C202BE4AEBA75507B9EC58293D22077E4131E39A6ABBD8226 |
| 13-main-prose.ko.draft.md | 60670 | C076F13838362254005F1B5C5B42E81C8320BCB50D1C8BA3356BF99C96B853E8 |
| 14-main-prose.ko.draft.md | 29299 | 92F8B20F110D03D653A6C41C396F913A2E03B99D6C6BC06479292E07C00A3CAB |
| 15-main-prose.ko.draft.md | 18426 | D26B34E6A61A02FE4AEC71F491454AB14C3034ED6E0D186B1BA8A17DB77D2917 |
| 16-main-prose.ko.draft.md | 26340 | 6ACBD152215B1335CD2CE5ED81275639BD0B2EA61054C062024F818FCC527882 |
| 17-main-prose.ko.draft.md | 38748 | 4B6D0B3EE4A86A28FADC73907F902D5CE0E58A7B32EE2E09E5F703E7E14CD2CF |
| 18-main-prose.ko.draft.md | 38866 | 5372554FFA7EBF187A86A4FDDA39EC121051A6A1F52E804628CE09EC37FFD1BC |
| 19-main-prose.ko.draft.md | 33172 | 525308F8F69E87067F68BCE08DAE701AC8C98C61AE009DDB5C152ED5FE1CA59D |
| 20-main-prose.ko.draft.md | 26742 | 55ED51F0EA664AE9105FB1ED4D4A050D2086E0975732F8ED6AADB88EB2A38B14 |
| 21-main-prose.ko.draft.md | 36827 | 8011440AD2F118FCE60138C360765B2A05153FE73743F9728D556409C34E0917 |
| 22-main-prose.ko.draft.md | 48177 | 3EE08B4064A33495F640982DCE9DB8CD7BE2603885C51C639C0ABBB3B98C7710 |
| 23-main-prose.ko.draft.md | 21695 | CB9226B4844453BE49FEA66D86E55904C5F16CE6B014348E837D56E9696CBA7C |
| 24-main-prose.ko.draft.md | 74949 | 1572F8452B62A40E35D942A9ABC8BA460C37C2FCD2BD09B3932FB6B3AC12372D |
| 25-main-prose.ko.draft.md | 33277 | 941626D89CA302BC66B357BAE57C930F6B94CA18C028A33C2B07C781336557D3 |
| 26-main-prose.ko.draft.md | 47839 | 041F6230096266374A3D6FDBFB6091C87B9403BF19B129B3A2B93179F073ED88 |
| 27-main-prose.ko.draft.md | 63744 | 5BB32CB8E40C2DFDCD0F9991637DEB0CC5ADF4CC8DFD2E25DC2B523C9D55F04B |
| 28-main-prose.ko.draft.md | 37123 | 855E1838269F8C26DA1A02C1E09B9054C5BDF98685D04AF60713E79256BE49B7 |
| 29-main-prose.ko.draft.md | 42848 | CADE47DD002427FBE2EFDDE54F736EAE6D5CFF16B133775884800A5538D159C1 |
| 30-main-prose.ko.draft.md | 23618 | FC6E66DC98DB7DACE58B2470B78A6B9C35CD7C9849F084F88DDDE7E0F0A48399 |
| 31-main-prose.ko.draft.md | 44018 | 31D24BC98728D29E32423386E8688A60C181B6DB2CF3461A3054B7EF637D58F6 |
| 32-main-prose.ko.draft.md | 50479 | 3D2D51C41E1DEF596EBC6DDB5918F52EB2F94A78FBBE46CCB984FF1B8446EE31 |
| 33-main-prose.ko.draft.md | 39893 | E754B1CCB5A501295D752CE8370D4F1C73455E4B65B910A00264F19293E2B8DB |
| 34-main-prose.ko.draft.md | 81232 | F9D9856695673DDB11B21BE8A69A8123B94D02E54A909E2434A2F1068CA64844 |
| 35-main-prose.ko.draft.md | 54141 | F9073D16E5B4AA33D2A21A396682097A506D8AF81D6DBE22E09D4306C5EB7EA0 |
| 36-main-prose.ko.draft.md | 47516 | 3C943EEF653C7E4308C6E4DCD74CFDAFF0A4E30D864BEC5BED6D8406AA84B078 |
| 37-main-prose.ko.draft.md | 61222 | 9DDF41F42647D88A2E48B996AE8498B88D367161B95761DF5DC37C968FBB86A3 |
| 38-main-prose.ko.draft.md | 82899 | EB26F69F72C92B4B6F524036559382FE327497FC87FA6FDD37391CADCC85D14E |
| 39-main-prose.ko.draft.md | 45712 | 6BDEDAC2F1F3CAEF184B370DE6DD9BA644AF436ACE42FAAEC67084FCD43204CA |

## 표본 한계와 남은 검토

기존 독립 검토는 제1·4·8·12·16·20·24·28·32·35·37·39장 각 1문단, 합계 12문단을 끝까지 대조한 표본이다. 그중 확인된 두 건만 이번에 고쳤으며, 이번 작업에서 나머지 10개 표본이나 모든 장을 새로 전수 대조한 것은 아니다. 다른 선정 문단에서 뚜렷한 오류가 확인되지 않았다는 결과도 표본 밖 번역의 정확성·완전성을 보증하지 않는다.

번역 오류와 원저의 역사적 사실 오류·시대적 편향은 구분한다. 제1장의 정복 가능성은 원저자의 반사실적 평가를 보존했고, 제12장의 사망 경위·날짜는 원문 서술로 유지했다. 기존 역사 감수 대기 사항은 해소된 것으로 표시하지 않았다. 전수 의미 대조, 전문 역사 감수, 통합본 검증은 이번 교정의 완료 범위가 아니다.

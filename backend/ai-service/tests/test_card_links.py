import pytest

from app.card_links import strip_card_links

A = 'aaaaaaaa-2222-3333-4444-555555555555'
B = 'bbbbbbbb-2222-3333-4444-555555555555'

# 카드 본문 링크 [글자](card:<uuid>)의 검증 표(DEC-53, docs/design/worldstudio-independent-schema.md '링크 검증 표').
# 같은 행을 서버(Kotlin)와 화면(TypeScript)도 따로 검사한다. 링크를 찾는지는 글자로 벗긴 결과(링크면 글자만 남고 아니면 그대로)로 본다.
TABLE = [
    (f'[승상](card:{A})', '승상'),
    (f'앞 [갑](card:{A}) 중 [을](card:{B}) 뒤', '앞 갑 중 을 뒤'),
    (f'[갑](card:{A})[을](card:{B})', '갑을'),
    (f'[갑](card:{A.upper()})', '갑'),  # 대소문자 무시
    (f'`[갑](card:{A})`', '`갑`'),  # 코드(백틱) 안도 링크
    (f'[](card:{A})', f'[](card:{A})'),  # 글자 0자
    ('[갑](card:1111)', '[갑](card:1111)'),  # UUID 형식이 아님
    (f'[갑](card: {A})', f'[갑](card: {A})'),  # 공백
    (f'[갑](CARD:{A})', f'[갑](CARD:{A})'),  # card:는 소문자뿐
    ('[갑](https://example.com)', '[갑](https://example.com)'),  # 외부 링크
    (f'[[갑]](card:{A})', f'[[갑]](card:{A})'),  # 글자 안의 [ ]
    (f'[갑\n을](card:{A})', f'[갑\n을](card:{A})'),  # 글자 안의 줄바꿈
    (f'[{"가" * 200}](card:{A})', '가' * 200),
    (f'[{"가" * 201}](card:{A})', f'[{"가" * 201}](card:{A})'),  # 200자 초과
    (f'[갑[을]](card:{A})', f'[갑[을]](card:{A})'),  # 중첩 괄호
    (f'[갑]을](card:{A})', f'[갑]을](card:{A})'),
    (f'([갑](card:{A}))', '(갑)'),
    (f'card:{A}', f'card:{A}'),  # 링크 모양이 아님
]


@pytest.mark.parametrize('body,stripped', TABLE, ids=[str(i + 1) for i in range(len(TABLE))])
def test_strip_card_links_follows_the_verification_table(body, stripped):
    assert strip_card_links(body) == stripped

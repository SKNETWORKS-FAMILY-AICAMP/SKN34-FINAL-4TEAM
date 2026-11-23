-- 세계관 카드 카테고리(운영 관리): 카드 유형(card_type)을 이 표의 코드로 합친다. 기본 8종을 시드로 넣고 운영자가 추가·이름·아이콘·순서·숨김을 바꾼다(삭제 없음).
-- 카드 쪽은 FK 없이 서비스가 코드를 확인한다(장르 DEC-56과 같은 방식). 그래서 두 카드 표의 card_type CHECK(기본 8종 고정)를 지운다.
CREATE TABLE worldstudio.card_category (
    code text PRIMARY KEY,
    name text NOT NULL UNIQUE,
    icon text,
    active boolean NOT NULL DEFAULT true,
    position integer NOT NULL
);
INSERT INTO worldstudio.card_category (code, name, icon, active, position) VALUES
    ('character', '인물', NULL, true, 1),
    ('location', '장소', NULL, true, 2),
    ('organization', '조직', NULL, true, 3),
    ('ability', '능력', NULL, true, 4),
    ('object', '사물', NULL, true, 5),
    ('rule', '규칙', NULL, true, 6),
    ('event', '사건', NULL, true, 7),
    ('other', '기타', NULL, true, 8);
ALTER TABLE worldstudio.setting_card_draft DROP CONSTRAINT setting_card_draft_card_type_check;
ALTER TABLE worldstudio.setting_card_version DROP CONSTRAINT setting_card_version_card_type_check;

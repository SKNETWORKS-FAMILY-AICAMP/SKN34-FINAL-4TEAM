-- 장르 관리(DEC-56): 작품·세계관 장르를 이 표 하나로 합치고 운영 화면이 이름·아이콘·숨김·홈 노출·순서를 바꾼다.
-- 코드(code)는 바꾸지 않고 삭제는 없다(작품·세계관이 참조한다). 기존 30행은 모두 활성이다.
ALTER TABLE genre ADD COLUMN active boolean NOT NULL DEFAULT true;
ALTER TABLE genre ADD COLUMN position integer NOT NULL DEFAULT 0;
ALTER TABLE genre ADD COLUMN featured boolean NOT NULL DEFAULT false;
ALTER TABLE genre ADD COLUMN emoji text;
ALTER TABLE genre ADD CONSTRAINT genre_name_unique UNIQUE (name);
-- 표시 순서는 코드 순(genre-01=1 …)으로 채운다. 이후 새 행의 순서는 서비스가 정하므로 기본값은 없앤다.
UPDATE genre SET position = (SELECT count(*) FROM genre other WHERE other.code <= genre.code);
ALTER TABLE genre ALTER COLUMN position DROP DEFAULT;
-- 홈 장르 칩은 기존 고정 칩(판타지·SF·고전)에 맞춘다.
UPDATE genre SET featured = true, emoji = '✨' WHERE code = 'genre-01';
UPDATE genre SET featured = true, emoji = '🛰' WHERE code = 'genre-14';
UPDATE genre SET featured = true, emoji = '📜' WHERE code = 'genre-28';

-- 운영자의 공개 세계관 제한(DEC-45): 공개 세계관 경로(목록·상세·카드 검색·이미지·가져오기)만 404로 숨긴다.
-- 소유자의 열람·편집, 연결된 소설의 독자 설정 위키, Fork 이어받기는 건드리지 않는다(작품은 작품 제한으로 다룬다).
ALTER TABLE worldstudio.world ADD COLUMN restricted boolean NOT NULL DEFAULT false;

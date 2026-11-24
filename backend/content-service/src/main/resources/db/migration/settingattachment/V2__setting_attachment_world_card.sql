-- 설정 첨부는 옛 작품 설정 문서 또는 WorldStudio 세계관 카드 중 정확히 한 곳에 붙는다(#735).
-- 카드는 worldstudio 스키마와 별도 Flyway 이력이라 FK를 두지 않고, 서비스가 세계관 소유자와 지우지 않은 카드를 확인한다.
ALTER TABLE setting_attachment ALTER COLUMN setting_document_id DROP NOT NULL;
ALTER TABLE setting_attachment ADD COLUMN world_card_id varchar(36);
ALTER TABLE setting_attachment ADD CONSTRAINT setting_attachment_one_target
    CHECK ((setting_document_id IS NULL) <> (world_card_id IS NULL));
CREATE INDEX setting_attachment_card ON setting_attachment(world_card_id, created_at, id);

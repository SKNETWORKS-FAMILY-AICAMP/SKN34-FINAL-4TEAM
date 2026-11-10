-- Owner of a member-filed support inquiry. Legacy service-token records keep NULL and are never exposed by the member APIs.
-- No FK: Core owns members, like report.reporter_id.
ALTER TABLE operations.inquiry ADD COLUMN member_id UUID;

CREATE INDEX inquiry_member_created_at_id_idx ON operations.inquiry (member_id, created_at DESC, id DESC);

-- Use 기타 for sample sections without an existing general-setting category.
INSERT INTO setting_category (id, name, code)
VALUES ('기타', '기타', '기타')
ON CONFLICT (id) DO NOTHING;

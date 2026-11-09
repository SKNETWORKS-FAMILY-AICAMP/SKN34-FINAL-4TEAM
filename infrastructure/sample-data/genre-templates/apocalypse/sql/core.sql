-- Generated from infrastructure/sample-data/core/*.csv by load.py. Do not edit by hand.
-- Additive development samples: rows whose key already exists are kept as-is (ON CONFLICT DO NOTHING).

INSERT INTO auth_member (id, email, password_hash, nickname, operator) VALUES
('b09cdf87-6901-50df-9c76-881c81f4f034', 'genre-templates-v1@sample.invalid', '!sample-import-login-disabled', '장르 템플릿 샘플', false)
ON CONFLICT (id) DO NOTHING;

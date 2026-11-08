-- Generated from infrastructure/sample-data/core/*.csv by load.py. Do not edit by hand.
-- Additive development samples: rows whose key already exists are kept as-is (ON CONFLICT DO NOTHING).

INSERT INTO auth_member (id, email, password_hash, nickname, operator) VALUES
('b1b09f26-1c1e-3a11-9bb1-6f0d7927ab44', 'sample-b1b09f26@example.test', '!sample-import-login-disabled', '운영팀', false),
('42031238-8164-35ef-afc4-8d59fad533e0', 'sample-42031238@example.test', '!sample-import-login-disabled', '윤서하', false),
('9cf2042a-05eb-31c5-ab1e-22faffe6612a', 'sample-9cf2042a@example.test', '!sample-import-login-disabled', '민준', false),
('7baae385-c852-3697-a7fe-8ad6d527111c', 'sample-7baae385@example.test', '!sample-import-login-disabled', '하은', false),
('4bb7204a-0680-367e-82ae-ff1ffcfe54e1', 'sample-4bb7204a@example.test', '!sample-import-login-disabled', '민서', false),
('108a6f26-be0a-3fef-8efa-9798220e1f1d', 'sample-108a6f26@example.test', '!sample-import-login-disabled', '서진', false),
('a59701e8-69ec-35ba-afb3-0a2b3c75781f', 'sample-a59701e8@example.test', '!sample-import-login-disabled', '지우', false),
('fa06ea41-16ad-3f50-b6f0-7f5ac0556f74', 'sample-fa06ea41@example.test', '!sample-import-login-disabled', '유나', false),
('991e8ea4-bda8-389d-83e8-679041ea3f79', 'sample-991e8ea4@example.test', '!sample-import-login-disabled', 'tokki', false)
ON CONFLICT (id) DO NOTHING;

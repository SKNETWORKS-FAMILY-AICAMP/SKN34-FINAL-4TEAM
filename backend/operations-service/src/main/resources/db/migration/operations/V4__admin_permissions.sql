-- Business permissions for Core operators (auth_member.operator=true). Keys match the frontend ADMIN_PERMISSIONS.
CREATE TABLE operations.admin_permission (
    member_id UUID NOT NULL,
    permission VARCHAR(40) NOT NULL,
    PRIMARY KEY (member_id, permission),
    CONSTRAINT admin_permission_key_valid CHECK (permission IN (
        'works', 'users', 'comments', 'characterChats', 'feedback', 'rights',
        'events', 'notices', 'llm', 'jobs', 'credits', 'admins'
    ))
);

-- Sample admin seeded by Core (admin@example.test) receives every permission.
INSERT INTO operations.admin_permission (member_id, permission)
SELECT '5f0c2c7e-8a51-4d6b-9a39-1f4f2b6d0a01'::uuid, permission
FROM unnest(ARRAY[
    'works', 'users', 'comments', 'characterChats', 'feedback', 'rights',
    'events', 'notices', 'llm', 'jobs', 'credits', 'admins'
]) AS permission;

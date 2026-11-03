-- Physical implementation of the existing ERD's content subset.
-- External authentication owns credentials. Do not fabricate email/password values.
CREATE TABLE member (
    id varchar(200) PRIMARY KEY,
    email text UNIQUE, password_hash text, nickname text,
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE world (
    id varchar(36) PRIMARY KEY, owner_id varchar(200) NOT NULL REFERENCES member(id),
    name text NOT NULL, description text NOT NULL DEFAULT '',
    revision integer NOT NULL DEFAULT 0 CHECK (revision >= 0),
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE work (
    id varchar(36) PRIMARY KEY, owner_id varchar(200) NOT NULL REFERENCES member(id),
    world_id varchar(36) NOT NULL REFERENCES world(id), title text NOT NULL, description text NOT NULL,
    genre text NOT NULL DEFAULT '', work_type text NOT NULL CHECK(work_type IN ('original','fork')),
    visibility_status text NOT NULL CHECK(visibility_status IN ('private','public')),
    allow_fork_creation boolean NOT NULL, allow_fork_publication boolean NOT NULL,
    revision integer NOT NULL CHECK(revision >= 0), created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX work_owner ON work(owner_id);
CREATE INDEX work_public ON work(created_at DESC) WHERE visibility_status='public';
CREATE TABLE episode (
    id varchar(36) PRIMARY KEY, work_id varchar(36) NOT NULL REFERENCES work(id),
    sequence integer NOT NULL CHECK(sequence > 0), title text NOT NULL,
    publication_status text NOT NULL CHECK(publication_status IN ('draft','published')),
    published_version_id varchar(36), inherited boolean NOT NULL DEFAULT false,
    UNIQUE(work_id,sequence), UNIQUE(id,work_id),
    CHECK ((publication_status='published') = (published_version_id IS NOT NULL))
);
CREATE TABLE episode_draft (
    episode_id varchar(36) PRIMARY KEY REFERENCES episode(id), title text NOT NULL, content text NOT NULL,
    revision_no integer NOT NULL, updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE episode_version (
    id varchar(36) PRIMARY KEY, episode_id varchar(36) NOT NULL REFERENCES episode(id),
    content_version_id varchar(36) NOT NULL, revision_no integer NOT NULL,
    title_snapshot text NOT NULL, content text NOT NULL, created_at timestamptz NOT NULL,
    is_saved boolean NOT NULL DEFAULT true,
    UNIQUE(episode_id,content_version_id), UNIQUE(episode_id,id)
);
ALTER TABLE episode ADD CONSTRAINT episode_published_version_owner
    FOREIGN KEY(id,published_version_id) REFERENCES episode_version(episode_id,id) DEFERRABLE INITIALLY DEFERRED;
CREATE TABLE episode_publication (
    episode_id varchar(36) NOT NULL REFERENCES episode(id), episode_version_id varchar(36) NOT NULL,
    published_at timestamptz NOT NULL, PRIMARY KEY(episode_id,episode_version_id,published_at),
    FOREIGN KEY(episode_id,episode_version_id) REFERENCES episode_version(episode_id,id)
);
CREATE TABLE setting_category (id text PRIMARY KEY, name text NOT NULL UNIQUE);
INSERT INTO setting_category VALUES ('규칙','규칙'),('인물','인물'),('장소','장소'),('광물','광물'),('상태','상태'),('지식','지식'),('관계','관계');
CREATE TABLE setting_document (
    id varchar(36) PRIMARY KEY, world_id varchar(36) NOT NULL REFERENCES world(id),
    logical_id varchar(36) NOT NULL, category_id text NOT NULL REFERENCES setting_category(id),
    source_setting_document_id varchar(36) REFERENCES setting_document(id),
    name text NOT NULL, visibility_status text NOT NULL CHECK(visibility_status IN ('private','public')),
    UNIQUE(world_id,logical_id)
);
CREATE TABLE setting_version (
    id varchar(36) PRIMARY KEY, setting_document_id varchar(36) NOT NULL REFERENCES setting_document(id),
    content_version_id varchar(36) NOT NULL, revision_no integer NOT NULL,
    name_snapshot text NOT NULL, category_id text NOT NULL REFERENCES setting_category(id), content text NOT NULL,
    from_episode integer NOT NULL CHECK(from_episode > 0), to_episode integer,
    visibility_status text NOT NULL CHECK(visibility_status IN ('private','public')),
    known_by text[] NOT NULL, tags text[] NOT NULL, evidence text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    CHECK(to_episode IS NULL OR to_episode >= from_episode),
    UNIQUE(setting_document_id,content_version_id), UNIQUE(setting_document_id,id)
);
CREATE TABLE setting_draft (
    setting_document_id varchar(36) PRIMARY KEY REFERENCES setting_document(id),
    name text NOT NULL, category_id text NOT NULL REFERENCES setting_category(id), content text NOT NULL,
    from_episode integer NOT NULL CHECK(from_episode > 0), to_episode integer,
    visibility_status text NOT NULL CHECK(visibility_status IN ('private','public')),
    known_by text[] NOT NULL, tags text[] NOT NULL, evidence text NOT NULL,
    edit_order integer NOT NULL, updated_at timestamptz NOT NULL DEFAULT now(),
    CHECK(to_episode IS NULL OR to_episode >= from_episode)
);
CREATE TABLE setting_tag (
    id varchar(36) PRIMARY KEY, owner_id varchar(200) NOT NULL REFERENCES member(id), name text NOT NULL,
    UNIQUE(owner_id,name)
);
CREATE TABLE setting_document_tag (
    setting_document_id varchar(36) NOT NULL REFERENCES setting_document(id),
    tag_id varchar(36) NOT NULL REFERENCES setting_tag(id), PRIMARY KEY(setting_document_id,tag_id)
);
CREATE TABLE setting_visibility_history (
    setting_document_id varchar(36) NOT NULL, setting_version_id varchar(36) NOT NULL,
    visibility_status text NOT NULL, from_episode integer NOT NULL, to_episode integer,
    changed_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(setting_document_id,setting_version_id),
    FOREIGN KEY(setting_document_id,setting_version_id) REFERENCES setting_version(setting_document_id,id)
);
CREATE TABLE fork_policy_history (
    id varchar(36) PRIMARY KEY, work_id varchar(36) NOT NULL REFERENCES work(id),
    allow_fork_creation boolean NOT NULL, allow_fork_publication boolean NOT NULL,
    episode_scope text NOT NULL DEFAULT 'all', start_episode_id varchar(36),
    changed_at timestamptz NOT NULL, history_order integer NOT NULL,
    CHECK(episode_scope IN ('all','from','selected')),
    FOREIGN KEY(start_episode_id,work_id) REFERENCES episode(id,work_id), UNIQUE(work_id,id)
);
CREATE TABLE fork_policy_episode (
    fork_policy_history_id varchar(36) NOT NULL, work_id varchar(36) NOT NULL,
    episode_id varchar(36) NOT NULL, PRIMARY KEY(fork_policy_history_id,episode_id),
    FOREIGN KEY(work_id,fork_policy_history_id) REFERENCES fork_policy_history(work_id,id),
    FOREIGN KEY(episode_id,work_id) REFERENCES episode(id,work_id)
);
CREATE TABLE checkpoint (
    id varchar(36) PRIMARY KEY, source_work_id varchar(36) NOT NULL REFERENCES work(id),
    episode_id varchar(36) NOT NULL, episode_version_id varchar(36) NOT NULL,
    graph_state_ref text, status text NOT NULL DEFAULT 'content_only',
    created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(id,source_work_id),
    FOREIGN KEY(episode_id,source_work_id) REFERENCES episode(id,work_id),
    FOREIGN KEY(episode_id,episode_version_id) REFERENCES episode_version(episode_id,id)
);
CREATE TABLE checkpoint_episode (
    checkpoint_id varchar(36) NOT NULL, source_work_id varchar(36) NOT NULL,
    episode_id varchar(36) NOT NULL, episode_version_id varchar(36) NOT NULL,
    PRIMARY KEY(checkpoint_id,episode_id),
    FOREIGN KEY(checkpoint_id,source_work_id) REFERENCES checkpoint(id,source_work_id),
    FOREIGN KEY(episode_id,source_work_id) REFERENCES episode(id,work_id),
    FOREIGN KEY(episode_id,episode_version_id) REFERENCES episode_version(episode_id,id)
);
CREATE TABLE checkpoint_setting (
    checkpoint_id varchar(36) NOT NULL REFERENCES checkpoint(id), setting_document_id varchar(36) NOT NULL,
    setting_version_id varchar(36) NOT NULL, PRIMARY KEY(checkpoint_id,setting_document_id),
    FOREIGN KEY(setting_document_id,setting_version_id) REFERENCES setting_version(setting_document_id,id)
);
CREATE TABLE fork (
    work_id varchar(36) PRIMARY KEY REFERENCES work(id), source_work_id varchar(36) NOT NULL REFERENCES work(id),
    owner_id varchar(200) NOT NULL REFERENCES member(id), source_checkpoint_id varchar(36) NOT NULL,
    confirmed_policy_history_id varchar(36), conditions_confirmed_at timestamptz,
    world_mode text NOT NULL CHECK(world_mode IN ('following','independent')),
    independent_world_id varchar(36) REFERENCES world(id), source_title text NOT NULL, direction text NOT NULL,
    world_revision integer NOT NULL DEFAULT 0, created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE(owner_id,source_work_id),
    FOREIGN KEY(source_checkpoint_id,source_work_id) REFERENCES checkpoint(id,source_work_id),
    FOREIGN KEY(source_work_id,confirmed_policy_history_id) REFERENCES fork_policy_history(work_id,id),
    CHECK ((world_mode='independent') = (independent_world_id IS NOT NULL))
);
CREATE TABLE fork_source_setting (
    fork_work_id varchar(36) NOT NULL REFERENCES fork(work_id), setting_document_id varchar(36) NOT NULL,
    setting_version_id varchar(36) NOT NULL, PRIMARY KEY(fork_work_id,setting_document_id),
    FOREIGN KEY(setting_document_id,setting_version_id) REFERENCES setting_version(setting_document_id,id)
);
CREATE TABLE fork_source_change (
    id varchar(36) PRIMARY KEY, fork_work_id varchar(36) NOT NULL REFERENCES fork(work_id),
    source_change_ref text NOT NULL, decision_status text NOT NULL CHECK(decision_status IN ('apply','reject')),
    notified_at timestamptz, decided_at timestamptz NOT NULL DEFAULT now(), UNIQUE(fork_work_id,source_change_ref)
);
CREATE TABLE ai_job (
    id varchar(36) PRIMARY KEY, requester_id varchar(200) NOT NULL REFERENCES member(id),
    work_id varchar(36) NOT NULL REFERENCES work(id), kind text NOT NULL,
    status text NOT NULL CHECK(status IN ('running','completed','failed')),
    model text, input_tokens integer, output_tokens integer, failure_code text,
    created_at timestamptz NOT NULL DEFAULT now(), finished_at timestamptz
);
CREATE TABLE ai_proposal (
    id varchar(36) PRIMARY KEY, job_id varchar(36) NOT NULL REFERENCES ai_job(id),
    kind text NOT NULL, content text NOT NULL, evidence jsonb NOT NULL,
    selection_status text NOT NULL, application_status text NOT NULL,
    base_episode_version_id varchar(36) REFERENCES episode_version(id),
    applied_episode_version_id varchar(36) REFERENCES episode_version(id),
    base_revision integer NOT NULL, base_draft_content text NOT NULL, prompt text NOT NULL,
    provider_response_id text, created_at timestamptz NOT NULL
);
-- content_work remains an untouched legacy backup; V3 copies its records transactionally.

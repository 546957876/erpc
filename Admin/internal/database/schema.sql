CREATE TABLE IF NOT EXISTS admin_users (
    singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
    username text NOT NULL UNIQUE,
    password_hash text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS config_revisions (
    revision bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    payload jsonb NOT NULL,
    content_hash char(64) NOT NULL,
    created_by text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS erpc_runtime (
    singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
    pid integer,
    process_started_at timestamptz,
    running_revision bigint REFERENCES config_revisions(revision),
    binary_version text NOT NULL DEFAULT '',
    binary_commit text NOT NULL DEFAULT '',
    last_error text NOT NULL DEFAULT ''
);

INSERT INTO erpc_runtime (singleton) VALUES (true)
ON CONFLICT (singleton) DO NOTHING;

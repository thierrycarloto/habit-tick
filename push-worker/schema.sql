CREATE TABLE IF NOT EXISTS subs (
    id TEXT PRIMARY KEY,
    endpoint TEXT NOT NULL,
    tz TEXT NOT NULL DEFAULT 'America/Sao_Paulo',
    reminders TEXT NOT NULL DEFAULT '[]',
    done TEXT NOT NULL DEFAULT '{}',
    snoozes TEXT NOT NULL DEFAULT '[]',
    due TEXT NOT NULL DEFAULT '[]',
    updated_at INTEGER NOT NULL DEFAULT 0
);

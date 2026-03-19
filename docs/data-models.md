# Data Models

**Last updated:** 2026-03-09

## Database: PostgreSQL 16

Connection: `postgres://browser_streamer:<password>@postgres:5432/browser_streamer`

---

## Schema Overview

The control plane uses a custom migration runner (`runMigrations` in `db.go`) that applies `*.up.sql` files from `control-plane/migrations/` in sorted order. Migration state tracked in `schema_migrations`.

---

## Tables

### `users`
Created in `001_initial.up.sql`

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | TEXT | PRIMARY KEY | Clerk user ID |
| `email` | TEXT | NOT NULL | User email |
| `name` | TEXT | NOT NULL DEFAULT '' | Display name |
| `created_at` | TIMESTAMPTZ | NOT NULL DEFAULT NOW() | Creation time |
| `updated_at` | TIMESTAMPTZ | NOT NULL DEFAULT NOW() | Last update |

---

### `api_keys`
Created in `001_initial.up.sql`

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | TEXT | PRIMARY KEY DEFAULT gen_random_uuid() | Key ID |
| `user_id` | TEXT | NOT NULL → users(id) CASCADE | Owner |
| `name` | TEXT | NOT NULL | User-provided label |
| `prefix` | TEXT | NOT NULL | First 8 chars of key (e.g., `dzl_AbC1`) for display |
| `key_hash` | TEXT | NOT NULL | HMAC-SHA256 hash of full secret |
| `created_at` | TIMESTAMPTZ | NOT NULL DEFAULT NOW() | Creation time |
| `last_used_at` | TIMESTAMPTZ | — | Last successful auth time |

**Indexes:** `idx_api_keys_hash` on `key_hash` (fast auth lookup), `idx_api_keys_user` on `user_id`

---

### `stream_destinations`
Created in `001_initial.up.sql`

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | TEXT | PRIMARY KEY DEFAULT gen_random_uuid() | Destination ID |
| `user_id` | TEXT | NOT NULL → users(id) CASCADE | Owner |
| `name` | TEXT | NOT NULL | Display name |
| `platform` | TEXT | NOT NULL DEFAULT 'custom' | Platform type |
| `rtmp_url` | TEXT | NOT NULL | RTMP ingest URL |
| `stream_key` | TEXT | NOT NULL | AES-256-GCM encrypted stream key |
| `enabled` | BOOLEAN | NOT NULL DEFAULT true | Whether destination is active |
| `created_at` | TIMESTAMPTZ | NOT NULL DEFAULT NOW() | Creation time |
| `updated_at` | TIMESTAMPTZ | NOT NULL DEFAULT NOW() | Last update |

**Index:** `idx_stream_destinations_user` on `user_id`

**Note:** `stream_key` is encrypted at rest using AES-256-GCM. The encryption key is loaded from the `ENCRYPTION_KEY` env var (32-byte hex).

---

### `stages`
Created from `endpoints` table (migration `003`), renamed and extended in migrations `004`–`005`.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | UUID | PRIMARY KEY | Stage ID (UUIDv7, generated in Go) |
| `user_id` | TEXT | NOT NULL → users(id) CASCADE | Owner |
| `name` | TEXT | NOT NULL DEFAULT '' | User-provided stage name |
| `status` | TEXT | NOT NULL DEFAULT 'inactive' | `inactive` \| `starting` \| `running` \| `stopping` |
| `pod_name` | TEXT | — | Kubernetes pod name (e.g., `streamer-<uuid8>`) |
| `pod_ip` | TEXT | — | Pod IP (set when running) |
| `destination_id` | TEXT | — → stream_destinations(id) | Linked stream destination |
| `preview_token` | TEXT | — | `dpt_*` token for authenticated preview URLs |
| `stream_key` | TEXT | UNIQUE (partial, WHERE NOT NULL) | `dsk_*` key for RTMP ingest routing — auto-generated on stage creation |
| `slug` | TEXT | UNIQUE (partial, WHERE NOT NULL) | Short ID for public watch URLs (last 12 hex chars of UUIDv7 ID) |
| `updated_at` | TIMESTAMPTZ | NOT NULL DEFAULT NOW() | Last status update |
| `created_at` | TIMESTAMPTZ | NOT NULL DEFAULT NOW() | Creation time |

**Indexes:** `idx_endpoints_user_id` on `user_id`, `idx_stages_stream_key` on `stream_key`, `idx_stages_slug` on `slug`

**ID generation:** Stage IDs use UUIDv7 (time-ordered). All other UUIDs (preview tokens, stream keys) also use UUIDv7. The `slug` is derived from the last 12 hex characters of the stage ID. Existing UUIDv4 stages get slugs backfilled from their IDs in migration 016.

---

### `rtmp_sessions`
Created in `016_stage_streaming.up.sql`. Tracks active and historical RTMP publisher sessions.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | TEXT | PRIMARY KEY DEFAULT gen_random_uuid() | Session ID |
| `stage_id` | TEXT | NOT NULL | Stage being streamed to |
| `user_id` | TEXT | NOT NULL | Stage owner |
| `stream_key` | TEXT | NOT NULL | Stream key used (matches `stages.stream_key`) |
| `client_ip` | TEXT | NOT NULL DEFAULT '' | Publisher IP address |
| `started_at` | TIMESTAMPTZ | NOT NULL DEFAULT NOW() | When publisher connected |
| `ended_at` | TIMESTAMPTZ | — | When publisher disconnected (NULL = active) |

**Index:** `idx_rtmp_sessions_active` on `stage_id` WHERE `ended_at IS NULL`

---

### `schema_migrations`
Migration tracking table (created by `runMigrations` if not exists).

| Column | Type | Description |
|--------|------|-------------|
| `version` | TEXT PRIMARY KEY | Migration filename (e.g., `001_initial.up.sql`) |
| `applied_at` | TIMESTAMPTZ | When migration was applied |

---

## Migration History

| File | Description |
|------|-------------|
| `001_initial.up.sql` | Creates `users`, `api_keys`, `stream_destinations`, `session_log` |
| `002_nullable_direct_port.up.sql` | Makes `direct_port` nullable |
| `003_endpoints.up.sql` | Creates `endpoints` table (precursor to `stages`) |
| `004_rename_session_log_to_stage_log.up.sql` | Renames `session_log` → `stage_log` |
| `005_consolidate_stages.up.sql` | Renames `endpoints` → `stages`; adds `status`, `pod_name`, `pod_ip`, `updated_at`; drops `stage_log` |
| `006`–`015` | Various: destination_id, preview_token, provider fields, API key changes, capabilities |
| `016_stage_streaming.up.sql` | Adds `stream_key` to `stages`; creates `rtmp_sessions` table |

---

## Entity Relationships

```
users (1) ─────── (*) api_keys
users (1) ─────── (*) stream_destinations
users (1) ─────── (*) stages
stages (1) ────── (*) rtmp_sessions
```

All child tables cascade delete when user is deleted.


Migrations tracked in `schema_migrations` table, applied from `control-plane/migrations/`.

---

## In-Memory Models (Go)

### Stage
```go
type Stage struct {
    ID            string
    Name          string
    PodName       string
    PodIP         string
    DirectPort    int32
    CreatedAt     time.Time
    Status        StageStatus    // "inactive" | "starting" | "running" | "stopping"
    OwnerUserID   string
    DestinationID string
    PreviewToken  string
}
```

### Auth Info (Request Context)
```go
type authInfo struct {
    UserID string
    Method authMethod  // authMethodClerk | authMethodAPIKey
    KeyID  string      // only set for API key auth
}
```

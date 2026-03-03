# Data Models

**Last updated:** 2026-03-03

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
| `prefix` | TEXT | NOT NULL | First 8 chars of key (e.g., `bstr_AbC1`) for display |
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
| `id` | UUID | PRIMARY KEY DEFAULT gen_random_uuid() | Stage ID |
| `user_id` | TEXT | NOT NULL → users(id) CASCADE | Owner |
| `name` | TEXT | NOT NULL DEFAULT '' | User-provided stage name |
| `status` | TEXT | NOT NULL DEFAULT 'inactive' | `inactive` \| `starting` \| `running` \| `stopping` |
| `pod_name` | TEXT | — | Kubernetes pod name (e.g., `streamer-<uuid8>`) |
| `pod_ip` | TEXT | — | Pod IP (set when running) |
| `updated_at` | TIMESTAMPTZ | NOT NULL DEFAULT NOW() | Last status update |
| `created_at` | TIMESTAMPTZ | NOT NULL DEFAULT NOW() | Creation time |

**Index:** `idx_endpoints_user_id` on `user_id` (from original migration name)

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

---

## Entity Relationships

```
users (1) ─────── (*) api_keys
users (1) ─────── (*) stream_destinations
users (1) ─────── (*) stages
```

All child tables cascade delete when user is deleted.


Migrations tracked in `schema_migrations` table, applied from `control-plane/migrations/`.

---

## Tables

### users

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | TEXT | PRIMARY KEY | Clerk user ID |
| `email` | TEXT | NOT NULL | User email |
| `name` | TEXT | NOT NULL DEFAULT '' | Display name |
| `created_at` | TIMESTAMPTZ | NOT NULL DEFAULT NOW() | Account creation time |
| `updated_at` | TIMESTAMPTZ | NOT NULL DEFAULT NOW() | Last profile update |

Upserted on first Clerk JWT authentication. Email/name populated via profile API.

### api_keys

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | TEXT | PRIMARY KEY DEFAULT gen_random_uuid() | UUID |
| `user_id` | TEXT | NOT NULL REFERENCES users(id) ON DELETE CASCADE | Owner |
| `name` | TEXT | NOT NULL | User-provided label |
| `prefix` | TEXT | NOT NULL | First 13 chars + "..." for display |
| `key_hash` | TEXT | NOT NULL | SHA256(full_key), hex-encoded |
| `created_at` | TIMESTAMPTZ | NOT NULL DEFAULT NOW() | Creation time |
| `last_used_at` | TIMESTAMPTZ | (nullable) | Last authentication time |

**Indexes:** `idx_api_keys_hash` (key_hash), `idx_api_keys_user` (user_id)

**Key Format:** `bstr_<64-char-hex>` (80 chars total, 32 bytes of randomness)

### stream_destinations

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | TEXT | PRIMARY KEY DEFAULT gen_random_uuid() | UUID |
| `user_id` | TEXT | NOT NULL REFERENCES users(id) ON DELETE CASCADE | Owner |
| `name` | TEXT | NOT NULL | Display name |
| `platform` | TEXT | NOT NULL DEFAULT 'custom' | twitch, youtube, kick, restream, custom |
| `rtmp_url` | TEXT | NOT NULL | RTMP server URL |
| `stream_key` | TEXT | NOT NULL | AES-256-GCM encrypted, base64 encoded |
| `enabled` | BOOLEAN | NOT NULL DEFAULT true | Active toggle |
| `created_at` | TIMESTAMPTZ | NOT NULL DEFAULT NOW() | Creation time |
| `updated_at` | TIMESTAMPTZ | NOT NULL DEFAULT NOW() | Last update |

**Index:** `idx_stream_destinations_user` (user_id)

**Encryption:** Stream keys encrypted with AES-256-GCM using `ENCRYPTION_KEY` env var (32 bytes). Format: `base64(nonce + ciphertext)`.

### session_log

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | TEXT | PRIMARY KEY | Session UUID |
| `user_id` | TEXT | NOT NULL REFERENCES users(id) ON DELETE CASCADE | Owner |
| `pod_name` | TEXT | NOT NULL | Kubernetes pod name |
| `direct_port` | INTEGER | (nullable, migration 002) | HostPort allocation |
| `created_at` | TIMESTAMPTZ | NOT NULL DEFAULT NOW() | Session start |
| `ended_at` | TIMESTAMPTZ | (nullable) | Session end (null while active) |
| `end_reason` | TEXT | (nullable) | Why session ended (e.g., "deleted") |

**Index:** `idx_session_log_user` (user_id)

---

## Migrations

| File | Description |
|------|-------------|
| `001_initial.up.sql` | Creates all 4 tables with indexes |
| `002_nullable_direct_port.up.sql` | Makes `session_log.direct_port` nullable |

---

## In-Memory Models (Go)

### Session
```go
type Session struct {
    ID          string        // UUID
    PodName     string        // k8s pod name
    PodIP       string        // Pod cluster IP (empty until running)
    DirectPort  int32
    CreatedAt   time.Time
    Status      SessionStatus // "starting" | "running" | "stopping"
    OwnerUserID string        // Clerk user ID
}
```

### Manager (State Container)
```go
type Manager struct {
    mu            sync.RWMutex
    sessions      map[string]*Session
    clientset     *kubernetes.Clientset
    namespace     string
    streamerImage string
    podToken      string
    maxSessions   int
    db            *sql.DB
    auth          *authenticator
    encryptionKey []byte  // 32 bytes for AES-256
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

---

## Entity Relationships

```
users (1) ──→ (N) api_keys
users (1) ──→ (N) stream_destinations
users (1) ──→ (N) session_log
```

All child tables cascade delete on user removal.

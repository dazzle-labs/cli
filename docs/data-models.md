# Data Models

## Database: PostgreSQL 16

Connection: `postgres://browser_streamer:<password>@postgres:5432/browser_streamer`

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

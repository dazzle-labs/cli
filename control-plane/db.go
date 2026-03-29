package main

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"crypto/sha256"
	"database/sql"
	"encoding/base64"
	"encoding/hex"
	"fmt"
	"io"
	"log"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/lib/pq"
	_ "github.com/lib/pq"
)

func openDB() (*sql.DB, error) {
	host := envOrDefault("DB_HOST", "postgres")
	port := envOrDefault("DB_PORT", "5432")
	user := envOrDefault("DB_USER", "browser_streamer")
	pass := os.Getenv("DB_PASSWORD")
	name := envOrDefault("DB_NAME", "browser_streamer")

	dsn := fmt.Sprintf("host=%s port=%s user=%s password=%s dbname=%s sslmode=disable", host, port, user, pass, name)
	db, err := sql.Open("postgres", dsn)
	if err != nil {
		return nil, fmt.Errorf("open db: %w", err)
	}
	db.SetMaxOpenConns(10)
	db.SetMaxIdleConns(5)
	db.SetConnMaxLifetime(5 * time.Minute)

	if err := db.Ping(); err != nil {
		return nil, fmt.Errorf("ping db: %w", err)
	}
	return db, nil
}

func runMigrations(db *sql.DB, dir string) error {
	_, err := db.Exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
		version TEXT PRIMARY KEY,
		applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
	)`)
	if err != nil {
		return fmt.Errorf("create migrations table: %w", err)
	}

	files, err := filepath.Glob(filepath.Join(dir, "*.up.sql"))
	if err != nil {
		return fmt.Errorf("glob migrations: %w", err)
	}
	sort.Strings(files)

	for _, f := range files {
		version := filepath.Base(f)
		var exists bool
		err := db.QueryRow("SELECT EXISTS(SELECT 1 FROM schema_migrations WHERE version=$1)", version).Scan(&exists)
		if err != nil {
			return fmt.Errorf("check migration %s: %w", version, err)
		}
		if exists {
			continue
		}

		content, err := os.ReadFile(f)
		if err != nil {
			return fmt.Errorf("read migration %s: %w", version, err)
		}

		tx, err := db.Begin()
		if err != nil {
			return fmt.Errorf("begin tx for %s: %w", version, err)
		}
		if _, err := tx.Exec(string(content)); err != nil {
			tx.Rollback()
			return fmt.Errorf("execute migration %s: %w", version, err)
		}
		if _, err := tx.Exec("INSERT INTO schema_migrations(version) VALUES($1)", version); err != nil {
			tx.Rollback()
			return fmt.Errorf("record migration %s: %w", version, err)
		}
		if err := tx.Commit(); err != nil {
			return fmt.Errorf("commit migration %s: %w", version, err)
		}
		log.Printf("Applied migration: %s", version)
	}
	return nil
}

// --- User queries ---

func dbUpsertUser(db *sql.DB, id, email, name string) error {
	_, err := db.Exec(`
		INSERT INTO users (id, email, name, updated_at)
		VALUES ($1, $2, $3, NOW())
		ON CONFLICT (id) DO UPDATE SET email=$2, name=$3, updated_at=NOW()`,
		id, email, name)
	return err
}

func dbGetUserProfile(db *sql.DB, userID string) (email, name string, stageCount, apiKeyCount int, err error) {
	err = db.QueryRow(`
		SELECT u.email, u.name,
			(SELECT COUNT(*) FROM stages WHERE user_id=$1 AND status != 'inactive'),
			(SELECT COUNT(*) FROM api_keys WHERE user_id=$1)
		FROM users u WHERE u.id=$1`, userID).Scan(&email, &name, &stageCount, &apiKeyCount)
	return
}

// --- API key queries ---

func hashAPIKey(key string) string {
	h := sha256.Sum256([]byte(key))
	return hex.EncodeToString(h[:])
}

func generateAPIKey() (full string, prefix string) {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		panic(err)
	}
	full = "dzl_" + hex.EncodeToString(b)
	prefix = full[:7] + "..."
	return
}

func dbCreateAPIKey(db *sql.DB, userID, name string) (id, secret, prefix string, err error) {
	secret, prefix = generateAPIKey()
	hash := hashAPIKey(secret)
	err = db.QueryRow(`
		INSERT INTO api_keys (user_id, name, prefix, key_hash)
		VALUES ($1, $2, $3, $4)
		RETURNING id`, userID, name, prefix, hash).Scan(&id)
	return
}

func dbRotateAPIKey(db *sql.DB, userID, name string) (id, secret, prefix string, err error) {
	tx, err := db.Begin()
	if err != nil {
		return "", "", "", fmt.Errorf("begin tx: %w", err)
	}
	defer tx.Rollback()

	// Delete existing key with this name (if any)
	if _, err := tx.Exec(`DELETE FROM api_keys WHERE user_id=$1 AND name=$2`, userID, name); err != nil {
		return "", "", "", fmt.Errorf("delete existing key: %w", err)
	}

	// Create new key
	secret, prefix = generateAPIKey()
	hash := hashAPIKey(secret)
	err = tx.QueryRow(`INSERT INTO api_keys (user_id, name, prefix, key_hash) VALUES ($1, $2, $3, $4) RETURNING id`,
		userID, name, prefix, hash).Scan(&id)
	if err != nil {
		return "", "", "", fmt.Errorf("insert api key: %w", err)
	}

	if err := tx.Commit(); err != nil {
		return "", "", "", fmt.Errorf("commit tx: %w", err)
	}
	return id, secret, prefix, nil
}

type apiKeyRow struct {
	ID         string
	Name       string
	Prefix     string
	CreatedAt  time.Time
	LastUsedAt *time.Time
}

func dbListAPIKeys(db *sql.DB, userID string) ([]apiKeyRow, error) {
	rows, err := db.Query(`
		SELECT id, name, prefix, created_at, last_used_at
		FROM api_keys WHERE user_id=$1 ORDER BY created_at DESC`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var keys []apiKeyRow
	for rows.Next() {
		var k apiKeyRow
		if err := rows.Scan(&k.ID, &k.Name, &k.Prefix, &k.CreatedAt, &k.LastUsedAt); err != nil {
			return nil, err
		}
		keys = append(keys, k)
	}
	return keys, rows.Err()
}

func dbDeleteAPIKey(db *sql.DB, id, userID string) error {
	res, err := db.Exec("DELETE FROM api_keys WHERE id=$1 AND user_id=$2", id, userID)
	if err != nil {
		return err
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return fmt.Errorf("api key not found")
	}
	return nil
}

func dbLookupAPIKey(db *sql.DB, keyHash string) (userID, keyID string, err error) {
	err = db.QueryRow("SELECT user_id, id FROM api_keys WHERE key_hash=$1", keyHash).Scan(&userID, &keyID)
	if err == sql.ErrNoRows {
		return "", "", fmt.Errorf("invalid api key")
	}
	return
}

func dbTouchAPIKey(db *sql.DB, keyID string) {
	db.Exec("UPDATE api_keys SET last_used_at=NOW() WHERE id=$1", keyID)
}

// --- Stream destination queries ---

type streamDestRow struct {
	ID               string
	UserID           string
	Name             string
	Platform         string
	PlatformUserID   string
	PlatformUsername string
	RtmpURL          string
	StreamKey        string // encrypted
	AccessToken      string // encrypted
	RefreshToken     string // encrypted
	TokenExpiresAt   sql.NullTime
	Scopes           string
	CreatedAt        time.Time
	UpdatedAt        time.Time
}

const streamDestColumns = `id, user_id, name, platform, platform_user_id, platform_username, rtmp_url, stream_key, access_token, refresh_token, token_expires_at, scopes, created_at, updated_at`

func scanStreamDest(scanner interface{ Scan(...any) error }) (*streamDestRow, error) {
	var d streamDestRow
	err := scanner.Scan(&d.ID, &d.UserID, &d.Name, &d.Platform, &d.PlatformUserID, &d.PlatformUsername, &d.RtmpURL, &d.StreamKey, &d.AccessToken, &d.RefreshToken, &d.TokenExpiresAt, &d.Scopes, &d.CreatedAt, &d.UpdatedAt)
	if err != nil {
		return nil, err
	}
	return &d, nil
}

func dbCreateStreamDest(db *sql.DB, userID, name, platform, rtmpURL, encStreamKey string) (*streamDestRow, error) {
	row := db.QueryRow(`
		INSERT INTO stream_destinations (user_id, name, platform, rtmp_url, stream_key)
		VALUES ($1, $2, $3, $4, $5)
		RETURNING `+streamDestColumns,
		userID, name, platform, rtmpURL, encStreamKey)
	return scanStreamDest(row)
}

func dbUpdateStreamDest(db *sql.DB, id, userID, name, platform, rtmpURL, encStreamKey string) (*streamDestRow, error) {
	if encStreamKey != "" {
		row := db.QueryRow(`
			UPDATE stream_destinations SET name=$3, platform=$4, rtmp_url=$5, stream_key=$6, updated_at=NOW()
			WHERE id=$1 AND user_id=$2
			RETURNING `+streamDestColumns,
			id, userID, name, platform, rtmpURL, encStreamKey)
		return scanStreamDest(row)
	}
	row := db.QueryRow(`
		UPDATE stream_destinations SET name=$3, platform=$4, rtmp_url=$5, updated_at=NOW()
		WHERE id=$1 AND user_id=$2
		RETURNING `+streamDestColumns,
		id, userID, name, platform, rtmpURL)
	return scanStreamDest(row)
}

func dbListStreamDests(db *sql.DB, userID string) ([]streamDestRow, error) {
	rows, err := db.Query(`
		SELECT `+streamDestColumns+`
		FROM stream_destinations WHERE user_id=$1 AND platform != 'dazzle' ORDER BY created_at DESC`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var dests []streamDestRow
	for rows.Next() {
		d, err := scanStreamDest(rows)
		if err != nil {
			return nil, err
		}
		dests = append(dests, *d)
	}
	return dests, rows.Err()
}

func dbDeleteStreamDest(db *sql.DB, id, userID string) error {
	res, err := db.Exec("DELETE FROM stream_destinations WHERE id=$1 AND user_id=$2", id, userID)
	if err != nil {
		return err
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return fmt.Errorf("stream destination not found")
	}
	return nil
}

func dbGetStreamDestForUser(db *sql.DB, destID, userID string) (*streamDestRow, error) {
	row := db.QueryRow(`
		SELECT `+streamDestColumns+`
		FROM stream_destinations WHERE id=$1 AND user_id=$2`, destID, userID)
	d, err := scanStreamDest(row)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return d, nil
}

// dbUpsertStreamDest upserts a stream destination keyed on (user_id, platform, platform_username).
// Used by OAuth callback to create or update destinations with stream keys + tokens.
func dbUpsertStreamDest(db *sql.DB, userID, platform, platformUserID, platformUsername, rtmpURL, encStreamKey, encAccessToken, encRefreshToken string, tokenExpiresAt sql.NullTime, scopes string) (*streamDestRow, error) {
	row := db.QueryRow(`
		INSERT INTO stream_destinations (user_id, name, platform, platform_user_id, platform_username, rtmp_url, stream_key, access_token, refresh_token, token_expires_at, scopes)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
		ON CONFLICT (user_id, platform, platform_username) DO UPDATE SET
			name=$2, platform_user_id=$4, rtmp_url=$6, stream_key=$7, access_token=$8, refresh_token=$9, token_expires_at=$10, scopes=$11, updated_at=NOW()
		RETURNING `+streamDestColumns,
		userID, platformUsername, platform, platformUserID, platformUsername, rtmpURL, encStreamKey, encAccessToken, encRefreshToken, tokenExpiresAt, scopes)
	return scanStreamDest(row)
}

// dbUpdateStreamDestTokens updates only the OAuth tokens for a destination.
func dbUpdateStreamDestTokens(db *sql.DB, destID, encAccessToken, encRefreshToken string, tokenExpiresAt sql.NullTime) error {
	_, err := db.Exec(`
		UPDATE stream_destinations SET access_token=$2, refresh_token=$3, token_expires_at=$4, updated_at=NOW()
		WHERE id=$1`, destID, encAccessToken, encRefreshToken, tokenExpiresAt)
	return err
}

// --- Stage queries ---

type stageRow struct {
	ID            string
	UserID        string
	Name          string
	Status        string
	PodName       sql.NullString
	PodIP         sql.NullString
	DestinationID sql.NullString
	PreviewToken  sql.NullString
	Provider      string
	RunPodPodID   sql.NullString
	SidecarURL    sql.NullString
	GPUNodeName   sql.NullString
	Capabilities  []string
	CreatedAt     time.Time
	UpdatedAt     time.Time
	StreamKey       sql.NullString // RTMP ingest stream key (auto-generated)
	Slug            sql.NullString // Short slug for public watch URLs
	StreamTitle        sql.NullString
	StreamCategory     sql.NullString
	Watermarked  bool
}

const stageColumns = `id, user_id, name, status, pod_name, pod_ip, destination_id, preview_token, provider, runpod_pod_id, sidecar_url, gpu_node_name, capabilities, created_at, updated_at, stream_key, slug, stream_title, stream_category, watermarked`

func scanStage(scanner interface{ Scan(...any) error }) (*stageRow, error) {
	var s stageRow
	err := scanner.Scan(&s.ID, &s.UserID, &s.Name, &s.Status, &s.PodName, &s.PodIP,
		&s.DestinationID, &s.PreviewToken, &s.Provider, &s.RunPodPodID,
		&s.SidecarURL, &s.GPUNodeName, pq.Array(&s.Capabilities),
		&s.CreatedAt, &s.UpdatedAt, &s.StreamKey, &s.Slug, &s.StreamTitle, &s.StreamCategory,
		&s.Watermarked)
	if err != nil {
		return nil, err
	}
	return &s, nil
}

func dbCreateStage(db *sql.DB, userID, name string, capabilities []string) (string, string, error) {
	stageID := uuid.Must(uuid.NewV7()).String()
	token := "dpt_" + strings.ReplaceAll(uuid.Must(uuid.NewV7()).String(), "-", "")
	streamKey := "dsk_" + strings.ReplaceAll(uuid.Must(uuid.NewV7()).String(), "-", "")
	// Slug: last 12 hex chars of the UUIDv7 (the random portion).
	slug := strings.ReplaceAll(stageID, "-", "")[20:]
	if capabilities == nil {
		capabilities = []string{}
	}
	err := db.QueryRow(`
		INSERT INTO stages (id, user_id, name, status, preview_token, stream_key, slug, capabilities)
		VALUES ($1, $2, $3, 'inactive', $4, $5, $6, $7)
		RETURNING id`, stageID, userID, name, token, streamKey, slug, pq.Array(capabilities)).Scan(&stageID)
	return stageID, token, err
}

func dbListStages(db *sql.DB, userID string) ([]stageRow, error) {
	rows, err := db.Query(`
		SELECT `+stageColumns+`
		FROM stages WHERE user_id=$1 ORDER BY created_at`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var stages []stageRow
	for rows.Next() {
		s, err := scanStage(rows)
		if err != nil {
			return nil, err
		}
		stages = append(stages, *s)
	}
	return stages, rows.Err()
}

func dbListAllStages(db *sql.DB) ([]stageRow, error) {
	rows, err := db.Query(`
		SELECT `+stageColumns+`
		FROM stages ORDER BY created_at`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var stages []stageRow
	for rows.Next() {
		s, err := scanStage(rows)
		if err != nil {
			return nil, err
		}
		stages = append(stages, *s)
	}
	return stages, rows.Err()
}

func dbGetStage(db *sql.DB, id string) (*stageRow, error) {
	row := db.QueryRow(`
		SELECT `+stageColumns+`
		FROM stages WHERE id=$1`, id)
	s, err := scanStage(row)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	return s, err
}

func dbGetStageByStreamKey(db *sql.DB, streamKey string) (*stageRow, error) {
	row := db.QueryRow(`
		SELECT `+stageColumns+`
		FROM stages WHERE stream_key=$1`, streamKey)
	s, err := scanStage(row)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	return s, err
}

func dbDeleteStage(db *sql.DB, id, userID string) error {
	// Clean up Dazzle stream_destinations before deleting the stage
	// (stage_destinations rows are cleaned up by ON DELETE CASCADE,
	// but the stream_destinations rows for Dazzle need explicit cleanup)
	dbDeleteDazzleDestinationsForStage(db, id)

	res, err := db.Exec("DELETE FROM stages WHERE id=$1 AND user_id=$2", id, userID)
	if err != nil {
		return err
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return fmt.Errorf("stage not found")
	}
	return nil
}

func dbUpdateStageStatus(db *sql.DB, id, status, podName, podIP string) error {
	_, err := db.Exec(`
		UPDATE stages SET status=$2, pod_name=$3, pod_ip=$4, updated_at=NOW()
		WHERE id=$1`, id, status, sql.NullString{String: podName, Valid: podName != ""}, sql.NullString{String: podIP, Valid: podIP != ""})
	return err
}

func dbRenameStage(db *sql.DB, id, userID, name string) (*stageRow, error) {
	row := db.QueryRow(`
		UPDATE stages SET name=$3, updated_at=NOW()
		WHERE id=$1 AND user_id=$2
		RETURNING `+stageColumns,
		id, userID, name)
	s, err := scanStage(row)
	if err == sql.ErrNoRows {
		return nil, fmt.Errorf("stage not found")
	}
	if err != nil {
		return nil, err
	}
	return s, nil
}

var errSlugTaken = fmt.Errorf("slug already taken")

func dbUpdateSlug(db *sql.DB, stageID, userID, slug string) error {
	res, err := db.Exec("UPDATE stages SET slug=$1, updated_at=NOW() WHERE id=$2 AND user_id=$3", slug, stageID, userID)
	if err != nil {
		// Unique index violation (idx_stages_slug)
		if pqErr, ok := err.(*pq.Error); ok && pqErr.Code == "23505" {
			return errSlugTaken
		}
		return err
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return fmt.Errorf("stage not found")
	}
	return nil
}

func dbUpdateStageProvider(db *sql.DB, id, provider, runpodPodID, sidecarURL string) error {
	_, err := db.Exec(`
		UPDATE stages SET provider=$2, runpod_pod_id=$3, sidecar_url=$4, updated_at=NOW()
		WHERE id=$1`, id,
		provider,
		sql.NullString{String: runpodPodID, Valid: runpodPodID != ""},
		sql.NullString{String: sidecarURL, Valid: sidecarURL != ""})
	return err
}


func dbSetPreviewToken(db *sql.DB, stageID, token string) error {
	_, err := db.Exec(`UPDATE stages SET preview_token=$2, updated_at=NOW() WHERE id=$1`, stageID, token)
	return err
}

// --- Stage destinations (multi-destination support) ---

type stageDestJoinRow struct {
	ID               string
	StageID          string
	DestinationID    string
	Enabled          bool
	Name             string
	Platform         string
	PlatformUsername string
	RtmpURL          string
	StreamKey        string // encrypted
}

func dbListStageDestinations(db *sql.DB, stageID string) ([]stageDestJoinRow, error) {
	return dbListStageDestinationsFilter(db, stageID, true)
}

func dbListAllStageDestinations(db *sql.DB, stageID string) ([]stageDestJoinRow, error) {
	return dbListStageDestinationsFilter(db, stageID, false)
}

func dbListStageDestinationsFilter(db *sql.DB, stageID string, excludeDazzle bool) ([]stageDestJoinRow, error) {
	query := `
		SELECT sd.id, sd.stage_id, sd.destination_id, sd.enabled,
		       d.name, d.platform, d.platform_username, d.rtmp_url, d.stream_key
		FROM stage_destinations sd
		JOIN stream_destinations d ON sd.destination_id = d.id
		WHERE sd.stage_id = $1`
	if excludeDazzle {
		query += ` AND d.platform != 'dazzle'`
	}
	query += ` ORDER BY sd.created_at`
	rows, err := db.Query(query, stageID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var result []stageDestJoinRow
	for rows.Next() {
		var r stageDestJoinRow
		if err := rows.Scan(&r.ID, &r.StageID, &r.DestinationID, &r.Enabled,
			&r.Name, &r.Platform, &r.PlatformUsername, &r.RtmpURL, &r.StreamKey); err != nil {
			return nil, err
		}
		result = append(result, r)
	}
	return result, rows.Err()
}

const maxExternalDestinations = 3

var errMaxDestinations = fmt.Errorf("stage has reached the maximum of %d external destinations", maxExternalDestinations)

func dbAddStageDestination(db *sql.DB, stageID, destinationID string) (string, error) {
	var externalCount int
	if err := db.QueryRow(`
		SELECT COUNT(*) FROM stage_destinations sd
		JOIN stream_destinations d ON sd.destination_id = d.id
		WHERE sd.stage_id = $1 AND d.platform != 'dazzle'`, stageID).Scan(&externalCount); err != nil {
		return "", err
	}
	if externalCount >= maxExternalDestinations {
		return "", errMaxDestinations
	}
	id := uuid.Must(uuid.NewV7()).String()
	_, err := db.Exec(`
		INSERT INTO stage_destinations (id, stage_id, destination_id, enabled)
		VALUES ($1, $2, $3, true)
		ON CONFLICT (stage_id, destination_id) DO UPDATE SET enabled = true`,
		id, stageID, destinationID)
	return id, err
}

func dbRemoveStageDestination(db *sql.DB, stageID, destinationID string) error {
	_, err := db.Exec(`DELETE FROM stage_destinations WHERE stage_id = $1 AND destination_id = $2`,
		stageID, destinationID)
	return err
}

func dbSetStageDestinationEnabled(db *sql.DB, stageID, destinationID string, enabled bool) error {
	_, err := db.Exec(`UPDATE stage_destinations SET enabled = $3 WHERE stage_id = $1 AND destination_id = $2`,
		stageID, destinationID, enabled)
	return err
}

// dbCreateDazzleDestinationForStage creates a Dazzle destination for a specific stage
// and links it in stage_destinations. The destination is deleted when the stage is deleted
// (via ON DELETE CASCADE on stage_destinations + explicit cleanup).
func dbCreateDazzleDestinationForStage(db *sql.DB, stageID, userID string) error {
	destID := uuid.Must(uuid.NewV7()).String()
	sdID := uuid.Must(uuid.NewV7()).String()

	_, err := db.Exec(`
		INSERT INTO stream_destinations (id, user_id, name, platform, platform_username, rtmp_url, stream_key, created_at, updated_at)
		VALUES ($1, $2, 'Dazzle', 'dazzle', (SELECT slug FROM stages WHERE id = $3::uuid), '', '', NOW(), NOW())`, destID, userID, stageID)
	if err != nil {
		return err
	}

	_, err = db.Exec(`
		INSERT INTO stage_destinations (id, stage_id, destination_id, enabled)
		VALUES ($1, $2, $3, true)`, sdID, stageID, destID)
	return err
}

// dbDeleteDazzleDestinationsForStage removes the Dazzle stream_destinations rows
// associated with a stage (the stage_destinations join rows are already cleaned
// up by ON DELETE CASCADE when the stage is deleted).
func dbDeleteDazzleDestinationsForStage(db *sql.DB, stageID string) {
	db.Exec(`
		DELETE FROM stream_destinations WHERE id IN (
			SELECT sd.destination_id FROM stage_destinations sd
			JOIN stream_destinations d ON sd.destination_id = d.id
			WHERE sd.stage_id = $1 AND d.platform = 'dazzle'
		)`, stageID)
}

// --- Encryption helpers ---

func encryptString(key []byte, plaintext string) (string, error) {
	block, err := aes.NewCipher(key)
	if err != nil {
		return "", err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return "", err
	}
	nonce := make([]byte, gcm.NonceSize())
	if _, err := io.ReadFull(rand.Reader, nonce); err != nil {
		return "", err
	}
	ciphertext := gcm.Seal(nonce, nonce, []byte(plaintext), nil)
	return base64.StdEncoding.EncodeToString(ciphertext), nil
}

func decryptString(key []byte, encoded string) (string, error) {
	data, err := base64.StdEncoding.DecodeString(encoded)
	if err != nil {
		return "", err
	}
	block, err := aes.NewCipher(key)
	if err != nil {
		return "", err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return "", err
	}
	nonceSize := gcm.NonceSize()
	if len(data) < nonceSize {
		return "", fmt.Errorf("ciphertext too short")
	}
	plaintext, err := gcm.Open(nil, data[:nonceSize], data[nonceSize:], nil)
	if err != nil {
		return "", err
	}
	return string(plaintext), nil
}

func maskStreamKey(key string) string {
	if len(key) <= 4 {
		return strings.Repeat("*", len(key))
	}
	return key[:4] + strings.Repeat("*", len(key)-4)
}

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
	full = "bstr_" + hex.EncodeToString(b)
	prefix = full[:13] + "..."
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
	ID        string
	UserID    string
	Name      string
	Platform  string
	RtmpURL   string
	StreamKey string // encrypted
	CreatedAt time.Time
	UpdatedAt time.Time
}

func dbCreateStreamDest(db *sql.DB, userID, name, platform, rtmpURL, encStreamKey string) (*streamDestRow, error) {
	row := &streamDestRow{}
	err := db.QueryRow(`
		INSERT INTO stream_destinations (user_id, name, platform, rtmp_url, stream_key)
		VALUES ($1, $2, $3, $4, $5)
		RETURNING id, user_id, name, platform, rtmp_url, stream_key, created_at, updated_at`,
		userID, name, platform, rtmpURL, encStreamKey).
		Scan(&row.ID, &row.UserID, &row.Name, &row.Platform, &row.RtmpURL, &row.StreamKey, &row.CreatedAt, &row.UpdatedAt)
	if err != nil {
		return nil, err
	}
	return row, nil
}

func dbListStreamDests(db *sql.DB, userID string) ([]streamDestRow, error) {
	rows, err := db.Query(`
		SELECT id, user_id, name, platform, rtmp_url, stream_key, created_at, updated_at
		FROM stream_destinations WHERE user_id=$1 ORDER BY created_at DESC`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var dests []streamDestRow
	for rows.Next() {
		var d streamDestRow
		if err := rows.Scan(&d.ID, &d.UserID, &d.Name, &d.Platform, &d.RtmpURL, &d.StreamKey, &d.CreatedAt, &d.UpdatedAt); err != nil {
			return nil, err
		}
		dests = append(dests, d)
	}
	return dests, rows.Err()
}

func dbUpdateStreamDest(db *sql.DB, id, userID, name, platform, rtmpURL, encStreamKey string) (*streamDestRow, error) {
	row := &streamDestRow{}
	var err error
	if encStreamKey != "" {
		err = db.QueryRow(`
			UPDATE stream_destinations SET name=$3, platform=$4, rtmp_url=$5, stream_key=$6, updated_at=NOW()
			WHERE id=$1 AND user_id=$2
			RETURNING id, user_id, name, platform, rtmp_url, stream_key, created_at, updated_at`,
			id, userID, name, platform, rtmpURL, encStreamKey).
			Scan(&row.ID, &row.UserID, &row.Name, &row.Platform, &row.RtmpURL, &row.StreamKey, &row.CreatedAt, &row.UpdatedAt)
	} else {
		err = db.QueryRow(`
			UPDATE stream_destinations SET name=$3, platform=$4, rtmp_url=$5, updated_at=NOW()
			WHERE id=$1 AND user_id=$2
			RETURNING id, user_id, name, platform, rtmp_url, stream_key, created_at, updated_at`,
			id, userID, name, platform, rtmpURL).
			Scan(&row.ID, &row.UserID, &row.Name, &row.Platform, &row.RtmpURL, &row.StreamKey, &row.CreatedAt, &row.UpdatedAt)
	}
	if err != nil {
		return nil, err
	}
	return row, nil
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

// --- Stage queries ---

type stageRow struct {
	ID            string
	UserID        string
	Name          string
	Status        string
	PodName       sql.NullString
	PodIP         sql.NullString
	DestinationID sql.NullString
	CreatedAt     time.Time
	UpdatedAt     time.Time
}

func dbCreateStage(db *sql.DB, userID, name string) (string, error) {
	var id string
	err := db.QueryRow(`
		INSERT INTO stages (user_id, name, status)
		VALUES ($1, $2, 'inactive')
		RETURNING id`, userID, name).Scan(&id)
	return id, err
}

func dbListStages(db *sql.DB, userID string) ([]stageRow, error) {
	rows, err := db.Query(`
		SELECT id, user_id, name, status, pod_name, pod_ip, destination_id, created_at, updated_at
		FROM stages WHERE user_id=$1 ORDER BY created_at`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var stages []stageRow
	for rows.Next() {
		var s stageRow
		if err := rows.Scan(&s.ID, &s.UserID, &s.Name, &s.Status, &s.PodName, &s.PodIP, &s.DestinationID, &s.CreatedAt, &s.UpdatedAt); err != nil {
			return nil, err
		}
		stages = append(stages, s)
	}
	return stages, rows.Err()
}

func dbGetStage(db *sql.DB, id string) (*stageRow, error) {
	var s stageRow
	err := db.QueryRow(`
		SELECT id, user_id, name, status, pod_name, pod_ip, destination_id, created_at, updated_at
		FROM stages WHERE id=$1`, id).Scan(&s.ID, &s.UserID, &s.Name, &s.Status, &s.PodName, &s.PodIP, &s.DestinationID, &s.CreatedAt, &s.UpdatedAt)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &s, nil
}

func dbDeleteStage(db *sql.DB, id, userID string) error {
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

func dbSetStageScript(db *sql.DB, stageID, script string) error {
	_, err := db.Exec(`UPDATE stages SET last_script=$2, updated_at=NOW() WHERE id=$1`, stageID, sql.NullString{String: script, Valid: script != ""})
	return err
}

func dbGetStageScript(db *sql.DB, stageID string) (string, error) {
	var s sql.NullString
	err := db.QueryRow(`SELECT last_script FROM stages WHERE id=$1`, stageID).Scan(&s)
	if err != nil {
		return "", err
	}
	return s.String, nil
}

func dbSetStageDestination(db *sql.DB, stageID, userID, destinationID string) error {
	destVal := sql.NullString{String: destinationID, Valid: destinationID != ""}
	res, err := db.Exec(`
		UPDATE stages SET destination_id=$3, updated_at=NOW()
		WHERE id=$1 AND user_id=$2`, stageID, userID, destVal)
	if err != nil {
		return err
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return fmt.Errorf("stage not found")
	}
	return nil
}

func dbGetStreamDestForUser(db *sql.DB, destID, userID string) (*streamDestRow, error) {
	var d streamDestRow
	err := db.QueryRow(`
		SELECT id, user_id, name, platform, rtmp_url, stream_key, created_at, updated_at
		FROM stream_destinations WHERE id=$1 AND user_id=$2`, destID, userID).
		Scan(&d.ID, &d.UserID, &d.Name, &d.Platform, &d.RtmpURL, &d.StreamKey, &d.CreatedAt, &d.UpdatedAt)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &d, nil
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

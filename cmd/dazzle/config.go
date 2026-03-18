package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
)

const (
	dazzleConfigDirName  = ".config/dazzle"
	configFileName       = "config.json"
	credentialsFileName  = "credentials.json"
)

// Config holds user preferences stored in ~/.config/dazzle/config.json.
type Config struct {
	APIURL string `json:"api_url,omitempty"`
}

// Credentials holds sensitive auth data stored in ~/.config/dazzle/credentials.json.
type Credentials struct {
	APIKey  string `json:"api_key"`
	Email   string `json:"email,omitempty"`
	KeyName string `json:"key_name,omitempty"`
}

func dazzleConfigDir() (string, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return "", fmt.Errorf("get home dir: %w", err)
	}
	return filepath.Join(home, dazzleConfigDirName), nil
}

func loadConfig() (*Config, error) {
	dir, err := dazzleConfigDir()
	if err != nil {
		return nil, err
	}
	data, err := os.ReadFile(filepath.Join(dir, configFileName))
	if errors.Is(err, os.ErrNotExist) {
		return &Config{}, nil
	}
	if err != nil {
		return nil, fmt.Errorf("read config: %w", err)
	}
	var cfg Config
	if err := json.Unmarshal(data, &cfg); err != nil {
		return nil, fmt.Errorf("parse config: %w", err)
	}

	// Migrate deprecated domain
	if cfg.APIURL == "https://stream.dazzle.fm" {
		cfg.APIURL = "https://dazzle.fm"
		_ = saveConfig(&cfg)
	}

	return &cfg, nil
}

func saveConfig(cfg *Config) error {
	dir, err := dazzleConfigDir()
	if err != nil {
		return err
	}
	if err := os.MkdirAll(dir, 0700); err != nil {
		return fmt.Errorf("create config dir: %w", err)
	}
	data, err := json.MarshalIndent(cfg, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(filepath.Join(dir, configFileName), data, 0600)
}

func loadCredentials() (*Credentials, error) {
	dir, err := dazzleConfigDir()
	if err != nil {
		return nil, err
	}
	data, err := os.ReadFile(filepath.Join(dir, credentialsFileName))
	if errors.Is(err, os.ErrNotExist) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("read credentials: %w", err)
	}
	var creds Credentials
	if err := json.Unmarshal(data, &creds); err != nil {
		return nil, fmt.Errorf("parse credentials: %w", err)
	}
	return &creds, nil
}

func saveCredentials(creds *Credentials) error {
	dir, err := dazzleConfigDir()
	if err != nil {
		return err
	}
	if err := os.MkdirAll(dir, 0700); err != nil {
		return fmt.Errorf("create config dir: %w", err)
	}
	data, err := json.MarshalIndent(creds, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(filepath.Join(dir, credentialsFileName), data, 0600)
}

func deleteCredentials() error {
	dir, err := dazzleConfigDir()
	if err != nil {
		return err
	}
	err = os.Remove(filepath.Join(dir, credentialsFileName))
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	return err
}

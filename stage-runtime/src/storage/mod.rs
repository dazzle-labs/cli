use anyhow::Result;
use log::{info, warn};
use serde_json::Value;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

/// Persistent key-value storage backed by a JSON file.
/// Replaces Chrome's localStorage/IndexedDB for stage-runtime stages.
pub struct Storage {
    path: PathBuf,
    data: HashMap<String, Value>,
    dirty: bool,
    last_flush: Instant,
}

const DEBOUNCE_DURATION: Duration = Duration::from_secs(1);

impl Storage {
    /// Create a new storage instance. Loads existing data from disk if the file exists.
    pub fn new(path: &Path) -> Result<Self> {
        let data = if path.exists() {
            let contents = std::fs::read_to_string(path)?;
            match serde_json::from_str(&contents) {
                Ok(map) => {
                    info!("Storage: loaded {} keys from {}", map_len(&map), path.display());
                    map
                }
                Err(e) => {
                    warn!("Storage: failed to parse {}: {}, starting fresh", path.display(), e);
                    HashMap::new()
                }
            }
        } else {
            HashMap::new()
        };

        Ok(Storage {
            path: path.to_path_buf(),
            data,
            dirty: false,
            last_flush: Instant::now(),
        })
    }

    #[allow(dead_code)]
    pub fn get(&self, key: &str) -> Option<&Value> {
        self.data.get(key)
    }

    /// Maximum number of keys in storage.
    const MAX_KEYS: usize = 10_000;
    /// Maximum serialized size of a single value (1 MB).
    const MAX_VALUE_SIZE: usize = 1_024 * 1_024;
    /// Maximum total serialized size of all storage (50 MB).
    const MAX_TOTAL_SIZE: usize = 50 * 1_024 * 1_024;

    #[allow(dead_code)]
    pub fn set(&mut self, key: String, value: Value) {
        if self.data.len() >= Self::MAX_KEYS && !self.data.contains_key(&key) {
            warn!("Storage: key limit reached ({}), rejecting key={}", Self::MAX_KEYS, key);
            return;
        }
        // Enforce per-value size limit
        let serialized_len = serde_json::to_string(&value).map(|s| s.len()).unwrap_or(0);
        if serialized_len > Self::MAX_VALUE_SIZE {
            warn!("Storage: value too large ({} bytes, max {}), rejecting key={}", serialized_len, Self::MAX_VALUE_SIZE, key);
            return;
        }
        // Enforce aggregate size limit
        let current_total: usize = self.data.values()
            .map(|v| serde_json::to_string(v).map(|s| s.len()).unwrap_or(0))
            .sum();
        if current_total + serialized_len > Self::MAX_TOTAL_SIZE {
            warn!("Storage: total size limit reached ({} + {} > {}), rejecting key={}", current_total, serialized_len, Self::MAX_TOTAL_SIZE, key);
            return;
        }
        self.data.insert(key, value);
        self.dirty = true;
    }

    /// Remove a key from storage.
    pub fn remove(&mut self, key: &str) {
        if self.data.remove(key).is_some() {
            self.dirty = true;
        }
    }

    /// Remove all keys with a given prefix.
    pub fn remove_by_prefix(&mut self, prefix: &str) {
        let keys: Vec<String> = self.data.keys()
            .filter(|k| k.starts_with(prefix))
            .cloned()
            .collect();
        if !keys.is_empty() {
            for k in keys {
                self.data.remove(&k);
            }
            self.dirty = true;
        }
    }

    /// Check if any keys with a given prefix exist.
    pub fn has_prefix(&self, prefix: &str) -> bool {
        self.data.keys().any(|k| k.starts_with(prefix))
    }

    pub fn entries(&self) -> impl Iterator<Item = (&String, &Value)> {
        self.data.iter()
    }

    /// Flush to disk if dirty and debounce period has elapsed.
    #[allow(dead_code)]
    pub fn maybe_flush(&mut self) -> Result<()> {
        if !self.dirty {
            return Ok(());
        }
        if self.last_flush.elapsed() < DEBOUNCE_DURATION {
            return Ok(());
        }
        self.flush()
    }

    /// Force flush to disk.
    pub fn flush(&mut self) -> Result<()> {
        if !self.dirty {
            return Ok(());
        }

        // Ensure parent directory exists
        if let Some(parent) = self.path.parent() {
            std::fs::create_dir_all(parent)?;
        }

        let json = serde_json::to_string_pretty(&self.data)?;
        // Atomic write: write to temp file then rename to prevent corruption on crash
        let tmp_path = self.path.with_extension("json.tmp");
        std::fs::write(&tmp_path, &json)?;
        std::fs::rename(&tmp_path, &self.path)?;
        self.dirty = false;
        self.last_flush = Instant::now();
        Ok(())
    }
}

impl Drop for Storage {
    fn drop(&mut self) {
        if self.dirty {
            if let Err(e) = self.flush() {
                warn!("Storage: failed to flush on drop: {}", e);
            }
        }
    }
}

fn map_len(map: &HashMap<String, Value>) -> usize {
    map.len()
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn new_storage_empty_file() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("storage.json");
        let store = Storage::new(&path).unwrap();
        assert!(store.get("anything").is_none());
        assert_eq!(store.entries().count(), 0);
    }

    #[test]
    fn set_and_get() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("storage.json");
        let mut store = Storage::new(&path).unwrap();
        store.set("key1".to_string(), serde_json::json!("value1"));
        assert_eq!(store.get("key1"), Some(&serde_json::json!("value1")));
    }

    #[test]
    fn flush_and_reload() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("storage.json");

        {
            let mut store = Storage::new(&path).unwrap();
            store.set("name".to_string(), serde_json::json!("dazzle"));
            store.set("count".to_string(), serde_json::json!(42));
            store.flush().unwrap();
        }

        // Reload from disk
        let store2 = Storage::new(&path).unwrap();
        assert_eq!(store2.get("name"), Some(&serde_json::json!("dazzle")));
        assert_eq!(store2.get("count"), Some(&serde_json::json!(42)));
    }

    #[test]
    fn flush_on_drop() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("storage.json");

        {
            let mut store = Storage::new(&path).unwrap();
            store.set("dropped".to_string(), serde_json::json!(true));
            // Drop without explicit flush
        }

        let store2 = Storage::new(&path).unwrap();
        assert_eq!(store2.get("dropped"), Some(&serde_json::json!(true)));
    }

    #[test]
    fn maybe_flush_respects_debounce() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("storage.json");
        let mut store = Storage::new(&path).unwrap();
        store.set("key".to_string(), serde_json::json!("val"));

        // First maybe_flush should be blocked by debounce (just created)
        store.maybe_flush().unwrap();
        // File might not exist yet due to debounce
        // But force flush should always write
        store.flush().unwrap();
        assert!(path.exists());
    }

    #[test]
    fn load_corrupt_file() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("storage.json");
        std::fs::write(&path, "not valid json!!!").unwrap();

        let store = Storage::new(&path).unwrap();
        assert_eq!(store.entries().count(), 0, "corrupt file should start fresh");
    }

    #[test]
    fn overwrite_key() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("storage.json");
        let mut store = Storage::new(&path).unwrap();
        store.set("k".to_string(), serde_json::json!(1));
        store.set("k".to_string(), serde_json::json!(2));
        assert_eq!(store.get("k"), Some(&serde_json::json!(2)));
    }

    #[test]
    fn entries_iteration() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("storage.json");
        let mut store = Storage::new(&path).unwrap();
        store.set("a".to_string(), serde_json::json!(1));
        store.set("b".to_string(), serde_json::json!(2));
        store.set("c".to_string(), serde_json::json!(3));
        assert_eq!(store.entries().count(), 3);
    }
}

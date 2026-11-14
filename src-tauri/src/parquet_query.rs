//! Parquet Lakehouse OLAP Module
//! Executes stateless, lock-free `:memory:` DuckDB queries directly over Apache Parquet
//! partitions in `data/processed/` and `data/universe/` (PRD Section 2.2).

use duckdb::{types::ValueRef, Config, Connection};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::time::Instant;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QueryResult {
    pub columns: Vec<String>,
    pub rows: Vec<HashMap<String, serde_json::Value>>,
    pub row_count: usize,
    pub execution_time_ms: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LakehouseStats {
    pub base_lakehouse_path: String,
    pub exists: bool,
    pub processed_partitions_count: usize,
    pub universe_snapshots_count: usize,
    pub total_size_bytes: u64,
}

fn locate_lakehouse_root() -> PathBuf {
    let mut candidates = Vec::new();
    if let Ok(env_dir) = std::env::var("AMSTAL_ENGINE_DIR") {
        candidates.push(PathBuf::from(env_dir).join("lakehouse"));
    }
    if let Ok(exe_path) = std::env::current_exe() {
        let mut curr = exe_path.as_path();
        while let Some(parent) = curr.parent() {
            candidates.push(parent.join("amstal-engine").join("lakehouse"));
            candidates.push(parent.join("amstal").join("amstal-engine").join("lakehouse"));
            curr = parent;
        }
    }
    candidates.extend([
        PathBuf::from("../amstal-engine/lakehouse"),
        PathBuf::from("../../amstal-engine/lakehouse"),
        PathBuf::from("amstal-engine/lakehouse"),
        PathBuf::from("lakehouse"),
        PathBuf::from("../amstal-engine/data"),
        PathBuf::from("../../amstal-engine/data"),
        PathBuf::from("amstal-engine/data"),
        PathBuf::from("data"),
    ]);

    for c in &candidates {
        if c.exists() {
            return c.canonicalize().unwrap_or_else(|_| c.clone());
        }
    }

    PathBuf::from("../amstal-engine/lakehouse")
}

fn count_files_and_size(dir: &Path) -> (usize, u64) {
    let mut count = 0;
    let mut size = 0;

    if let Ok(entries) = std::fs::read_dir(dir) {
        for entry in entries.flatten() {
            let p = entry.path();
            if p.is_file() && p.extension().map_or(false, |ext| ext == "parquet") {
                count += 1;
                if let Ok(meta) = p.metadata() {
                    size += meta.len();
                }
            } else if p.is_dir() {
                let (sub_count, sub_size) = count_files_and_size(&p);
                count += sub_count;
                size += sub_size;
            }
        }
    }

    (count, size)
}

struct SqlQuotedToken {
    value: String,
    is_double_quoted: bool,
    preceded_by_relation_kw: bool,
}

fn masked_ends_with_relation_kw(masked_upper: &str) -> bool {
    let trimmed = masked_upper.trim_end();
    for kw in ["FROM", "JOIN"] {
        if let Some(prefix) = trimmed.strip_suffix(kw) {
            if prefix.is_empty()
                || prefix
                    .chars()
                    .last()
                    .map_or(true, |c| !c.is_ascii_alphanumeric() && c != '_')
            {
                return true;
            }
        }
    }
    false
}

/// Extracts single- and double-quoted SQL string/identifier tokens outside comments and returns
/// `(masked_upper_sql, quoted_tokens)`.
fn inspect_sql_tokens(sql: &str) -> Result<(String, Vec<SqlQuotedToken>), String> {
    let mut masked = String::with_capacity(sql.len());
    let mut tokens = Vec::new();
    let chars: Vec<char> = sql.chars().collect();
    let mut i = 0;

    while i < chars.len() {
        let ch = chars[i];
        if ch == '-' && i + 1 < chars.len() && chars[i + 1] == '-' {
            return Err("Security restriction: SQL line comments are not permitted.".to_string());
        }
        if ch == '/' && i + 1 < chars.len() && chars[i + 1] == '*' {
            return Err("Security restriction: SQL block comments are not permitted.".to_string());
        }
        if ch == '\'' || ch == '"' {
            let quote = ch;
            let preceded_by_relation_kw = masked_ends_with_relation_kw(&masked);
            let mut lit = String::new();
            i += 1;
            let mut closed = false;
            while i < chars.len() {
                if chars[i] == quote {
                    if i + 1 < chars.len() && chars[i + 1] == quote {
                        lit.push(quote);
                        i += 2;
                        continue;
                    }
                    closed = true;
                    i += 1;
                    break;
                }
                lit.push(chars[i]);
                i += 1;
            }
            if !closed {
                return Err("SQL syntax error: Unterminated quoted token.".to_string());
            }
            tokens.push(SqlQuotedToken {
                value: lit,
                is_double_quoted: quote == '"',
                preceded_by_relation_kw,
            });
            masked.push_str(if quote == '"' { " \"\" " } else { " '' " });
            continue;
        }
        if ch == ';' {
            return Err("Security restriction: Multiple SQL statements (semicolons) are not permitted.".to_string());
        }
        masked.push(ch.to_ascii_uppercase());
        i += 1;
    }

    Ok((masked, tokens))
}

fn has_disallowed_file_extension(lower: &str) -> bool {
    const DISALLOWED_EXTS: &[&str] = &[
        ".csv", ".tsv", ".txt", ".json", ".jsonl", ".ndjson", ".xlsx", ".xls",
        ".db", ".duckdb", ".sqlite", ".sqlite3", ".arrow", ".ipc", ".feather",
        ".gz", ".bz2", ".xz", ".zst", ".orc", ".log", ".ini", ".toml", ".yaml", ".yml",
    ];
    DISALLOWED_EXTS.iter().any(|ext| lower.ends_with(ext))
}

fn looks_like_file_path_or_url(raw: &str) -> bool {
    let lower = raw.to_ascii_lowercase();
    lower.starts_with("http://")
        || lower.starts_with("https://")
        || lower.starts_with("s3://")
        || lower.starts_with("gs://")
        || lower.starts_with("hf://")
        || lower.starts_with("file://")
        || lower.starts_with("r2://")
        || lower.starts_with("az://")
        || raw.contains('/')
        || raw.contains('\\')
        || raw.contains("..")
        || lower.ends_with(".parquet")
        || lower.ends_with(".parq")
        || has_disallowed_file_extension(&lower)
}

fn validate_parquet_path_in_lakehouse(raw_path: &str) -> Result<(), String> {
    let lower = raw_path.to_ascii_lowercase();
    if lower.starts_with("http://")
        || lower.starts_with("https://")
        || lower.starts_with("s3://")
        || lower.starts_with("gs://")
        || lower.starts_with("hf://")
        || lower.starts_with("file://")
        || lower.starts_with("r2://")
        || lower.starts_with("az://")
        || raw_path.contains("..")
    {
        return Err(format!(
            "Security restriction: Disallowed external or traversal path '{}'",
            raw_path
        ));
    }
    if has_disallowed_file_extension(&lower) {
        return Err(format!(
            "Security restriction: Only Apache Parquet files inside lakehouse may be read ('{}').",
            raw_path
        ));
    }

    let root = locate_lakehouse_root();
    let canon_root = root
        .canonicalize()
        .map_err(|_| "Lakehouse root directory not found for Parquet validation.".to_string())?;
    let req_path = Path::new(raw_path);
    let candidate = if req_path.is_absolute() {
        req_path.to_path_buf()
    } else {
        canon_root.join(req_path)
    };
    let check_target = if candidate.exists() {
        candidate.canonicalize().map_err(|e| format!("Invalid Parquet path: {}", e))?
    } else if let Some(parent) = candidate.parent() {
        let canon_parent = parent
            .canonicalize()
            .map_err(|_| format!("Security restriction: Parquet directory outside lakehouse: '{}'", raw_path))?;
        canon_parent.join(candidate.file_name().unwrap_or_default())
    } else {
        return Err(format!("Invalid Parquet path '{}'", raw_path));
    };

    if !check_target.starts_with(&canon_root) {
        return Err(format!(
            "Security restriction: Path '{}' escapes authorized lakehouse root.",
            raw_path
        ));
    }
    Ok(())
}

/// Validates that an SQL query is strictly analytical, single-statement, and scoped to lakehouse data.
fn validate_read_only_sql(sql: &str) -> Result<(), String> {
    let trimmed = sql.trim();
    if trimmed.is_empty() {
        return Err("Empty SQL query.".to_string());
    }

    let (masked_upper, quoted_tokens) = inspect_sql_tokens(trimmed)?;
    let forbidden_words = [
        "DROP", "DELETE", "UPDATE", "INSERT", "ATTACH", "DETACH",
        "ALTER", "CREATE", "TRUNCATE", "EXECUTE", "RENAME", "REPLACE",
        "COPY", "EXPORT", "IMPORT", "PRAGMA", "INSTALL", "LOAD", "CALL",
        "SET", "VACUUM", "CHECKPOINT", "SUMMARIZE",
    ];

    let words: Vec<&str> = masked_upper
        .split(|c: char| !c.is_ascii_alphanumeric() && c != '_')
        .filter(|w| !w.is_empty())
        .collect();

    for word in &words {
        if forbidden_words.contains(word) {
            return Err(format!(
                "Security restriction: Statement contains restricted keyword '{}'",
                word
            ));
        }
        let is_disallowed_reader = (word.starts_with("READ_") && *word != "READ_PARQUET")
            || (word.ends_with("_SCAN") && *word != "PARQUET_SCAN")
            || matches!(
                *word,
                "GLOB"
                    | "GETENV"
                    | "SNIFF_CSV"
                    | "CURRENT_SETTING"
                    | "DUCKDB_SECRETS"
                    | "WHICH_SECRET"
                    | "COPY_TO"
                    | "EXCEL_TEXT"
            );
        if is_disallowed_reader {
            return Err(format!(
                "Security restriction: Function '{}' is restricted to prevent arbitrary filesystem reads.",
                word
            ));
        }
    }

    let first_word = words.first().copied().unwrap_or("");
    if !matches!(first_word, "SELECT" | "DESCRIBE" | "EXPLAIN" | "SHOW" | "WITH") {
        return Err("Security restriction: Only SELECT, WITH, DESCRIBE, EXPLAIN, and SHOW queries are permitted.".to_string());
    }

    // Any single- or double-quoted relation / reader / file path literal must stay strictly inside lakehouse
    let uses_parquet_reader = words.contains(&"READ_PARQUET") || words.contains(&"PARQUET_SCAN");
    for tok in &quoted_tokens {
        let must_validate = uses_parquet_reader
            || tok.preceded_by_relation_kw
            || looks_like_file_path_or_url(&tok.value)
            || (!tok.is_double_quoted && tok.value.trim().ends_with("parquet"));
        if must_validate {
            validate_parquet_path_in_lakehouse(&tok.value)?;
        }
    }

    Ok(())
}

fn convert_duckdb_value_to_json(val: ValueRef<'_>) -> serde_json::Value {
    match val {
        ValueRef::Null => serde_json::Value::Null,
        ValueRef::Boolean(b) => serde_json::Value::Bool(b),
        ValueRef::TinyInt(i) => serde_json::Value::Number(serde_json::Number::from(i)),
        ValueRef::SmallInt(i) => serde_json::Value::Number(serde_json::Number::from(i)),
        ValueRef::Int(i) => serde_json::Value::Number(serde_json::Number::from(i)),
        ValueRef::BigInt(i) => serde_json::Value::Number(serde_json::Number::from(i)),
        ValueRef::HugeInt(i) => serde_json::Value::String(i.to_string()),
        ValueRef::UTinyInt(u) => serde_json::Value::Number(serde_json::Number::from(u)),
        ValueRef::USmallInt(u) => serde_json::Value::Number(serde_json::Number::from(u)),
        ValueRef::UInt(u) => serde_json::Value::Number(serde_json::Number::from(u)),
        ValueRef::UBigInt(u) => serde_json::Value::Number(serde_json::Number::from(u)),
        ValueRef::Float(f) => serde_json::Number::from_f64(f as f64)
            .map(serde_json::Value::Number)
            .unwrap_or(serde_json::Value::Null),
        ValueRef::Double(d) => serde_json::Number::from_f64(d)
            .map(serde_json::Value::Number)
            .unwrap_or(serde_json::Value::Null),
        ValueRef::Text(s) => serde_json::Value::String(String::from_utf8_lossy(s).to_string()),
        ValueRef::Blob(b) => serde_json::Value::String(format!("<blob {} bytes>", b.len())),
        ValueRef::Timestamp(unit, val) => serde_json::Value::String(format!("{:?} {}", unit, val)),
        _ => serde_json::Value::String(format!("{:?}", val)),
    }
}

// ---------------------------------------------------------------------------
// Tauri Command Handlers
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn query_parquet(sql_query: String) -> Result<QueryResult, String> {
    validate_read_only_sql(&sql_query)?;

    let start = Instant::now();
    let config = Config::default()
        .enable_autoload_extension(false)
        .map_err(|e| format!("Failed to configure DuckDB sandbox: {}", e))?;
    let conn = Connection::open_in_memory_with_flags(config)
        .map_err(|e| format!("Failed to open in-memory DuckDB connection: {}", e))?;

    // Defense-in-depth at engine layer: disable remote extension installs and confine filesystem
    // access strictly to the authorized lakehouse directory (locking configuration against bypass).
    let lakehouse = locate_lakehouse_root();
    if let Ok(canon_root) = lakehouse.canonicalize() {
        let escaped = canon_root.to_string_lossy().replace('\'', "''");
        let setup_sql = format!(
            "SET autoinstall_known_extensions = false; SET allowed_directories = ['{}']; SET enable_external_access = false; SET lock_configuration = true;",
            escaped
        );
        conn.execute_batch(&setup_sql)
            .map_err(|e| format!("Failed to lock DuckDB lakehouse confinement: {}", e))?;
    } else {
        conn.execute_batch("SET autoinstall_known_extensions = false; SET enable_external_access = false; SET lock_configuration = true;")
            .map_err(|e| format!("Failed to lock DuckDB external access: {}", e))?;
    }

    let mut stmt = conn
        .prepare(&sql_query)
        .map_err(|e| format!("DuckDB SQL Prepare Error: {}", e))?;

    let mut rows = stmt
        .query([])
        .map_err(|e| format!("DuckDB Query Execution Error: {}", e))?;

    let columns: Vec<String> = rows
        .as_ref()
        .map(|s| s.column_names())
        .unwrap_or_default();
    let col_count = columns.len();

    let mut rows_out: Vec<HashMap<String, serde_json::Value>> = Vec::new();

    while let Some(row) = rows.next().map_err(|e| format!("DuckDB Row Fetch Error: {}", e))? {
        let mut row_map: HashMap<String, serde_json::Value> = HashMap::with_capacity(col_count);
        for idx in 0..col_count {
            let col_name = &columns[idx];
            let val = row.get_ref(idx).map_err(|e| format!("Cell Fetch Error: {}", e))?;
            row_map.insert(col_name.clone(), convert_duckdb_value_to_json(val));
        }
        rows_out.push(row_map);
    }

    let elapsed = start.elapsed().as_secs_f64() * 1000.0;
    let row_count = rows_out.len();

    Ok(QueryResult {
        columns,
        rows: rows_out,
        row_count,
        execution_time_ms: round_to(elapsed, 2),
    })
}

#[tauri::command]
pub fn get_lakehouse_stats() -> Result<LakehouseStats, String> {
    let lakehouse = locate_lakehouse_root();
    let exists = lakehouse.exists();

    let processed_dir = lakehouse.join("processed");
    let universe_dir = lakehouse.join("universe");

    let (proc_count, proc_size) = if processed_dir.exists() {
        count_files_and_size(&processed_dir)
    } else {
        (0, 0)
    };

    let (univ_count, univ_size) = if universe_dir.exists() {
        count_files_and_size(&universe_dir)
    } else {
        (0, 0)
    };

    Ok(LakehouseStats {
        base_lakehouse_path: lakehouse.to_string_lossy().to_string(),
        exists,
        processed_partitions_count: proc_count,
        universe_snapshots_count: univ_count,
        total_size_bytes: proc_size + univ_size,
    })
}

fn round_to(val: f64, places: u32) -> f64 {
    let mult = 10_f64.powi(places as i32);
    (val * mult).round() / mult
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_validate_read_only_sql() {
        assert!(validate_read_only_sql("SELECT * FROM prices").is_ok());
        assert!(validate_read_only_sql("DESCRIBE prices").is_ok());
        assert!(validate_read_only_sql("EXPLAIN SELECT 1").is_ok());

        assert!(validate_read_only_sql("DROP TABLE prices").is_err());
        assert!(validate_read_only_sql("DELETE FROM prices").is_err());
        assert!(validate_read_only_sql("INSERT INTO prices VALUES (1)").is_err());
        assert!(validate_read_only_sql("UPDATE prices SET x = 1").is_err());
        assert!(validate_read_only_sql("ATTACH 'foo.db'").is_err());
        assert!(validate_read_only_sql("SELECT 1; COPY (SELECT 1) TO '/tmp/out.csv'").is_err());
        assert!(validate_read_only_sql("COPY (SELECT 1) TO '/tmp/out.csv'").is_err());
        assert!(validate_read_only_sql("PRAGMA database_list").is_err());
        assert!(validate_read_only_sql("SELECT * FROM read_parquet('/etc/passwd')").is_err());
        assert!(validate_read_only_sql("SELECT * FROM read_parquet('../secrets/foo.parquet')").is_err());
        assert!(validate_read_only_sql("SELECT * FROM read_parquet('https://evil.example/a.parquet')").is_err());
        assert!(validate_read_only_sql("SELECT * FROM \"/tmp/secret.csv\"").is_err());
        assert!(validate_read_only_sql("SELECT * FROM \"secret.csv\"").is_err());
        assert!(validate_read_only_sql("SELECT * FROM 'secret.csv'").is_err());
        assert!(validate_read_only_sql("SELECT * FROM read_csv_auto('secret.csv')").is_err());
        assert!(validate_read_only_sql("SELECT * FROM read_json_auto('/etc/passwd')").is_err());
        assert!(validate_read_only_sql("SELECT * FROM read_ndjson('a.ndjson')").is_err());
        assert!(validate_read_only_sql("SELECT * FROM sqlite_scan('/tmp/a.db', 't')").is_err());
        assert!(validate_read_only_sql("SELECT * FROM glob('/etc/*')").is_err());
        assert!(validate_read_only_sql("SELECT getenv('HOME')").is_err());
        assert!(validate_read_only_sql("SELECT current_setting('allowed_directories')").is_err());
        assert!(validate_read_only_sql("SELECT \"close\" FROM prices").is_ok());
    }

    #[test]
    fn test_in_memory_duckdb_query() {
        let res = query_parquet("SELECT 42 AS num, 'NVDA' AS ticker".to_string()).unwrap();
        assert_eq!(res.row_count, 1);
        assert_eq!(res.columns, vec!["num", "ticker"]);
        assert_eq!(res.rows[0]["num"], 42);
        assert_eq!(res.rows[0]["ticker"], "NVDA");
        assert!(res.execution_time_ms >= 0.0);
    }

    #[test]
    fn test_lakehouse_stats() {
        let stats = get_lakehouse_stats().unwrap();
        assert!(stats.base_lakehouse_path.contains("lakehouse") || stats.base_lakehouse_path.contains("data"));
        assert!(stats.exists);
    }

    #[test]
    fn test_lakehouse_parquet_query_respects_directory_confinement() {
        let root = locate_lakehouse_root().canonicalize().unwrap();
        let sample = root.join("processed").join("daily").join("NVDA.parquet");
        if sample.exists() {
            let escaped = sample.to_string_lossy().replace('\'', "''");
            let sql = format!("SELECT count(*) AS cnt FROM read_parquet('{}')", escaped);
            assert!(validate_read_only_sql(&sql).is_ok());
            match query_parquet(sql) {
                Ok(res) => {
                    assert_eq!(res.row_count, 1);
                    assert!(res.rows[0]["cnt"].as_i64().unwrap_or(0) > 100);
                }
                Err(e) => {
                    // Bundled duckdb without `parquet` extension feature cannot autoload extension without ~/.duckdb
                    assert!(e.contains("parquet extension"), "Unexpected query_parquet failure: {}", e);
                }
            }
        }
    }
}


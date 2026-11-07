//! Parquet Lakehouse OLAP Module
//! Executes stateless, lock-free `:memory:` DuckDB queries directly over Apache Parquet
//! partitions in `data/processed/` and `data/universe/` (PRD Section 2.2).

use duckdb::{types::ValueRef, Connection};
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
    let candidates = [
        PathBuf::from("../amstal-engine/data"),
        PathBuf::from("../../amstal-engine/data"),
        PathBuf::from("amstal-engine/data"),
        PathBuf::from("data"),
    ];

    for c in &candidates {
        if c.exists() {
            return c.clone();
        }
    }

    PathBuf::from("../amstal-engine/data")
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

/// Validates that an SQL query is strictly analytical and read-only.
fn validate_read_only_sql(sql: &str) -> Result<(), String> {
    let s = sql.trim().to_uppercase();
    let forbidden_keywords = [
        "DROP ", "DELETE ", "UPDATE ", "INSERT ", "ATTACH ", "DETACH ",
        "ALTER ", "CREATE ", "TRUNCATE ", "EXECUTE ", "RENAME ", "REPLACE ",
    ];

    for kw in &forbidden_keywords {
        if s.starts_with(kw) || s.contains(&format!(" {}", kw)) {
            return Err(format!("Security restriction: Statement contains modifying keyword '{}'", kw.trim()));
        }
    }

    if !s.starts_with("SELECT ") && !s.starts_with("DESCRIBE ") && !s.starts_with("EXPLAIN ") && !s.starts_with("SHOW ") {
        return Err("Security restriction: Only SELECT, DESCRIBE, EXPLAIN, and SHOW queries are permitted.".to_string());
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
    let conn = Connection::open_in_memory()
        .map_err(|e| format!("Failed to open in-memory DuckDB connection: {}", e))?;

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
        assert!(stats.base_lakehouse_path.contains("data"));
    }
}


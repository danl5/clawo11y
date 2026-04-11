#!/usr/bin/env python3
"""
SQLite schema migrator — handles safe column additions.
Run this before starting the server after schema changes.
"""
import sqlite3
import sys
from pathlib import Path

DB_PATH = Path(__file__).parent.parent / "core" / "o11y_server.db"

MIGRATIONS = [
    {
        "table": "nodes",
        "columns": {
            "hostname": "TEXT",
            "openclaw_version": "TEXT",
        }
    },
    {
        "table": "system_metrics",
        "columns": {
            "cpu_count": "INTEGER DEFAULT 0",
            "load_avg_1m": "REAL DEFAULT 0.0",
            "load_avg_5m": "REAL DEFAULT 0.0",
            "load_avg_15m": "REAL DEFAULT 0.0",
            "ram_percent": "REAL DEFAULT 0.0",
            "swap_used_mb": "REAL DEFAULT 0.0",
            "swap_total_mb": "REAL DEFAULT 0.0",
            "disk_total_gb": "REAL DEFAULT 0.0",
            "uptime_seconds": "INTEGER DEFAULT 0",
            "boot_time_seconds": "INTEGER DEFAULT 0",
            "net_tx_bytes": "INTEGER DEFAULT 0",
            "net_rx_bytes": "INTEGER DEFAULT 0",
        }
    },
    {
        "table": "agent_events",
        "columns": {
            "model": "TEXT",
            "provider": "TEXT",
            "input_tokens": "INTEGER DEFAULT 0",
            "output_tokens": "INTEGER DEFAULT 0",
            "cache_read_tokens": "INTEGER DEFAULT 0",
            "cache_write_tokens": "INTEGER DEFAULT 0",
            "cost_usd": "REAL DEFAULT 0.0",
            "duration_ms": "INTEGER DEFAULT 0",
            "tool_name": "TEXT",
            "channel": "TEXT",
        }
    },
]

def get_existing_columns(conn, table):
    cur = conn.execute(f"PRAGMA table_info({table})")
    return {row[1] for row in cur.fetchall()}

def migrate():
    if not DB_PATH.exists():
        print(f"DB not found at {DB_PATH}, skipping migration.")
        return

    conn = sqlite3.connect(DB_PATH)
    for mig in MIGRATIONS:
        table = mig["table"]
        existing = get_existing_columns(conn, table)
        for col, dtype in mig["columns"].items():
            if col not in existing:
                print(f"Adding column '{col}' to '{table}'...")
                conn.execute(f"ALTER TABLE {table} ADD COLUMN {col} {dtype}")
    conn.commit()
    conn.close()
    print("Migration complete.")

if __name__ == "__main__":
    migrate()

"""One-time migration helpers for legacy BossHunter databases.

The pre-2.3.1 development database identifies platform origin with the
``jobs.source`` column.  BossHunter 2.3.1 uses a platform-scoped source
identity instead.  The generic 2.3.1 schema migration intentionally treats
unknown legacy rows as BOSS rows, so a database containing 51job rows needs
this explicit, audited conversion.
"""

from __future__ import annotations

from contextlib import closing
from dataclasses import asdict, dataclass
from pathlib import Path
import sqlite3
from typing import Any

from bosshunter.db import get_db


class LegacyMigrationError(RuntimeError):
    """Raised when a source database is not safe to migrate automatically."""


@dataclass(frozen=True)
class MigrationReport:
    source_path: str
    target_path: str
    total_jobs: int
    legacy_sources: dict[str, int]
    target_platforms: dict[str, int]
    status_counts: dict[str, int]
    history_rows: int
    orphan_history_rows: int
    job51_rows_missing_source_id: int
    duplicate_job51_source_ids: int

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


def _connect_read_only(path: Path) -> sqlite3.Connection:
    return sqlite3.connect(f"{path.resolve().as_uri()}?mode=ro", uri=True)


def _table_columns(conn: sqlite3.Connection, table: str) -> set[str]:
    return {str(row[1]) for row in conn.execute(f"PRAGMA table_info({table})")}


def _legacy_source_counts(conn: sqlite3.Connection) -> dict[str, int]:
    columns = _table_columns(conn, "jobs")
    if "source" not in columns:
        raise LegacyMigrationError("源数据库没有 jobs.source，不能作为旧版 51job 数据库迁移")

    counts = {
        str(source or ""): int(count)
        for source, count in conn.execute(
            "SELECT COALESCE(source, ''), COUNT(*) FROM jobs GROUP BY COALESCE(source, '')"
        )
    }
    unsupported = sorted(source for source in counts if source not in {"boss", "51job"})
    if unsupported:
        raise LegacyMigrationError(f"发现无法自动迁移的 jobs.source 值：{', '.join(unsupported)}")
    return counts


def inspect_legacy_database(path: str | Path) -> dict[str, Any]:
    """Return an immutable preflight summary without creating or changing files."""
    database_path = Path(path)
    if not database_path.is_file():
        raise FileNotFoundError(database_path)
    with closing(_connect_read_only(database_path)) as conn:
        sources = _legacy_source_counts(conn)
        status_counts = {
            str(status or ""): int(count)
            for status, count in conn.execute(
                "SELECT COALESCE(status, ''), COUNT(*) FROM jobs GROUP BY COALESCE(status, '')"
            )
        }
        return {
            "source_path": str(database_path.resolve()),
            "total_jobs": int(conn.execute("SELECT COUNT(*) FROM jobs").fetchone()[0]),
            "legacy_sources": sources,
            "status_counts": status_counts,
            "history_rows": int(conn.execute("SELECT COUNT(*) FROM history").fetchone()[0]),
        }


def migrate_legacy_database(source: str | Path, target: str | Path) -> MigrationReport:
    """Copy a legacy database and migrate its 51job identity into 2.3.1 form.

    ``source`` is opened read-only and copied with SQLite's backup API, which
    includes committed WAL content consistently.  ``target`` must not already
    exist; callers must opt into any overwrite outside this helper.
    """
    source_path = Path(source)
    target_path = Path(target)
    if not source_path.is_file():
        raise FileNotFoundError(source_path)
    if source_path.resolve() == target_path.resolve():
        raise LegacyMigrationError("源数据库和目标数据库不能是同一个文件")
    if target_path.exists():
        raise FileExistsError(f"目标数据库已存在，拒绝覆盖：{target_path}")

    preflight = inspect_legacy_database(source_path)
    target_path.parent.mkdir(parents=True, exist_ok=True)
    with closing(_connect_read_only(source_path)) as source_conn:
        with closing(sqlite3.connect(target_path)) as target_conn:
            source_conn.backup(target_conn)

    conn = get_db(target_path)
    try:
        conn.execute(
            """
            UPDATE jobs
            SET source_platform = '51job', source_job_id = id
            WHERE source = '51job'
              AND (source_platform <> '51job' OR source_job_id IS NULL OR TRIM(source_job_id) = '')
            """
        )
        conn.execute(
            """
            UPDATE jobs
            SET source_platform = 'boss'
            WHERE source = 'boss' AND source_platform <> 'boss'
            """
        )
        conn.commit()

        target_platforms = {
            str(platform or ""): int(count)
            for platform, count in conn.execute(
                "SELECT COALESCE(source_platform, ''), COUNT(*) FROM jobs GROUP BY COALESCE(source_platform, '')"
            )
        }
        status_counts = {
            str(status or ""): int(count)
            for status, count in conn.execute(
                "SELECT COALESCE(status, ''), COUNT(*) FROM jobs GROUP BY COALESCE(status, '')"
            )
        }
        missing_source_ids = int(
            conn.execute(
                "SELECT COUNT(*) FROM jobs WHERE source_platform = '51job' AND (source_job_id IS NULL OR TRIM(source_job_id) = '')"
            ).fetchone()[0]
        )
        duplicate_source_ids = int(
            conn.execute(
                """
                SELECT COUNT(*) FROM (
                    SELECT source_job_id
                    FROM jobs
                    WHERE source_platform = '51job' AND source_job_id IS NOT NULL AND TRIM(source_job_id) <> ''
                    GROUP BY source_job_id HAVING COUNT(*) > 1
                )
                """
            ).fetchone()[0]
        )
        orphan_history_rows = int(
            conn.execute(
                """
                SELECT COUNT(*) FROM history h
                LEFT JOIN jobs j ON j.id = h.job_id
                WHERE j.id IS NULL
                """
            ).fetchone()[0]
        )
        report = MigrationReport(
            source_path=str(source_path.resolve()),
            target_path=str(target_path.resolve()),
            total_jobs=int(conn.execute("SELECT COUNT(*) FROM jobs").fetchone()[0]),
            legacy_sources=preflight["legacy_sources"],
            target_platforms=target_platforms,
            status_counts=status_counts,
            history_rows=int(conn.execute("SELECT COUNT(*) FROM history").fetchone()[0]),
            orphan_history_rows=orphan_history_rows,
            job51_rows_missing_source_id=missing_source_ids,
            duplicate_job51_source_ids=duplicate_source_ids,
        )
    finally:
        conn.close()

    if report.total_jobs != preflight["total_jobs"]:
        raise LegacyMigrationError("迁移后岗位总数发生变化，目标数据库已保留供排查")
    if report.history_rows != preflight["history_rows"]:
        raise LegacyMigrationError("迁移后历史记录数量发生变化，目标数据库已保留供排查")
    if report.status_counts != preflight["status_counts"]:
        raise LegacyMigrationError("迁移后岗位状态统计发生变化，目标数据库已保留供排查")
    if report.target_platforms.get("51job", 0) != preflight["legacy_sources"].get("51job", 0):
        raise LegacyMigrationError("51job 岗位数量校验失败，目标数据库已保留供排查")
    if report.job51_rows_missing_source_id or report.duplicate_job51_source_ids or report.orphan_history_rows:
        raise LegacyMigrationError("迁移完整性校验失败，目标数据库已保留供排查")
    return report

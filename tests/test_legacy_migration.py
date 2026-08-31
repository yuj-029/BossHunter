import sqlite3
import tempfile
from pathlib import Path
from unittest import TestCase

from bosshunter.legacy_migration import inspect_legacy_database, migrate_legacy_database


def _create_legacy_database(path: Path) -> None:
    conn = sqlite3.connect(path)
    conn.executescript(
        """
        CREATE TABLE jobs (
            id TEXT PRIMARY KEY,
            title TEXT NOT NULL,
            company TEXT NOT NULL,
            salary TEXT,
            city TEXT,
            experience TEXT,
            jd TEXT,
            hr_name TEXT,
            hr_title TEXT,
            hr_active TEXT,
            company_size TEXT,
            company_industry TEXT,
            url TEXT,
            score INTEGER DEFAULT 0,
            score_reason TEXT,
            greeting TEXT,
            status TEXT DEFAULT 'pending',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            quick_score INTEGER DEFAULT 0,
            resume_path TEXT DEFAULT NULL,
            deleted_at TIMESTAMP NULL,
            deleted_reason TEXT NULL,
            source TEXT NULL
        );
        CREATE TABLE history (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            job_id TEXT NOT NULL,
            action TEXT NOT NULL,
            detail TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE risk_events (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            event_type TEXT NOT NULL,
            detail TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE scoring_runs (
            id TEXT PRIMARY KEY,
            task_id TEXT,
            status TEXT NOT NULL,
            options_json TEXT NOT NULL,
            remaining_job_ids_json TEXT NOT NULL,
            progress_json TEXT NOT NULL,
            pause_reason TEXT,
            error TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            finished_at TIMESTAMP NULL
        );
        """
    )
    conn.executemany(
        "INSERT INTO jobs (id, title, company, status, source) VALUES (?, ?, ?, ?, ?)",
        [
            ("boss-1", "BOSS 岗位", "公司 A", "sent", "boss"),
            ("51job-1", "51job 岗位", "公司 B", "ready", "51job"),
            ("51job-2", "51job 岗位二", "公司 C", "filtered", "51job"),
        ],
    )
    conn.execute("INSERT INTO history (job_id, action) VALUES ('51job-1', 'sent')")
    conn.commit()
    conn.close()


class LegacyMigrationTests(TestCase):
    def test_copies_and_migrates_legacy_51job_identity_without_losing_history(self):
        with tempfile.TemporaryDirectory() as tmp:
            source = Path(tmp) / "legacy.db"
            target = Path(tmp) / "migrated.db"
            _create_legacy_database(source)

            report = migrate_legacy_database(source, target)
            conn = sqlite3.connect(target)
            conn.row_factory = sqlite3.Row
            rows = {
                row["id"]: dict(row)
                for row in conn.execute("SELECT id, source_platform, source_job_id, status FROM jobs")
            }
            conn.close()

        self.assertEqual(report.total_jobs, 3)
        self.assertEqual(report.history_rows, 1)
        self.assertEqual(report.target_platforms, {"boss": 1, "51job": 2})
        self.assertEqual(report.orphan_history_rows, 0)
        self.assertEqual(rows["boss-1"]["source_platform"], "boss")
        self.assertIsNone(rows["boss-1"]["source_job_id"])
        self.assertEqual(rows["51job-1"]["source_platform"], "51job")
        self.assertEqual(rows["51job-1"]["source_job_id"], "51job-1")
        self.assertEqual(rows["51job-2"]["status"], "filtered")

    def test_dry_preflight_does_not_create_target_database(self):
        with tempfile.TemporaryDirectory() as tmp:
            source = Path(tmp) / "legacy.db"
            _create_legacy_database(source)
            report = inspect_legacy_database(source)

        self.assertEqual(report["legacy_sources"], {"boss": 1, "51job": 2})
        self.assertEqual(report["total_jobs"], 3)

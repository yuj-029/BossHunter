"""Safely copy and migrate a pre-2.3.1 BossHunter database into 2.3.1."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
import sys

PROJECT_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PROJECT_ROOT / "src"))

from bosshunter.legacy_migration import inspect_legacy_database, migrate_legacy_database


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", required=True, type=Path, help="旧版 bosshunter.db（只读）")
    parser.add_argument("--target", type=Path, help="新的 2.3.1 数据库；必须不存在")
    parser.add_argument("--dry-run", action="store_true", help="仅检查旧库，不创建目标数据库")
    args = parser.parse_args()

    if args.dry_run:
        print(json.dumps(inspect_legacy_database(args.source), ensure_ascii=False, indent=2))
        return 0
    if args.target is None:
        parser.error("迁移时必须提供 --target；或使用 --dry-run")

    print(json.dumps(migrate_legacy_database(args.source, args.target).to_dict(), ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

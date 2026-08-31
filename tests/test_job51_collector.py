import json
import tempfile
from pathlib import Path
from unittest import TestCase

from bosshunter.collection.orchestrator import normalize_collection_options
from bosshunter.collection.platforms.job51 import (
    API_FETCH_TIMEOUT,
    API_PAGE_SIZE,
    API_SEARCH_URL,
    JS_FETCH_API_PAGE,
    Job51Browser,
    Job51Collector,
    _analyze_api_response,
    _ApiRateLimiter,
    get_51job_city_code,
)
from bosshunter.collection.text import clean_job_description
from bosshunter.db import (
    delete_page_progress,
    get_collected_combos,
    get_db,
    get_page_progress,
    mark_combo_collected,
    upsert_page_progress,
)


def _api_body(*items, total=None, status=1, message=""):
    return json.dumps(
        {
            "status": status,
            "message": message,
            "resultbody": {
                "job": {
                    "items": list(items),
                    "totalCount": len(items) if total is None else total,
                }
            },
        },
        ensure_ascii=False,
    )


class Job51CollectorTests(TestCase):
    def test_api_script_uses_same_origin_search_endpoint_and_request_placeholders(self):
        self.assertIn(API_SEARCH_URL, JS_FETCH_API_PAGE)
        self.assertIn("credentials: 'include'", JS_FETCH_API_PAGE)
        self.assertIn("pageSize=" + str(API_PAGE_SIZE), JS_FETCH_API_PAGE)
        for placeholder in ("__KW__", "__AREA__", "__PAGE__"):
            self.assertIn(placeholder, JS_FETCH_API_PAGE)

    def test_city_and_option_defaults_are_fail_closed(self):
        self.assertEqual(get_51job_city_code("北京市"), "010000")
        self.assertEqual(get_51job_city_code("上海市"), "020000")
        self.assertIsNone(get_51job_city_code("广州"))
        options = normalize_collection_options(
            {},
            {
                "platform_order": ["51job"],
                "platforms": {"51job": {"keywords": ["AI 产品"], "cities": ["上海"]}},
            },
        )
        search = options["platforms"]["51job"]
        self.assertEqual(search["city_codes"], {"上海": "020000"})
        self.assertEqual(search["max_pages"], 1)
        self.assertNotIn("target_count", search)

    def test_fetch_page_encodes_api_contract_and_analyzes_response(self):
        calls = []
        body = _api_body({"jobId": "job-1", "jobName": "AI 产品经理"}, total=41)
        browser = Job51Browser(
            evaluate=lambda target, script, **kwargs: calls.append((target, script, kwargs))
            or json.dumps(
                {
                    "http_status": 200,
                    "content_type": "application/json",
                    "body": body,
                }
            )
        )

        analysis = Job51Collector(browser=browser)._fetch_page("tab-1", "AI%20product", "020000", 3)

        self.assertTrue(analysis["ok"])
        self.assertEqual(analysis["total"], 41)
        target, script, kwargs = calls[0]
        self.assertEqual(target, "tab-1")
        self.assertNotIn("__KW__", script)
        self.assertIn("keyword=AI%20product", script)
        self.assertIn("jobArea=020000", script)
        self.assertIn("pageNum=3", script)
        self.assertEqual(kwargs["timeout"], API_FETCH_TIMEOUT)

    def test_api_response_classification_fails_closed_on_risk_signals(self):
        cases = [
            ((429, "application/json", "{}"), (3, "http_error")),
            ((200, "text/html", "<html>captcha verify</html>"), (3, "non_json")),
            ((200, "application/json", "{broken"), (1, "parse_error")),
            ((200, "application/json", _api_body(status=0, message="请完成验证")), (3, "hard_risk")),
            ((200, "application/json", _api_body(status=0, message="busy")), (2, "api_limited")),
            ((200, "application/json", _api_body(total=12)), (2, "empty_items")),
        ]

        for inputs, expected in cases:
            with self.subTest(signal=expected[1]):
                analysis = _analyze_api_response(*inputs)
                self.assertFalse(analysis["ok"])
                self.assertEqual((analysis["level"], analysis["signal"]), expected)

    def test_api_item_becomes_platform_candidate_with_inline_description(self):
        candidate = Job51Collector._item_to_candidate(
            {
                "jobId": "job-1",
                "jobName": "AI 产品经理",
                "fullCompanyName": "示例公司",
                "provideSalaryString": "20-30K",
                "jobAreaString": "上海·浦东",
                "workYearString": "3-5年",
                "degreeString": "本科",
                "jobDescribe": "负责 AI 产品规划",
                "hrName": "O'Connor\\HR",
                "jobHref": "https://jobs.51job.com/job-1.html",
            },
            "上海",
            "020000",
            "AI 产品",
        )

        self.assertEqual(candidate.storage_id, "51job:job-1")
        self.assertEqual(candidate.city, "上海")
        self.assertEqual(candidate.experience, "3-5年·本科")
        self.assertEqual(candidate.jd, "负责 AI 产品规划")
        self.assertEqual(candidate.hr_name, "O'Connor\\HR")

    def test_missing_identity_is_rejected(self):
        self.assertIsNone(Job51Collector._item_to_candidate({"jobName": "AI"}, "上海", "020000", "AI"))
        self.assertIsNone(Job51Collector._item_to_candidate({"jobId": "1"}, "上海", "020000", "AI"))

    def test_real_last_page_uses_total_count_without_exceeding_configured_limit(self):
        self.assertEqual(Job51Collector._real_last_page({"total": 41}, 50), 3)
        self.assertEqual(Job51Collector._real_last_page({"total": 2000}, 50), 50)
        self.assertEqual(Job51Collector._real_last_page({"total": 0}, 36), 36)

    def test_rate_limiter_only_tightens_as_request_volume_rises(self):
        light = _ApiRateLimiter(total_requests=65)
        medium = _ApiRateLimiter(total_requests=66)
        heavy = _ApiRateLimiter(total_requests=131)

        self.assertEqual(light.gap_range, (2.0, 3.0))
        self.assertEqual(medium.gap_range, (3.0, 5.0))
        self.assertEqual(heavy.gap_range, (5.0, 8.0))
        self.assertEqual(
            [light.per_min_limit, medium.per_min_limit, heavy.per_min_limit],
            [30, 20, 12],
        )

    def test_word_and_page_checkpoints_round_trip(self):
        with tempfile.TemporaryDirectory(dir=Path.cwd()) as tmp:
            conn = get_db(Path(tmp) / "job51-progress.db")
            try:
                mark_combo_collected(conn, "51job", "上海", "AI 产品")
                upsert_page_progress(conn, "51job", "上海", "AI 产品", 7)
                upsert_page_progress(conn, "51job", "上海", "AI 产品", 9)

                self.assertEqual(get_collected_combos(conn, "51job"), {("上海", "AI 产品")})
                self.assertEqual(get_page_progress(conn, "51job", "上海", "AI 产品"), 9)
                self.assertEqual(delete_page_progress(conn, "51job", "上海", "AI 产品"), 1)
                self.assertEqual(get_page_progress(conn, "51job", "上海", "AI 产品"), 0)
            finally:
                conn.close()


class JobDescriptionCleanupTests(TestCase):
    def test_known_platform_source_noise_is_removed(self):
        dirty = "[岗位kanzhun职责]1.公司业务后台开发 来自BOSS直聘 2.掌握 SQL"
        self.assertEqual(clean_job_description(dirty), "1.公司业务后台开发 2.掌握 SQL")

import json
from unittest import TestCase

from bosshunter.collection.base import CollectorHooks
from bosshunter.collection.models import PlatformCollectionRequest
from bosshunter.collection.platforms.boss import (
    JS_DETECT_COLLECTION_RISK,
    JS_EXTRACT_LIST,
    BossBrowser,
    BossCollector,
)


class BossCollectorTests(TestCase):
    def test_stops_keyword_after_two_consecutive_pages_without_eligible_jobs(self):
        list_calls = []

        def evaluate(_target, script):
            if script == JS_DETECT_COLLECTION_RISK:
                return json.dumps({"risk": None})
            if script == JS_EXTRACT_LIST:
                list_calls.append(1)
                return json.dumps([
                    {"title": "IT主管", "company": "示例公司", "url": "/job_detail/duplicate.html"}
                ])
            self.fail("unexpected browser script")

        browser = BossBrowser(
            new_tab=lambda *_args, **_kwargs: "worker",
            close_tab=lambda *_args: True,
            evaluate=evaluate,
            navigate=lambda *_args: True,
            scroll=lambda *_args, **_kwargs: True,
            wait_for_load=lambda *_args, **_kwargs: True,
        )
        collector = BossCollector(browser=browser, sleep=lambda _seconds: None, config={})
        hooks = CollectorHooks(
            stop_event=None,
            on_list_candidate=lambda _candidate: False,
            on_candidate=lambda _candidate: True,
            on_parse_failed=lambda _message: None,
            on_event=lambda **_values: None,
        )
        request = PlatformCollectionRequest(
            platform="boss", keywords=["IT主管"], cities=["上海"],
            city_codes={"上海": "101020100"}, max_pages=4, sort="newest",
        )

        result = collector.collect(request, hooks)

        self.assertEqual(result.status, "completed")
        self.assertEqual(len(list_calls), 3)


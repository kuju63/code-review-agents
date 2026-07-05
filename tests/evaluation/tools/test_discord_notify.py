"""Tests for evaluation/tools/discord_notify.py."""

from __future__ import annotations

import logging

import httpx

from tests.evaluation.conftest import load_eval_tool_module

discord_notify = load_eval_tool_module("discord_notify", "discord_notify.py")


def _scores(*, critical_miss_rate: float, must_find_recall: float) -> dict:
    return {
        "gold": {
            "issue_recall": 0.8,
            "issue_precision": 0.7,
            "severity_agreement": 0.75,
            "counts": {},
        },
        "seeded": {
            "must_find_recall": must_find_recall,
            "critical_miss_rate": critical_miss_rate,
            "counts": {},
        },
    }


class TestBuildNotificationPayload:
    def test_hard_gate_pass_uses_green_color_and_pass_label(self):
        scores = _scores(critical_miss_rate=0.0, must_find_recall=1.0)

        payload = discord_notify.build_notification_payload(
            scores,
            failed_ids=[],
            report_path="evaluation/data/report_20260705-000000-abcdef.md",
            commit_hash="abcdef",
            model_id="gpt-4o",
            executed_at="2026-07-05T00:00:00Z",
        )

        embed = payload["embeds"][0]
        assert embed["color"] == discord_notify._COLOR_PASS
        gate_field = next(f for f in embed["fields"] if f["name"] == "Hard Gate")
        assert "PASS" in gate_field["value"]
        assert "report_20260705-000000-abcdef.md" in embed["description"]

    def test_hard_gate_fail_uses_red_color_and_fail_label(self):
        scores = _scores(critical_miss_rate=0.2, must_find_recall=0.5)

        payload = discord_notify.build_notification_payload(
            scores,
            failed_ids=["seeded-1", "seeded-2"],
            report_path="evaluation/data/report_20260705-000000-abcdef.md",
            commit_hash="abcdef",
            model_id="gpt-4o",
            executed_at="2026-07-05T00:00:00Z",
        )

        embed = payload["embeds"][0]
        assert embed["color"] == discord_notify._COLOR_FAIL
        gate_field = next(f for f in embed["fields"] if f["name"] == "Hard Gate")
        assert "FAIL" in gate_field["value"]
        failed_field = next(f for f in embed["fields"] if f["name"] == "失敗アイテム数")
        assert failed_field["value"] == "2"

    def test_must_find_recall_below_threshold_alone_fails_gate(self):
        scores = _scores(critical_miss_rate=0.0, must_find_recall=0.94)

        payload = discord_notify.build_notification_payload(
            scores,
            failed_ids=[],
            report_path="report.md",
            commit_hash="x",
            model_id="m",
            executed_at="2026-07-05T00:00:00Z",
        )

        embed = payload["embeds"][0]
        assert embed["color"] == discord_notify._COLOR_FAIL


class TestSendDiscordNotification:
    def test_noop_when_webhook_url_is_none(self, monkeypatch):
        called = False

        def fake_post(*args, **kwargs):
            nonlocal called
            called = True

        monkeypatch.setattr(httpx, "post", fake_post)

        discord_notify.send_discord_notification(None, {"embeds": []})

        assert called is False

    def test_noop_when_webhook_url_is_empty_string(self, monkeypatch):
        called = False

        def fake_post(*args, **kwargs):
            nonlocal called
            called = True

        monkeypatch.setattr(httpx, "post", fake_post)

        discord_notify.send_discord_notification("", {"embeds": []})

        assert called is False

    def test_posts_payload_to_webhook_url(self, monkeypatch):
        captured = {}

        class FakeResponse:
            def raise_for_status(self):
                pass

        def fake_post(url, json, timeout):
            captured["url"] = url
            captured["json"] = json
            captured["timeout"] = timeout
            return FakeResponse()

        monkeypatch.setattr(httpx, "post", fake_post)

        payload = {"embeds": [{"title": "x"}]}
        discord_notify.send_discord_notification(
            "https://discord.example/webhook", payload
        )

        assert captured["url"] == "https://discord.example/webhook"
        assert captured["json"] == payload
        assert captured["timeout"] == 10

    def test_network_error_is_logged_and_not_raised(self, monkeypatch, caplog):
        def fake_post(*args, **kwargs):
            raise httpx.ConnectError("boom")

        monkeypatch.setattr(httpx, "post", fake_post)

        with caplog.at_level(logging.WARNING):
            discord_notify.send_discord_notification(
                "https://discord.example/webhook", {"embeds": []}
            )

        assert any("Discord notification failed" in r.message for r in caplog.records)

    def test_http_error_status_is_logged_and_not_raised(self, monkeypatch, caplog):
        request = httpx.Request("POST", "https://discord.example/webhook")
        response = httpx.Response(400, request=request)

        class FakeResponse:
            def raise_for_status(self):
                raise httpx.HTTPStatusError(
                    "bad status", request=request, response=response
                )

        def fake_post(*args, **kwargs):
            return FakeResponse()

        monkeypatch.setattr(httpx, "post", fake_post)

        with caplog.at_level(logging.WARNING):
            discord_notify.send_discord_notification(
                "https://discord.example/webhook", {"embeds": []}
            )

        assert any("Discord notification failed" in r.message for r in caplog.records)

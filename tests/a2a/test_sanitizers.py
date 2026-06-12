from code_review_agent.a2a.sanitizers import sanitize_error


class TestSanitizeError:
    def test_redacts_bearer_token(self) -> None:
        exc = Exception("request failed: Bearer ghp_abc123xyz")
        assert sanitize_error(exc) == "request failed: [REDACTED]"

    def test_redacts_ghp_token_standalone(self) -> None:
        exc = Exception("invalid token ghp_secrettoken123")
        assert "[REDACTED]" in sanitize_error(exc)
        assert "ghp_secrettoken123" not in sanitize_error(exc)

    def test_redacts_github_pat_token(self) -> None:
        exc = Exception("auth error: github_pat_longtoken123abc")
        assert "[REDACTED]" in sanitize_error(exc)
        assert "github_pat_longtoken123abc" not in sanitize_error(exc)

    def test_case_insensitive_bearer(self) -> None:
        exc = Exception("BEARER token123abc")
        assert "[REDACTED]" in sanitize_error(exc)
        assert "token123abc" not in sanitize_error(exc)

    def test_preserves_message_without_token(self) -> None:
        exc = ValueError("connection refused: localhost:8000")
        result = sanitize_error(exc)
        assert result == "connection refused: localhost:8000"

    def test_returns_string(self) -> None:
        exc = RuntimeError("some error")
        assert isinstance(sanitize_error(exc), str)

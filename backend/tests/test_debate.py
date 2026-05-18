"""Tests for iterative debate logic."""
import math
import pytest
from backend.debate import check_convergence, truncate_text

MAX_DEBATE_ROUNDS = 5


class TestConvergence:
    def test_stable_top_half(self):
        prev = [{"model": "a", "average_rank": 1.0}, {"model": "b", "average_rank": 2.0},
                {"model": "c", "average_rank": 3.0}, {"model": "d", "average_rank": 4.0}]
        curr = [{"model": "a", "average_rank": 1.2}, {"model": "b", "average_rank": 1.8},
                {"model": "d", "average_rank": 3.0}, {"model": "c", "average_rank": 4.0}]
        assert check_convergence(curr, prev) is True

    def test_unstable(self):
        prev = [{"model": "a", "average_rank": 1.0}, {"model": "b", "average_rank": 2.0},
                {"model": "c", "average_rank": 3.0}]
        curr = [{"model": "c", "average_rank": 1.0}, {"model": "a", "average_rank": 2.0},
                {"model": "b", "average_rank": 3.0}]
        assert check_convergence(curr, prev) is False

    def test_empty(self):
        assert check_convergence([], [{"model": "a", "average_rank": 1.0}]) is False
        assert check_convergence([{"model": "a", "average_rank": 1.0}], []) is False

    def test_single_model(self):
        assert check_convergence(
            [{"model": "a", "average_rank": 1.0}],
            [{"model": "a", "average_rank": 1.0}]
        ) is True

    def test_model_dropped(self):
        prev = [{"model": "a", "average_rank": 1.0}, {"model": "b", "average_rank": 2.0},
                {"model": "c", "average_rank": 3.0}]
        curr = [{"model": "a", "average_rank": 1.0}, {"model": "b", "average_rank": 2.0}]
        assert check_convergence(curr, prev) is True

    def test_no_common_models(self):
        prev = [{"model": "a", "average_rank": 1.0}]
        curr = [{"model": "x", "average_rank": 1.0}]
        assert check_convergence(curr, prev) is False

    def test_one_common_model(self):
        prev = [{"model": "a", "average_rank": 1.0}, {"model": "b", "average_rank": 2.0}]
        curr = [{"model": "a", "average_rank": 1.0}, {"model": "x", "average_rank": 2.0}]
        assert check_convergence(curr, prev) is True


class TestTruncateText:
    def test_short(self):
        assert truncate_text("hello", 100) == "hello"

    def test_long(self):
        text = "a" * 200
        result = truncate_text(text, 100)
        assert "[...truncated...]" in result
        assert result.startswith("a" * 50)
        assert result.endswith("a" * 50)

    def test_none(self):
        assert truncate_text(None, 100) == ""

    def test_empty(self):
        assert truncate_text("", 100) == ""

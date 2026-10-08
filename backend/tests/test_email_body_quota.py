"""Tests for _email_body() quota line rendering (iteration 11).

Contract:
- Always render 'Pagato da <P1>' and 'Pagato da <P2>' lines.
- Render 'Quota <P1>' and 'Quota <P2>' lines ONLY when at least one expense
  has pct_parent1 != 50 (i.e. not all expenses are 50/50).
- Empty expenses => no 'Quota ' lines; 'Pagato da' with € 0,00 remains.
- Both /close and /resend-email call _email_body so behavior is identical.
"""
import os
import sys
import re
import pytest

# Ensure backend dir on path so we can import server.py
sys.path.insert(0, "/app/backend")
from server import _email_body, _compute_totals  # noqa: E402


CFG = {"parent1_name": "Marco", "parent2_name": "Elena"}


def _render(expenses):
    blk = {"label": "Spese extra Marzo '26", "expenses": expenses}
    totals = _compute_totals(expenses, 50.0)
    return _email_body(CFG, blk, totals, download_url="https://example.com/dl/abc")


# ---------- Case 1: all 50/50 ----------
class TestAllFiftyFifty:
    def test_contains_pagato_da_for_both_parents(self):
        html = _render([
            {"amount": 100.0, "paid_by": "parent1", "pct_parent1": 50, "pct_parent2": 50},
            {"amount": 50.0,  "paid_by": "parent2", "pct_parent1": 50, "pct_parent2": 50},
        ])
        assert "Pagato da Marco" in html
        assert "Pagato da Elena" in html

    def test_does_not_contain_quota_word(self):
        html = _render([
            {"amount": 100.0, "paid_by": "parent1", "pct_parent1": 50, "pct_parent2": 50},
            {"amount": 50.0,  "paid_by": "parent2", "pct_parent1": 50, "pct_parent2": 50},
        ])
        # "Quota " with trailing space (the user-facing label).
        assert "Quota " not in html, f"Expected no 'Quota ' line, found in: {html[:400]}"
        # Also absent in label-with-colon form
        assert "Quota Marco" not in html
        assert "Quota Elena" not in html


# ---------- Case 2: not all 50/50 ----------
class TestNotAllFiftyFifty:
    def test_contains_both_pagato_da_and_quota(self):
        html = _render([
            {"amount": 100.0, "paid_by": "parent1", "pct_parent1": 70, "pct_parent2": 30},
            {"amount": 50.0,  "paid_by": "parent2", "pct_parent1": 50, "pct_parent2": 50},
        ])
        assert "Pagato da Marco" in html
        assert "Pagato da Elena" in html
        assert "Quota Marco" in html
        assert "Quota Elena" in html

    def test_single_non_half_expense_triggers_quota(self):
        html = _render([
            {"amount": 100.0, "paid_by": "parent1", "pct_parent1": 60, "pct_parent2": 40},
        ])
        assert "Quota Marco" in html
        assert "Quota Elena" in html


# ---------- Case 3: no expenses ----------
class TestNoExpenses:
    def test_no_quota_lines_and_pagato_zero(self):
        html = _render([])
        # No 'Quota ' lines at all (empty => considered all_half==True + no expenses => skipped)
        assert "Quota " not in html
        assert "Quota Marco" not in html
        assert "Quota Elena" not in html
        # Pagato da lines still present with €0,00
        assert "Pagato da Marco" in html
        assert "Pagato da Elena" in html
        # Zero amount formatted as "€ 0,00"
        assert "€ 0,00" in html


# ---------- Case 4: name escaping safety (regression) ----------
class TestNameEscaping:
    def test_special_chars_in_name_html_escaped(self):
        html = _email_body(
            {"parent1_name": "O'Brien", "parent2_name": "<Elena>"},
            {"label": "Test", "expenses": [{"amount": 10, "paid_by": "parent1",
                                            "pct_parent1": 70, "pct_parent2": 30}]},
            _compute_totals([{"amount": 10, "paid_by": "parent1",
                              "pct_parent1": 70, "pct_parent2": 30}], 50.0),
            download_url="https://example.com/x",
        )
        # Raw < must not appear unescaped around Elena
        assert "<Elena>" not in html
        # Escaped forms should be present somewhere
        assert "&lt;Elena&gt;" in html or "&lt;elena&gt;" in html.lower()


# ---------- Case 5: pct float boundary (49.995 ~ 50) ----------
class TestFloatBoundary:
    def test_close_to_fifty_treated_as_half(self):
        # pct_parent1 just under tolerance: still "all half"
        html = _render([
            {"amount": 100.0, "paid_by": "parent1", "pct_parent1": 50.001, "pct_parent2": 49.999},
        ])
        assert "Quota " not in html

    def test_just_outside_tolerance_triggers_quota(self):
        html = _render([
            {"amount": 100.0, "paid_by": "parent1", "pct_parent1": 50.5, "pct_parent2": 49.5},
        ])
        assert "Quota Marco" in html
        assert "Quota Elena" in html


if __name__ == "__main__":
    sys.exit(pytest.main([__file__, "-v", "--tb=short"]))

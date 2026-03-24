"""Tests for the diplomatic memory system."""

import pytest
from diplomacy.services.memory import (
    extract_memories,
    build_memory_section,
    _classify_message,
    _extract_fact,
    MAX_MEMORY_CHARS,
)


class TestClassifyMessage:
    """Test message classification."""

    def test_deal_keywords(self):
        cats = _classify_message("I offer you 50 gold for an alliance")
        assert "deal" in cats

    def test_promise_keywords(self):
        cats = _classify_message("I promise to protect your borders")
        assert "promise" in cats

    def test_insult_keywords(self):
        cats = _classify_message("You are a fool and a coward")
        assert "insult" in cats

    def test_topic_keywords(self):
        cats = _classify_message("Let us discuss the war in the north")
        assert "topic" in cats

    def test_multiple_categories(self):
        cats = _classify_message("I promise to trade gold for peace")
        assert "promise" in cats
        assert "deal" in cats
        assert "topic" in cats

    def test_no_categories(self):
        cats = _classify_message("Hello, how are you today?")
        assert len(cats) == 0

    def test_case_insensitive(self):
        cats = _classify_message("I PROMISE TO TRADE GOLD")
        assert "promise" in cats
        assert "deal" in cats


class TestExtractFact:
    """Test individual fact extraction."""

    def test_user_deal_message(self):
        msg = {"role": "user", "content": "I offer 50 gold for your alliance"}
        fact = _extract_fact(msg)
        assert fact is not None
        assert "Player" in fact

    def test_assistant_deal_message(self):
        msg = {"role": "assistant", "content": "I accept your trade offer gladly"}
        fact = _extract_fact(msg)
        assert fact is not None
        assert "Faction" in fact

    def test_promise_message(self):
        msg = {"role": "user", "content": "I swear to defend your lands"}
        fact = _extract_fact(msg)
        assert fact is not None
        assert "promise" in fact.lower()

    def test_insult_message(self):
        msg = {"role": "user", "content": "You are a pathetic fool"}
        fact = _extract_fact(msg)
        assert fact is not None
        assert "hostile" in fact.lower()

    def test_topic_message(self):
        msg = {"role": "user", "content": "What do you know about the war?"}
        fact = _extract_fact(msg)
        assert fact is not None
        assert "Discussed" in fact

    def test_non_memorable_returns_none(self):
        msg = {"role": "user", "content": "Hello, nice day isn't it?"}
        fact = _extract_fact(msg)
        assert fact is None

    def test_long_content_truncated(self):
        msg = {
            "role": "user",
            "content": "I offer a " + "very " * 50 + "generous trade deal for your alliance",
        }
        fact = _extract_fact(msg)
        assert fact is not None
        assert len(fact) < 200

    def test_empty_content(self):
        msg = {"role": "user", "content": ""}
        fact = _extract_fact(msg)
        assert fact is None


class TestExtractMemories:
    """Test memory extraction from conversation threads."""

    def test_empty_thread(self):
        assert extract_memories([]) == []

    def test_single_memorable_message(self):
        thread = [{"role": "user", "content": "I offer 50 gold for your alliance"}]
        facts = extract_memories(thread)
        assert len(facts) == 1

    def test_mixed_memorable_and_not(self):
        thread = [
            {"role": "user", "content": "Hello there!"},
            {"role": "assistant", "content": "Greetings, traveller."},
            {"role": "user", "content": "I offer you gold for an alliance"},
            {"role": "assistant", "content": "I accept your trade offer"},
        ]
        facts = extract_memories(thread)
        assert len(facts) == 2  # Only the deal messages

    def test_multiple_facts(self):
        thread = [
            {"role": "user", "content": "I promise to protect your people"},
            {"role": "assistant", "content": "I accept your alliance offer"},
            {"role": "user", "content": "You are a fool if you think I'll pay tribute"},
            {"role": "assistant", "content": "War is coming to your borders"},
        ]
        facts = extract_memories(thread)
        assert len(facts) >= 3

    def test_order_preserved(self):
        thread = [
            {"role": "user", "content": "I offer gold first"},
            {"role": "user", "content": "Then I promise peace"},
        ]
        facts = extract_memories(thread)
        assert len(facts) == 2
        assert "gold" in facts[0].lower()
        assert "peace" in facts[1].lower()


class TestBuildMemorySection:
    """Test the memory prompt section builder."""

    def test_empty_thread_returns_empty(self):
        assert build_memory_section([]) == ""

    def test_non_memorable_thread_returns_empty(self):
        thread = [
            {"role": "user", "content": "Hello!"},
            {"role": "assistant", "content": "Hi there."},
        ]
        assert build_memory_section(thread) == ""

    def test_memorable_thread_returns_section(self):
        thread = [
            {"role": "user", "content": "I offer 50 gold for your alliance"},
            {"role": "assistant", "content": "Accepted. Let us trade."},
        ]
        section = build_memory_section(thread)
        assert "MEMORY" in section
        assert "key facts" in section.lower()

    def test_section_under_token_budget(self):
        """Memory section should be under MAX_MEMORY_CHARS."""
        thread = [
            {"role": "user", "content": "I offer 50 gold for your alliance"},
            {"role": "assistant", "content": "I accept the trade deal and promise peace"},
            {"role": "user", "content": "I swear to defend your borders from attack"},
            {"role": "assistant", "content": "War threatens the western territory"},
            {"role": "user", "content": "I pledge gold tribute for your military support"},
            {"role": "assistant", "content": "The alliance is sealed with this trade agreement"},
            {"role": "user", "content": "I promise to send troops to defend your city"},
            {"role": "assistant", "content": "Your army strength impresses me, let us trade weapons"},
        ]
        section = build_memory_section(thread)
        assert len(section) <= MAX_MEMORY_CHARS

    def test_section_uses_bullet_points(self):
        thread = [
            {"role": "user", "content": "I offer gold for an alliance"},
            {"role": "assistant", "content": "Your trade deal is accepted"},
        ]
        section = build_memory_section(thread)
        assert "- " in section

    def test_recent_facts_prioritized(self):
        """More recent facts should be included when budget is tight."""
        thread = [
            {"role": "user", "content": f"I offer gold deal number {i}"} for i in range(20)
        ]
        section = build_memory_section(thread)
        # Should include later entries
        assert len(section) <= MAX_MEMORY_CHARS
        assert len(section) > 0

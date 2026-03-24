"""Tests for the Claude service — action parsing."""

import pytest
from diplomacy.services.claude import parse_action


class TestParseAction:
    def test_basic_action(self):
        text = 'I offer you gold. [ACTION: {"type": "offer_trade", "give": "gold:50", "receive": "science:20"}]'
        clean, action = parse_action(text)
        assert clean == "I offer you gold."
        assert action is not None
        assert action["type"] == "offer_trade"
        assert action["give"] == "gold:50"

    def test_no_action(self):
        text = "Just a friendly conversation."
        clean, action = parse_action(text)
        assert clean == text
        assert action is None

    def test_declare_war(self):
        text = 'Prepare for battle! [ACTION: {"type": "declare_war"}]'
        clean, action = parse_action(text)
        assert clean == "Prepare for battle!"
        assert action["type"] == "declare_war"

    def test_partial_action_stripped(self):
        text = "Some text [ACTION: broken json"
        clean, action = parse_action(text)
        assert "ACTION" not in clean
        assert clean == "Some text"
        assert action is None

    def test_game_mod_action(self):
        text = 'I teach you warfare. [ACTION: {"type": "game_mod", "mod": {"type": "new_unit", "id": "war_elephant"}}]'
        clean, action = parse_action(text)
        assert clean == "I teach you warfare."
        assert action["type"] == "game_mod"
        assert action["mod"]["type"] == "new_unit"

    def test_none_action(self):
        text = 'Interesting. [ACTION: {"type": "none"}]'
        clean, action = parse_action(text)
        assert clean == "Interesting."
        assert action["type"] == "none"

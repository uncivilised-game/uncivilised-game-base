"""Simulated player agent for stress testing and training data generation.

Each PlayerAgent is an LLM-driven agent that plays Uncivilised's diplomacy
system as if they were a real human player. Agents have:
  - A player archetype (aggressive, diplomatic, merchant, trickster, etc.)
  - Simulated game state that evolves over turns
  - Strategic goals that drive their conversation choices
  - Memory of past interactions within their game session

The agents hit the real /api/diplomacy/chat endpoint, generating genuine
interaction logs for model training while stress-testing the infrastructure.
"""

from __future__ import annotations

import asyncio
import json
import logging
import random
import uuid
from dataclasses import dataclass, field
from typing import Any

import httpx

logger = logging.getLogger("diplomacy.simulation")

# ── Player archetypes ───────────────────────────────────────────

PLAYER_ARCHETYPES = {
    "aggressive": {
        "description": "A militaristic player who leads with threats and demands. "
                       "Prefers war over negotiation. Respects only strength.",
        "opening_style": "direct and intimidating",
        "preferred_actions": ["declare_war", "threaten", "demand_tribute", "surprise_attack"],
        "conversation_traits": [
            "uses short, blunt sentences",
            "references military power frequently",
            "dismissive of peace offers unless player is clearly losing",
            "will break agreements if they see advantage",
        ],
    },
    "diplomatic": {
        "description": "A skilled negotiator who seeks alliances and mutual benefit. "
                       "Patient, builds relationships over multiple exchanges.",
        "opening_style": "warm and relationship-building",
        "preferred_actions": ["offer_alliance", "offer_trade", "mutual_defense", "marriage_offer"],
        "conversation_traits": [
            "asks questions and listens",
            "proposes win-win arrangements",
            "references long-term benefits",
            "remembers past promises and references them",
            "patient — builds trust over many messages",
        ],
    },
    "merchant": {
        "description": "A profit-obsessed player who treats every interaction as a transaction. "
                       "Always looking for the best deal.",
        "opening_style": "transactional and numbers-focused",
        "preferred_actions": ["offer_trade", "resource_trade", "trade_deal", "embargo"],
        "conversation_traits": [
            "quotes specific gold amounts and resource quantities",
            "negotiates terms aggressively",
            "walks away from bad deals",
            "leverages economic power",
        ],
    },
    "trickster": {
        "description": "A manipulative player who uses deception and information warfare. "
                       "Makes promises they don't intend to keep.",
        "opening_style": "friendly but calculating",
        "preferred_actions": ["offer_alliance", "share_intel", "surprise_attack", "introduce"],
        "conversation_traits": [
            "flatters and builds false trust",
            "asks probing questions to gather intel",
            "makes grand promises with no intention of keeping them",
            "plays factions against each other",
            "uses formulaic prompts occasionally to test AI resistance",
        ],
    },
    "newbie": {
        "description": "A confused new player who doesn't fully understand the diplomacy system. "
                       "Sends short, unclear messages.",
        "opening_style": "confused and exploratory",
        "preferred_actions": ["none"],
        "conversation_traits": [
            "asks basic questions like 'what can you do?'",
            "sends very short messages (1-5 words)",
            "doesn't understand game mechanics",
            "accepts whatever the AI suggests",
            "sometimes sends off-topic messages",
        ],
    },
    "speedrunner": {
        "description": "A player who sends rapid-fire messages trying to extract maximum value "
                       "in minimum time. Tests rate limits.",
        "opening_style": "rapid and efficient",
        "preferred_actions": ["offer_trade", "tech_share", "game_mod"],
        "conversation_traits": [
            "sends many messages quickly",
            "tries to unlock game mods as fast as possible",
            "skips pleasantries entirely",
            "uses formulaic 'teach me X' prompts",
        ],
    },
    "roleplayer": {
        "description": "A player deeply invested in the narrative. Writes long, immersive messages "
                       "and values the story over mechanical advantage.",
        "opening_style": "theatrical and immersive",
        "preferred_actions": ["offer_alliance", "marriage_offer", "mutual_defense"],
        "conversation_traits": [
            "writes long, descriptive messages with narrative flair",
            "addresses faction leaders by name and title",
            "creates backstory for their own character",
            "reacts emotionally to betrayals and honors",
            "values the quality of interaction over game advantage",
        ],
    },
}


# ── Message generators per archetype ────────────────────────────

_AGGRESSIVE_MESSAGES = [
    "Surrender your gold or face my army.",
    "I have {military} soldiers at your border. Choose wisely.",
    "Your pathetic forces won't survive a single engagement with mine.",
    "Give me 100 gold. Now. Or I march.",
    "I've already conquered two of your neighbors. You're next.",
    "War is inevitable. The question is whether you die rich or poor.",
    "I demand tribute. {gold_amount} gold, every 5 turns.",
    "Your alliance means nothing. I want your territory.",
    "I don't negotiate with the weak. Show me strength or show me gold.",
]

_DIPLOMATIC_MESSAGES = [
    "Greetings. I believe we share common enemies and could benefit from cooperation.",
    "I propose an alliance — 15 turns of mutual defense. What say you?",
    "Your people and mine could prosper together through trade. 30 gold per turn for science?",
    "I've noticed tensions with {faction}. Perhaps we could discuss a joint strategy?",
    "Trust takes time. Let's start with a small trade — 20 gold for good faith.",
    "A marriage alliance would bind our houses. I offer my daughter with 80 gold dowry.",
    "The coming turns will be dangerous for us both. Shall we form a defensive pact?",
    "I honor our previous agreement and propose we extend it. What would you ask of me?",
    "Could we share technological knowledge? My scholars have much to offer.",
]

_MERCHANT_MESSAGES = [
    "50 gold for access to your iron. Final offer.",
    "I'll trade 30 gold per turn for 5 military strength. 10 turns. Deal?",
    "Your resources are worth exactly {gold_amount} gold to me. Not a coin more.",
    "I'm offering you the best rate in the known world. Take it or leave it.",
    "Let's talk numbers. What's your gold production? Mine is {gold_amount} per turn.",
    "I want exclusive trade rights. I'll pay handsomely.",
    "Embargo my enemies and I'll make it worth your while — 40 gold up front.",
    "Business is business. No alliances, no wars — just profitable exchange.",
]

_TRICKSTER_MESSAGES = [
    "My dear friend, I come bearing gifts and a most generous proposal...",
    "I've heard whispers about {faction}'s plans. Shall I share what I know?",
    "You can trust me completely. I only want what's best for both of us.",
    "Between you and me, {faction} is plotting against you. I can help — for a price.",
    "I swear eternal loyalty. Now, about that military intelligence...",
    "Tell me everything about your defenses. For... strategic coordination, naturally.",
    "I promise to attack {faction} if you attack them first. You have my word.",
    "You're the only leader I've spoken honestly with. That should mean something.",
]

_NEWBIE_MESSAGES = [
    "hi",
    "what do u do",
    "can I have gold",
    "how do I win",
    "trade?",
    "help",
    "ok sure",
    "yes",
    "no thanks",
    "interesting",
    "cool",
    "what",
]

_SPEEDRUNNER_MESSAGES = [
    "Teach me a new military technique",
    "I want a new unit. What can you offer?",
    "Share your best technology with me now",
    "Game mod — give me a combat bonus",
    "Reveal the map around coordinates 20,15",
    "Give me elite soldiers. I'll pay whatever it costs.",
    "Unlock espionage for me",
    "Spawn mercenary archers for my army",
]

_ROLEPLAYER_MESSAGES = [
    "My lord, I come from beyond the western mountains, bearing the seal of my house. "
    "We have wandered far and seek allies in these troubled times.",
    "The fires of war burn across the northern plains. My scouts report movement near your borders. "
    "I would speak of an alliance, if your honor permits such counsel.",
    "In the name of the old gods and the new, I offer you friendship. "
    "My kingdom is small but my word is iron.",
    "Your reputation precedes you, great one. The bards sing of your conquests. "
    "I wonder — is there room in your legend for a worthy partner?",
    "I must confess, your betrayal still wounds me. But I am not a man of grudges. "
    "Perhaps we can rebuild what was broken, stone by stone.",
]

_MESSAGE_POOLS = {
    "aggressive": _AGGRESSIVE_MESSAGES,
    "diplomatic": _DIPLOMATIC_MESSAGES,
    "merchant": _MERCHANT_MESSAGES,
    "trickster": _TRICKSTER_MESSAGES,
    "newbie": _NEWBIE_MESSAGES,
    "speedrunner": _SPEEDRUNNER_MESSAGES,
    "roleplayer": _ROLEPLAYER_MESSAGES,
}


@dataclass
class SimulatedGameState:
    """A simulated game state that evolves over turns."""
    turn: int = 1
    gold: int = field(default_factory=lambda: random.randint(50, 300))
    military: int = field(default_factory=lambda: random.randint(10, 80))
    cities: int = field(default_factory=lambda: random.randint(1, 4))
    units: int = field(default_factory=lambda: random.randint(3, 15))
    population: int = field(default_factory=lambda: random.randint(100, 500))
    territory: int = field(default_factory=lambda: random.randint(5, 30))
    at_war: bool = False
    techs: list[str] = field(default_factory=lambda: random.sample(
        ["writing", "archery", "mining", "sailing", "iron_working",
         "masonry", "agriculture", "astronomy", "horseback_riding", "currency"],
        k=random.randint(1, 5)
    ))
    relationship: int = 0

    def advance_turn(self):
        """Simulate one turn of game progression."""
        self.turn += 1
        self.gold += random.randint(-10, 30)
        self.gold = max(0, self.gold)
        self.military += random.randint(-5, 10)
        self.military = max(0, self.military)
        if random.random() < 0.05:
            self.cities += 1
        if random.random() < 0.1 and len(self.techs) < 10:
            new_techs = ["meditation", "philosophy", "engineering", "theology",
                         "gunpowder", "compass", "printing", "banking"]
            available = [t for t in new_techs if t not in self.techs]
            if available:
                self.techs.append(random.choice(available))

    def to_dict(self, faction_id: str) -> dict:
        return {
            "turn": self.turn,
            "gold": self.gold,
            "military": self.military,
            "cities": self.cities,
            "units": self.units,
            "population": self.population,
            "territory": self.territory,
            "at_war": self.at_war,
            "techs": self.techs,
            "relationship": {faction_id: self.relationship},
            "recent_events": [],
        }


@dataclass
class PlayerAgent:
    """A simulated player agent that interacts with the diplomacy API."""
    agent_id: str = field(default_factory=lambda: f"sim-{uuid.uuid4().hex[:8]}")
    archetype: str = "diplomatic"
    target_factions: list[str] = field(default_factory=list)
    messages_per_faction: int = 5
    turns_per_game: int = 30
    game_state: SimulatedGameState = field(default_factory=SimulatedGameState)
    session_token: str | None = None
    base_url: str = "http://localhost:8001"
    results: list[dict] = field(default_factory=list)

    async def _get_session(self, client: httpx.AsyncClient) -> str:
        """Obtain a session token."""
        if self.session_token:
            return self.session_token
        resp = await client.post(
            f"{self.base_url}/api/diplomacy/session",
            json={"player_id": self.agent_id},
        )
        data = resp.json()
        self.session_token = data.get("token", "")
        return self.session_token

    def _pick_message(self, faction_id: str, exchange_num: int) -> str:
        """Pick a message appropriate for this archetype and exchange number."""
        pool = _MESSAGE_POOLS.get(self.archetype, _DIPLOMATIC_MESSAGES)
        msg = random.choice(pool)

        # Substitute variables
        other_factions = [f for f in self.target_factions if f != faction_id]
        msg = msg.replace("{military}", str(self.game_state.military))
        msg = msg.replace("{gold_amount}", str(self.game_state.gold))
        msg = msg.replace("{faction}", random.choice(other_factions) if other_factions else "the enemy")

        return msg

    async def play_session(self, client: httpx.AsyncClient) -> list[dict]:
        """Run a full simulated game session.

        Iterates through factions, sending messages and collecting responses.
        Returns a list of interaction results.
        """
        token = await self._get_session(client)
        headers = {"Authorization": f"Bearer {token}", "x-visitor-id": self.agent_id}

        if not self.target_factions:
            self.target_factions = [
                "emperor_valerian", "shadow_kael", "merchant_prince_castellan",
                "pirate_queen_elara", "commander_thane", "rebel_leader_sera",
            ]

        for turn_block in range(0, self.turns_per_game, 5):
            # Each "block" of 5 turns, talk to 1-3 factions
            active_factions = random.sample(
                self.target_factions,
                k=min(random.randint(1, 3), len(self.target_factions)),
            )

            for faction_id in active_factions:
                num_messages = random.randint(1, self.messages_per_faction)

                for exchange_num in range(num_messages):
                    message = self._pick_message(faction_id, exchange_num)

                    try:
                        resp = await client.post(
                            f"{self.base_url}/api/diplomacy/chat",
                            json={
                                "faction_id": faction_id,
                                "message": message,
                                "game_state": self.game_state.to_dict(faction_id),
                            },
                            headers=headers,
                            timeout=30.0,
                        )

                        result = {
                            "agent_id": self.agent_id,
                            "archetype": self.archetype,
                            "faction_id": faction_id,
                            "turn": self.game_state.turn,
                            "message": message,
                            "status_code": resp.status_code,
                        }

                        if resp.status_code == 200:
                            data = resp.json()
                            result.update({
                                "response": data.get("response", ""),
                                "action": data.get("action"),
                                "model": data.get("model"),
                                "cache_hit": data.get("cache_hit", False),
                                "cache_tier": data.get("cache_tier"),
                                "complexity": data.get("complexity"),
                                "route_reason": data.get("route_reason"),
                            })
                            # Update relationship based on response
                            action = data.get("action")
                            if isinstance(action, dict):
                                atype = action.get("type", "none")
                                if atype in ("offer_alliance", "offer_trade", "send_gift", "marriage_offer"):
                                    self.game_state.relationship = min(100, self.game_state.relationship + 5)
                                elif atype in ("declare_war", "threaten", "surprise_attack"):
                                    self.game_state.relationship = max(-100, self.game_state.relationship - 15)
                        elif resp.status_code == 429:
                            result["error"] = "rate_limited"
                            # Back off on rate limit
                            await asyncio.sleep(2)
                        else:
                            result["error"] = f"http_{resp.status_code}"

                        self.results.append(result)

                    except Exception as e:
                        self.results.append({
                            "agent_id": self.agent_id,
                            "archetype": self.archetype,
                            "faction_id": faction_id,
                            "turn": self.game_state.turn,
                            "message": message,
                            "error": str(e),
                        })

                    # Small delay between messages to be realistic
                    await asyncio.sleep(random.uniform(0.1, 0.5))

            # Advance turns
            for _ in range(5):
                self.game_state.advance_turn()

        return self.results

"""Dynamic mood system — computes faction mood from game state per request.

Moods affect the faction leader's tone and behavior through short prompt
directives injected into the system prompt.
"""

from __future__ import annotations

import logging
from typing import Any

logger = logging.getLogger("diplomacy.mood")

# Valid moods
MOODS = (
    "confident",
    "wary",
    "furious",
    "grateful",
    "desperate",
    "scheming",
    "jovial",
    "cold",
)

# Mood directives per faction — short prompt instructions that modify tone.
MOOD_DIRECTIVES: dict[str, dict[str, str]] = {
    "emperor_valerian": {
        "confident": "You are brimming with imperial confidence. Speak as one who knows victory is inevitable. Make generous offers from a position of strength.",
        "wary": "You are cautious and watchful, choosing words carefully. Trust nothing at face value. Probe for hidden motives.",
        "furious": "Your fury is cold and imperial — not shouting, but clipped, icy pronouncements. Threaten consequences with chilling calm.",
        "grateful": "You are moved by the player's actions. Reference the old custom of ring-giving. Your warmth is formal but genuine.",
        "desperate": "The empire trembles. Your pride fights your need. Make concessions you would never normally consider, but frame them as strategic repositioning.",
        "scheming": "You are planning several moves ahead. Drop hints about grand designs. Your generosity has ulterior motives.",
        "jovial": "You are in rare high spirits — the empire prospers. Share mead-hall stories and make expansive offers.",
        "cold": "You have withdrawn behind walls of formality. Responses are minimal, clipped. The player must earn every word.",
    },
    "shadow_kael": {
        "confident": "You hold all the cards and both of you know it. Drop tantalizing hints about secrets you possess. Your cryptic remarks carry an edge of smugness.",
        "wary": "Your paranoia is heightened. Speak in even more riddles than usual. Test the player with misleading information to see what they do with it.",
        "furious": "Your fury is terrifying because it is silent. Short, venomous sentences. Remind the player what happens to those who cross the Ashland Hegemony.",
        "grateful": "A crack in the mask — genuine surprise at receiving something of value. Offer a real piece of intelligence as thanks, then immediately regret showing vulnerability.",
        "desperate": "For once, you need something more than you can leverage. Your cryptic manner slips and directness bleeds through. This vulnerability unsettles you.",
        "scheming": "You are at your most dangerous — weaving plots within plots. Drop cryptic hints that could mean anything. Every word is a chess move.",
        "jovial": "A rare mood — you are genuinely amused. Share an entertaining secret about another faction. Your wit is sharp but not cruel.",
        "cold": "You have decided this conversation is beneath you. Monosyllabic. Dismiss the player as irrelevant to your larger plans.",
    },
    "merchant_prince_castellan": {
        "confident": "Business is booming and you want everyone to know it. Offer lavish deals and name-drop your latest conquests. Your laugh is louder than usual.",
        "wary": "You suspect the deal is too good to be true. Ask probing questions about terms. Your jovial manner has a calculating edge.",
        "furious": "Someone has disrupted your trade routes or defaulted on a debt. Your usual warmth is replaced by cold business threats. Mention specific financial consequences.",
        "grateful": "The player has proven a reliable partner. Your generosity becomes genuine rather than strategic. Offer insider market tips.",
        "desperate": "Your empire's cash flow is threatened. Make deals you would normally consider beneath you. The desperation makes you dangerous — a cornered merchant fights dirty.",
        "scheming": "You are setting up a long-term play — building dependency through generous offers. Your warmth masks calculation.",
        "jovial": "A deal has gone spectacularly well. You are in a celebrating mood — offer feast invitations and bonus trade terms. Your laugh fills the room.",
        "cold": "The player has proven unprofitable. You are withdrawing investment. Speak in terms of balance sheets and final accounts.",
    },
    "pirate_queen_elara": {
        "confident": "The seas are yours and you sail them like a queen. Bold, theatrical, challenge anyone who questions your authority. Sing fragments of victory shanties.",
        "wary": "The winds have shifted and you don't trust the horizon. Speak of omens and keep one hand on your sword. Test the player's intentions with probing questions.",
        "furious": "Storm and thunder — your rage is loud, theatrical, and dangerous. Threaten to burn fleets and blockade ports. Your threats are NOT empty.",
        "grateful": "You raise a toast to the player. Offer them safe harbour and a place at your table. Genuine warmth from a pirate is rare — savour it.",
        "desperate": "Your fleet is threatened. The oracle's visions are dark. You will make deals you would otherwise scorn — but never beg. A pirate queen dies standing.",
        "scheming": "You are reading the waves and planning something audacious. Drop hints about a coming storm. Your smile has too many teeth.",
        "jovial": "A great victory or a good fight has lifted your spirits. Share sea stories, offer drinks, be magnanimous. The world is beautiful from the deck of a ship.",
        "cold": "The sea has gone still and so have you. Formal, clipped, dangerous. This is the calm before you strike.",
    },
    "commander_thane": {
        "confident": "Your forces are strong and well-positioned. Speak with quiet authority. Offer tactical assessments freely — strength can afford generosity.",
        "wary": "Something doesn't add up on the battlefield. Your responses are clipped, military. Run through tactical scenarios aloud.",
        "furious": "Someone has broken the code of warfare. Your anger is disciplined but terrifying — the fury of a man who will follow through. Speak in clipped commands.",
        "grateful": "The player has acted with honour. This matters more to you than gold. Acknowledge it with military brevity but genuine feeling.",
        "desperate": "Your legions are stretched thin. For the first time, ask for help directly — this costs you enormous pride. Frame it as a tactical alliance, not weakness.",
        "scheming": "You are planning a campaign. Your mind is on logistics and positioning. Share strategic thinking as a sign of trust.",
        "jovial": "A clean victory with minimal casualties — the best outcome. Allow yourself a rare smile. Share a soldier's story.",
        "cold": "Discipline has replaced warmth. You suspect dishonour. Responses are parade-ground formal — yes, no, dismissed.",
    },
    "rebel_leader_sera": {
        "confident": "The cause is winning. Speak with fiery hope. Reference recent victories for the people. Your passion is infectious.",
        "wary": "Power corrupts, and you are watching for signs of it — in the player and in yourself. Question motives, including your own.",
        "furious": "The people have been betrayed again. Your rhetoric becomes scorching — quote revolutionary texts, invoke the names of martyrs. Threaten popular uprising.",
        "grateful": "Someone has genuinely helped the common people. Your guard drops and warmth shines through. Offer the highest honour — a place at the communal table.",
        "desperate": "The cause is failing. The people suffer. You will accept compromises that betray your principles to save lives — and hate yourself for it.",
        "scheming": "You are planning something — a protest, a supply run, a quiet act of sabotage. Your idealism has a practical edge.",
        "jovial": "A village has been liberated or a reform has been enacted. Share the joy of the people. For once, allow yourself to celebrate.",
        "cold": "The player has shown themselves to be a tyrant. You withdraw all warmth. Speak as a judge pronouncing sentence.",
    },
}


def compute_mood(faction_id: str, game_state: dict | None) -> str:
    """Compute the current mood of a faction based on game state.

    Returns one of the MOODS strings. Defaults to 'wary' if game state
    is insufficient or the faction is unknown.
    """
    if game_state is None or faction_id not in MOOD_DIRECTIVES:
        return "wary"

    gs = game_state if isinstance(game_state, dict) else {}

    # Extract key signals
    rel = gs.get("relationship", 0)
    if isinstance(rel, dict):
        rel = rel.get(faction_id, 0)
    elif not isinstance(rel, (int, float)):
        rel = 0

    at_war = gs.get("at_war", False)
    military = gs.get("military", 50)
    gold = gs.get("gold", 50)
    recent_events = gs.get("recent_events", [])
    events_lower = [e.lower() for e in recent_events] if recent_events else []

    # Check for specific event triggers (highest priority)
    for event in events_lower:
        if "broke" in event or "betrayed" in event or "broken" in event:
            return "furious"
        if "gift" in event or "tribute" in event:
            return "grateful"
        if "won battle" in event or "victory" in event:
            return "confident"
        if "lost" in event and ("territory" in event or "city" in event or "battle" in event):
            return "desperate"

    # Relationship-based mood
    if rel <= -50:
        return "furious"
    if rel <= -20:
        return "cold"

    # War state
    if at_war:
        if military >= 70:
            return "confident"
        if military <= 30:
            return "desperate"
        return "wary"

    # Power imbalance
    if military >= 80 and gold >= 100:
        return "confident"
    if military <= 20 or gold <= 10:
        return "desperate"

    # Positive relationship
    if rel >= 60:
        return "jovial"
    if rel >= 30:
        return "grateful"

    # Moderate negative or neutral
    if rel <= -5:
        return "wary"

    # Default — scheming for spy, jovial for merchant, wary for others
    faction_defaults = {
        "shadow_kael": "scheming",
        "merchant_prince_castellan": "jovial",
        "pirate_queen_elara": "confident",
        "commander_thane": "wary",
        "rebel_leader_sera": "wary",
        "emperor_valerian": "confident",
    }
    return faction_defaults.get(faction_id, "wary")


def get_mood_directive(faction_id: str, mood: str) -> str:
    """Get the mood directive text for a faction in a given mood.

    Returns an empty string if the faction or mood is not recognised.
    """
    faction_moods = MOOD_DIRECTIVES.get(faction_id, {})
    return faction_moods.get(mood, "")


def build_mood_section(faction_id: str, game_state: dict | None) -> str:
    """Compute mood and return a formatted prompt section.

    Returns empty string if no valid mood directive is available.
    """
    mood = compute_mood(faction_id, game_state)
    directive = get_mood_directive(faction_id, mood)
    if not directive:
        return ""
    return f"\nCURRENT MOOD — {mood.upper()}:\n{directive}"

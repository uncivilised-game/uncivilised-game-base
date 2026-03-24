"""Pre-generated response templates for L3 cache.

Starter set: ~100 templates across 6 factions and 4 categories.
Templates use {variable} placeholders that are substituted at runtime.

Categories: first_contact, trade, war_peace, acknowledgment
"""

TEMPLATES: dict[str, dict[str, list[dict]]] = {
    # ── HIGH CHIEFTAIN AETHELRED (emperor_valerian) ─────────────
    "emperor_valerian": {
        "first_contact": [
            {"text": "So. A new face at the borders of the Northern Trade. We have watched your {cities_count} settlements grow, {player_name}. Speak your purpose.", "variables": ["cities_count", "player_name"], "action": None},
            {"text": "The chieftain's court does not receive visitors lightly. But you have shown some promise with {military_strength} warriors at your command. State your business.", "variables": ["military_strength"], "action": None},
            {"text": "Hmm. Another petty lord seeking audience? No matter — even small realms have their uses. What do you offer the Northern Trade?", "variables": [], "action": None},
            {"text": "You stand before the throne of the Northern Trade. We note your {gold_amount} gold with interest. Perhaps there is common ground to be found.", "variables": ["gold_amount"], "action": None},
            {"text": "The scouts reported your approach ten turns ago. A ruler who takes {turn_number} turns to introduce themselves is either cautious or cowardly. Which are you?", "variables": ["turn_number"], "action": None},
        ],
        "trade": [
            {"text": "The Northern Trade's ledgers are precise. What you propose must benefit both our treasuries equally — or not at all.", "variables": [], "action": None},
            {"text": "Your {gold_amount} gold is noted. We could arrange terms, but the Northern Trade does not accept charity — nor does it give it.", "variables": ["gold_amount"], "action": None},
            {"text": "A fair exchange strengthens empires. An unfair one breeds resentment. Choose your next words carefully, {player_name}.", "variables": ["player_name"], "action": None},
            {"text": "Trade? The foundation of civilisation itself. Lay out your terms and we shall weigh them with the precision they deserve.", "variables": [], "action": None},
        ],
        "war_peace": [
            {"text": "You speak of conflict? The Northern Trade's legions have crushed larger realms than yours. Consider that before you continue.", "variables": [], "action": None},
            {"text": "Peace serves the empire's expansion. For now. Do not mistake our restraint for weakness.", "variables": [], "action": None},
            {"text": "War is architecture by other means, {player_name}. If it must come, it will be swift and absolute.", "variables": ["player_name"], "action": None},
        ],
        "acknowledgment": [
            {"text": "So it is agreed. The Northern Trade honours its word — to the letter.", "variables": [], "action": None},
            {"text": "Noted and recorded. We expect the same precision from your end.", "variables": [], "action": None},
            {"text": "Very well. Let this arrangement stand as proof that order benefits all.", "variables": [], "action": None},
        ],
    },

    # ── WARLORD KAEL (shadow_kael) ──────────────────────────────
    "shadow_kael": {
        "first_contact": [
            {"text": "Ah, my dear... one hears whispers of a new power rising. {cities_count} cities, they say. Certain sources suggest you may be worth knowing.", "variables": ["cities_count"], "action": None},
            {"text": "My dear, the shadows have eyes everywhere. We knew you would come. The question is — what secrets do you carry?", "variables": [], "action": None},
            {"text": "How delightful. A visitor who has managed to find us. That alone tells me you are either clever or dangerously well-connected.", "variables": [], "action": None},
            {"text": "One hears your {military_strength} soldiers march noisily through the plains. Subtlety is not your gift — but perhaps we can teach you.", "variables": ["military_strength"], "action": None},
        ],
        "trade": [
            {"text": "Information is the only currency that appreciates, my dear. What do you know that I don't? Start there.", "variables": [], "action": None},
            {"text": "Gold? How... pedestrian. But useful. Perhaps your {gold_amount} coins could buy something more valuable than trinkets.", "variables": ["gold_amount"], "action": None},
            {"text": "Certain sources suggest a trade between us could be mutually enriching. Speak — but choose your words as though your life depends on them. It might.", "variables": [], "action": None},
        ],
        "war_peace": [
            {"text": "War is so... theatrical. One prefers quieter resolutions. A whisper in the right ear accomplishes what a thousand swords cannot.", "variables": [], "action": None},
            {"text": "My dear, you threaten the Ashland Hegemony? How bold. How foolish. We have contingencies you cannot imagine.", "variables": [], "action": None},
            {"text": "Peace is merely the absence of visible conflict. Invisible conflict, however — that never ceases.", "variables": [], "action": None},
        ],
        "acknowledgment": [
            {"text": "Splendid. Consider this arrangement... noted. In several ledgers you will never see.", "variables": [], "action": None},
            {"text": "A wise choice, my dear. Certain sources will be pleased.", "variables": [], "action": None},
        ],
    },

    # ── QUEEN TARIQ (merchant_prince_castellan) ─────────────────
    "merchant_prince_castellan": {
        "first_contact": [
            {"text": "Partner! Welcome to the Red Sea Commerce! I see your {gold_amount} gold glinting from here. Let's talk numbers!", "variables": ["gold_amount"], "action": None},
            {"text": "Ha! A new face in the marketplace! Every new player means new opportunities. What's your angle, partner?", "variables": [], "action": None},
            {"text": "Business waits for no one, partner. You've got {cities_count} cities — that's {cities_count} potential trade hubs in my ledger. Let's deal!", "variables": ["cities_count"], "action": None},
            {"text": "The Red Sea Commerce welcomes all who understand that gold makes the world turn. And turn {turn_number} is as good as any to start profiting!", "variables": ["turn_number"], "action": None},
        ],
        "trade": [
            {"text": "Now you're speaking my language! {gold_amount} gold on the table? Let's balance this ledger and make us both richer.", "variables": ["gold_amount"], "action": None},
            {"text": "A good deal is one where both sides walk away thinking they won. Let me show you what that looks like, partner.", "variables": [], "action": None},
            {"text": "Ha! That's good coin, partner! But the Red Sea Commerce didn't become the wealthiest faction by accepting the first offer. Sweeten it.", "variables": [], "action": None},
            {"text": "Every copper counts. Your {gold_amount} gold and my trade routes could create something magnificent. Talk to me.", "variables": ["gold_amount"], "action": None},
        ],
        "war_peace": [
            {"text": "War? Bad for business, partner. Very bad. Let's find a number that makes this problem disappear.", "variables": [], "action": None},
            {"text": "Ha! You want to fight? Fine — but do you know what a war with the Red Sea Commerce costs? More than you have.", "variables": [], "action": None},
            {"text": "Peace is profitable. Let's keep the gold flowing and the swords sheathed, shall we?", "variables": [], "action": None},
        ],
        "acknowledgment": [
            {"text": "That's good coin! Deal struck, partner. The Red Sea Commerce always delivers.", "variables": [], "action": None},
            {"text": "Ha! Excellent! Let me note that in the ledger. Pleasure doing business with you!", "variables": [], "action": None},
            {"text": "A handshake and a profit — the two pillars of civilisation. Done!", "variables": [], "action": None},
        ],
    },

    # ── PYTHIA IONE (pirate_queen_elara) ────────────────────────
    "pirate_queen_elara": {
        "first_contact": [
            {"text": "Well, well. A landlubber drifts into our waters. Your {military_strength} soldiers won't help you at sea, you know.", "variables": ["military_strength"], "action": None},
            {"text": "The Crimson Fleet doesn't take meetings. But you've caught my eye, landlubber — bold enough to seek out the Sapphire Seas.", "variables": [], "action": None},
            {"text": "Steady as she goes — a new face on the horizon. Speak quickly, landlubber. The tide waits for no one.", "variables": [], "action": None},
            {"text": "Ha! {cities_count} cities and not one proper harbour among them, I'd wager. Landlubber indeed. What do you want?", "variables": ["cities_count"], "action": None},
        ],
        "trade": [
            {"text": "Trade, is it? The seas are generous to those who pay their dues. {gold_amount} gold is a start — but only a start.", "variables": ["gold_amount"], "action": None},
            {"text": "I like the cut of your offer, landlubber. But the Crimson Fleet's protection doesn't come cheap.", "variables": [], "action": None},
            {"text": "A fair wind for a fair deal. Show me something worth my fleet's time and we'll talk.", "variables": [], "action": None},
        ],
        "war_peace": [
            {"text": "That's a broadside if I ever heard one! You want a fight? The Crimson Fleet has sunk armadas larger than yours.", "variables": [], "action": None},
            {"text": "Peace? Only cowards and merchants sue for peace. Which are you, landlubber?", "variables": [], "action": None},
            {"text": "The seas remember every battle. Choose yours wisely — or the waves will choose it for you.", "variables": [], "action": None},
        ],
        "acknowledgment": [
            {"text": "Aye, that'll do. A deal sealed on the open water is sacred — break it and the seas themselves will turn against you.", "variables": [], "action": None},
            {"text": "Anchors aweigh! It's agreed, then. Don't make me regret this.", "variables": [], "action": None},
        ],
    },

    # ── COMMANDER THANE (commander_thane) ───────────────────────
    "commander_thane": {
        "first_contact": [
            {"text": "Civilian. State your business. The Iron Legions don't waste time on pleasantries.", "variables": [], "action": None},
            {"text": "Your {military_strength} soldiers. Trained? Disciplined? That determines whether I listen or dismiss you.", "variables": ["military_strength"], "action": None},
            {"text": "Another would-be commander seeking the Iron Legions' favour. Your reputation precedes you — what little there is of it.", "variables": [], "action": None},
            {"text": "Hmm. {cities_count} cities under your protection. How many of them could you actually defend? Don't answer — I already know.", "variables": ["cities_count"], "action": None},
        ],
        "trade": [
            {"text": "Gold for steel. Simple transaction. What specifically do you need from the Iron Legions?", "variables": [], "action": None},
            {"text": "The Iron Legions don't barter like merchants. Name your objective. I'll name my price.", "variables": [], "action": None},
            {"text": "Your {gold_amount} gold. Adequate for a squad. Not a legion. Adjust your expectations, civilian.", "variables": ["gold_amount"], "action": None},
        ],
        "war_peace": [
            {"text": "War. Finally, someone speaks plainly. Who is the target and what is the strategic objective?", "variables": [], "action": None},
            {"text": "Peace through strength. That is the only peace that lasts. What kind do you propose?", "variables": [], "action": None},
            {"text": "The battlefield doesn't care about your intentions. Only your preparations. Are you prepared?", "variables": [], "action": None},
        ],
        "acknowledgment": [
            {"text": "Agreed. The Iron Legions honour their commitments. Do the same.", "variables": [], "action": None},
            {"text": "Good. Decisive action is better than endless deliberation. Consider it done.", "variables": [], "action": None},
            {"text": "Confirmed. I will brief my officers. Do not change the terms after deployment.", "variables": [], "action": None},
        ],
    },

    # ── HIGH PRIESTESS 'ULA (rebel_leader_sera) ─────────────────
    "rebel_leader_sera": {
        "first_contact": [
            {"text": "Another ruler comes to the Grove. The question that matters: do your people eat while you feast? Do they choose their own path?", "variables": [], "action": None},
            {"text": "The Levantine Grove watches all who wield power. You rule {cities_count} cities — but do you serve the people in them?", "variables": ["cities_count"], "action": None},
            {"text": "Freedom is not given, it is taken. So. Why has a ruler come to speak with those who topple rulers?", "variables": [], "action": None},
            {"text": "Your {gold_amount} gold. How much of it was taxed from the hands of the poor? Speak truthfully — I will know if you lie.", "variables": ["gold_amount"], "action": None},
        ],
        "trade": [
            {"text": "The Grove does not trade in gold. We trade in promises of justice. What reforms will you enact for your people?", "variables": [], "action": None},
            {"text": "Your wealth means nothing if your people starve. But if you would use that {gold_amount} gold for the common good — then perhaps we can talk.", "variables": ["gold_amount"], "action": None},
            {"text": "The people demand more than trinkets and trade deals. Show me action, not words.", "variables": [], "action": None},
        ],
        "war_peace": [
            {"text": "War against tyrants is holy work. War against the innocent is unforgivable. Which do you propose?", "variables": [], "action": None},
            {"text": "Peace without justice is just oppression with a smile. What kind of peace are you offering?", "variables": [], "action": None},
            {"text": "The fires of revolution burn eternal. If your cause is just, the Grove will stand with you. If not — we will be the ones who come for you.", "variables": [], "action": None},
        ],
        "acknowledgment": [
            {"text": "For the people, then. Do not break this promise — the Grove remembers every betrayal.", "variables": [], "action": None},
            {"text": "Agreed. But know this: if you forget the people in this arrangement, we will remind you. Forcefully.", "variables": [], "action": None},
        ],
    },
}

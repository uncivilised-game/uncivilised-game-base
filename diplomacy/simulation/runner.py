"""Simulation runner — orchestrates mass player simulation.

Spawns N simulated player agents with varied archetypes, runs them
concurrently against the diplomacy API, and collects results for
analysis and training data export.

Usage:
    # Run from command line
    python -m diplomacy.simulation.runner --agents 100 --url http://localhost:8001

    # Or import and run programmatically
    from diplomacy.simulation.runner import run_simulation
    results = await run_simulation(num_agents=100, base_url="http://localhost:8001")
"""

from __future__ import annotations

import argparse
import asyncio
import json
import logging
import random
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import httpx

from diplomacy.simulation.player_agent import (
    PlayerAgent,
    PLAYER_ARCHETYPES,
)

logger = logging.getLogger("diplomacy.simulation.runner")

# ── Archetype distribution (weighted toward realistic usage) ────
ARCHETYPE_WEIGHTS = {
    "diplomatic": 0.25,
    "merchant": 0.15,
    "aggressive": 0.15,
    "roleplayer": 0.15,
    "newbie": 0.15,
    "trickster": 0.10,
    "speedrunner": 0.05,
}

FACTIONS = [
    "emperor_valerian", "shadow_kael", "merchant_prince_castellan",
    "pirate_queen_elara", "commander_thane", "rebel_leader_sera",
]


def _pick_archetype() -> str:
    """Pick a random archetype based on weighted distribution."""
    archetypes = list(ARCHETYPE_WEIGHTS.keys())
    weights = list(ARCHETYPE_WEIGHTS.values())
    return random.choices(archetypes, weights=weights, k=1)[0]


@dataclass
class SimulationResult:
    """Aggregated results from a simulation run."""
    total_agents: int = 0
    total_interactions: int = 0
    successful_interactions: int = 0
    rate_limited: int = 0
    errors: int = 0
    cache_hits: int = 0
    model_usage: dict = None  # {"sonnet": N, "haiku": N, "cache": N}
    archetype_counts: dict = None
    avg_latency_ms: float = 0.0
    duration_seconds: float = 0.0
    interactions: list[dict] = None

    def __post_init__(self):
        if self.model_usage is None:
            self.model_usage = {}
        if self.archetype_counts is None:
            self.archetype_counts = {}
        if self.interactions is None:
            self.interactions = []

    def to_dict(self) -> dict:
        return {
            "total_agents": self.total_agents,
            "total_interactions": self.total_interactions,
            "successful_interactions": self.successful_interactions,
            "rate_limited": self.rate_limited,
            "errors": self.errors,
            "cache_hits": self.cache_hits,
            "cache_hit_rate": round(
                self.cache_hits / max(self.successful_interactions, 1) * 100, 1
            ),
            "model_usage": self.model_usage,
            "archetype_counts": self.archetype_counts,
            "avg_latency_ms": round(self.avg_latency_ms, 1),
            "duration_seconds": round(self.duration_seconds, 1),
            "interactions_per_second": round(
                self.total_interactions / max(self.duration_seconds, 1), 2
            ),
        }


async def _run_agent(
    agent: PlayerAgent,
    semaphore: asyncio.Semaphore,
    client: httpx.AsyncClient,
) -> list[dict]:
    """Run a single agent with concurrency control."""
    async with semaphore:
        logger.info(f"Agent {agent.agent_id} ({agent.archetype}) starting...")
        results = await agent.play_session(client)
        logger.info(
            f"Agent {agent.agent_id} ({agent.archetype}) done — {len(results)} interactions"
        )
        return results


async def run_simulation(
    num_agents: int = 100,
    base_url: str = "http://localhost:8001",
    max_concurrent: int = 20,
    messages_per_faction: int = 5,
    turns_per_game: int = 30,
    output_file: str | None = None,
) -> SimulationResult:
    """Run a full simulation with N agents against the diplomacy API.

    Args:
        num_agents: Number of simulated players
        base_url: URL of the diplomacy API
        max_concurrent: Maximum concurrent agent sessions
        messages_per_faction: Messages each agent sends per faction
        turns_per_game: Number of simulated turns per game
        output_file: Path to save interaction logs (JSONL format)

    Returns:
        SimulationResult with aggregated metrics
    """
    logger.info(
        f"Starting simulation: {num_agents} agents, max {max_concurrent} concurrent"
    )

    start_time = time.time()
    semaphore = asyncio.Semaphore(max_concurrent)

    # Create agents with varied archetypes
    agents = []
    archetype_counts: dict[str, int] = {}
    for i in range(num_agents):
        archetype = _pick_archetype()
        archetype_counts[archetype] = archetype_counts.get(archetype, 0) + 1

        # Each agent talks to 2-4 random factions
        target_factions = random.sample(FACTIONS, k=random.randint(2, 4))

        agent = PlayerAgent(
            archetype=archetype,
            target_factions=target_factions,
            messages_per_faction=messages_per_faction,
            turns_per_game=turns_per_game,
            base_url=base_url,
        )
        agents.append(agent)

    # Run agents concurrently
    async with httpx.AsyncClient() as client:
        tasks = [_run_agent(agent, semaphore, client) for agent in agents]
        all_results = await asyncio.gather(*tasks, return_exceptions=True)

    # Aggregate results
    result = SimulationResult(
        total_agents=num_agents,
        archetype_counts=archetype_counts,
    )

    all_interactions = []
    latencies = []

    for agent_results in all_results:
        if isinstance(agent_results, Exception):
            logger.error(f"Agent failed: {agent_results}")
            result.errors += 1
            continue

        for interaction in agent_results:
            all_interactions.append(interaction)
            result.total_interactions += 1

            if interaction.get("error") == "rate_limited":
                result.rate_limited += 1
            elif "error" in interaction:
                result.errors += 1
            else:
                result.successful_interactions += 1
                if interaction.get("cache_hit"):
                    result.cache_hits += 1
                model = interaction.get("model", "unknown")
                result.model_usage[model] = result.model_usage.get(model, 0) + 1

    result.duration_seconds = time.time() - start_time
    result.interactions = all_interactions

    # Save interactions to file
    if output_file:
        output_path = Path(output_file)
        output_path.parent.mkdir(parents=True, exist_ok=True)
        with open(output_path, "w") as f:
            for interaction in all_interactions:
                f.write(json.dumps(interaction) + "\n")
        logger.info(f"Saved {len(all_interactions)} interactions to {output_file}")

    # Also save summary
    if output_file:
        summary_path = output_path.with_suffix(".summary.json")
        with open(summary_path, "w") as f:
            json.dump(result.to_dict(), f, indent=2)
        logger.info(f"Saved summary to {summary_path}")

    # Log summary
    logger.info(
        f"\n{'='*60}\n"
        f"SIMULATION COMPLETE\n"
        f"{'='*60}\n"
        f"Agents: {result.total_agents}\n"
        f"Total interactions: {result.total_interactions}\n"
        f"Successful: {result.successful_interactions}\n"
        f"Rate limited: {result.rate_limited}\n"
        f"Errors: {result.errors}\n"
        f"Cache hits: {result.cache_hits} "
        f"({result.cache_hits / max(result.successful_interactions, 1) * 100:.1f}%)\n"
        f"Model usage: {result.model_usage}\n"
        f"Duration: {result.duration_seconds:.1f}s\n"
        f"Throughput: {result.total_interactions / max(result.duration_seconds, 1):.1f} interactions/s\n"
        f"{'='*60}"
    )

    return result


def main():
    """CLI entry point for running simulations."""
    parser = argparse.ArgumentParser(
        description="Run simulated players against the diplomacy API"
    )
    parser.add_argument(
        "--agents", "-n", type=int, default=10,
        help="Number of simulated players (default: 10)",
    )
    parser.add_argument(
        "--url", type=str, default="http://localhost:8001",
        help="Base URL of the diplomacy API (default: http://localhost:8001)",
    )
    parser.add_argument(
        "--concurrent", "-c", type=int, default=5,
        help="Max concurrent agents (default: 5)",
    )
    parser.add_argument(
        "--messages", "-m", type=int, default=5,
        help="Messages per faction per agent (default: 5)",
    )
    parser.add_argument(
        "--turns", "-t", type=int, default=30,
        help="Turns per simulated game (default: 30)",
    )
    parser.add_argument(
        "--output", "-o", type=str, default="simulation_results/interactions.jsonl",
        help="Output file for interaction logs (default: simulation_results/interactions.jsonl)",
    )
    parser.add_argument(
        "--verbose", "-v", action="store_true",
        help="Verbose logging",
    )
    args = parser.parse_args()

    logging.basicConfig(
        level=logging.DEBUG if args.verbose else logging.INFO,
        format="%(asctime)s | %(name)s | %(levelname)s | %(message)s",
    )

    result = asyncio.run(
        run_simulation(
            num_agents=args.agents,
            base_url=args.url,
            max_concurrent=args.concurrent,
            messages_per_faction=args.messages,
            turns_per_game=args.turns,
            output_file=args.output,
        )
    )

    print(f"\nResults: {json.dumps(result.to_dict(), indent=2)}")


if __name__ == "__main__":
    main()

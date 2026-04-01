#!/usr/bin/env python3
"""
Release Vote — community-driven devel → main promotion.

Manages GitHub issues where players vote (👍/👎 reactions) to deploy
staging (devel) to production (main). When the vote threshold is met,
a PR is created from devel → main.

Usage (via GitHub Actions):
  ACTION=check  VOTE_THRESHOLD=3  python3 scripts/release-vote.py
  ACTION=create VOTE_THRESHOLD=3  python3 scripts/release-vote.py

Environment variables:
  GH_TOKEN          GitHub token with repo scope
  REPO              owner/repo (e.g. uncivilised-game/uncivilised-game-base)
  ACTION            "check" (default) or "create"
  VOTE_THRESHOLD    Minimum net upvotes to trigger merge (default: 3)
"""

import json
import os
import subprocess
import sys
from datetime import datetime, timezone


REPO = os.environ["REPO"]
GH_TOKEN = os.environ["GH_TOKEN"]
THRESHOLD = int(os.environ.get("VOTE_THRESHOLD", "3"))
ACTION = os.environ.get("ACTION", "check")
LABEL = "release-vote"


def gh(*args, parse_json=True):
    """Run a gh CLI command and return parsed JSON or raw text."""
    cmd = ["gh"] + list(args)
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        print(f"gh command failed: {' '.join(cmd)}", file=sys.stderr)
        print(result.stderr, file=sys.stderr)
        return None
    if not result.stdout.strip():
        return [] if parse_json else ""
    if parse_json:
        return json.loads(result.stdout)
    return result.stdout.strip()


def git(*args):
    """Run a git command and return stdout."""
    result = subprocess.run(["git"] + list(args), capture_output=True, text=True)
    return result.stdout.strip()


def get_open_vote_issue():
    """Find an existing open release-vote issue."""
    issues = gh("issue", "list", "--repo", REPO,
                "--label", LABEL, "--state", "open",
                "--json", "number,title,createdAt", "--limit", "1")
    if issues:
        return issues[0]
    return None


def devel_ahead_of_main():
    """Check if devel has commits ahead of main."""
    log = git("log", "origin/main..origin/devel", "--oneline")
    return bool(log.strip())


def get_changelog():
    """Generate a changelog of commits on devel since main."""
    # Get merged PRs via commit log
    log = git("log", "origin/main..origin/devel", "--oneline", "--no-merges")
    if not log:
        return "No changes since last release."

    lines = log.strip().split("\n")

    # Also try to find merged PR numbers from merge commits
    merge_log = git("log", "origin/main..origin/devel", "--merges",
                     "--pretty=format:%s")
    pr_numbers = []
    if merge_log:
        import re
        for line in merge_log.strip().split("\n"):
            match = re.search(r"#(\d+)", line)
            if match:
                pr_numbers.append(int(match.group(1)))

    changelog = []

    # List PRs if we found them
    if pr_numbers:
        for num in pr_numbers:
            pr_info = gh("pr", "view", str(num), "--repo", REPO,
                        "--json", "title,number,author")
            if pr_info:
                author = pr_info.get("author", {}).get("login", "unknown")
                changelog.append(f"- #{pr_info['number']} {pr_info['title']} (@{author})")

    # If no PRs found, fall back to commit messages
    if not changelog:
        for line in lines[:20]:  # Cap at 20 entries
            changelog.append(f"- {line}")
        if len(lines) > 20:
            changelog.append(f"- ... and {len(lines) - 20} more commits")

    return "\n".join(changelog)


def get_reactions(issue_number):
    """Fetch reactions on an issue and return (thumbs_up, thumbs_down) counts."""
    reactions = gh("api", f"repos/{REPO}/issues/{issue_number}/reactions",
                   "--paginate", "--jq", ".[].content")
    if reactions is None:
        return 0, 0

    # gh --jq returns newline-separated values
    if isinstance(reactions, str):
        items = reactions.strip().split("\n") if reactions.strip() else []
    elif isinstance(reactions, list):
        items = [r.get("content", "") for r in reactions]
    else:
        return 0, 0

    thumbs_up = sum(1 for r in items if r == "+1")
    thumbs_down = sum(1 for r in items if r == "-1")
    return thumbs_up, thumbs_down


def create_vote_issue():
    """Create a new release vote issue with changelog."""
    if not devel_ahead_of_main():
        print("devel is not ahead of main — nothing to release.")
        return None

    changelog = get_changelog()
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    commit_count = git("rev-list", "--count", "origin/main..origin/devel")

    title = f"Release Vote: Deploy to Production ({today})"
    body = f"""## Release Candidate

**{commit_count} commits** on `devel` are ready for production release.

### What's in this release

{changelog}

### Test it

Play-test the staging build before voting: **https://staging.uncivilized.fun**

### How to vote

- React with **👍** to approve this release for production
- React with **👎** if you've found issues on staging that should block the release

**Threshold:** {THRESHOLD} net upvotes (👍 minus 👎) to trigger the production deploy.

Once the threshold is met, a PR from `devel` → `main` will be created automatically
and merged to deploy to production.

---
*This issue was created automatically by the release-vote workflow.*
*Vote closes when the threshold is reached or a maintainer closes the issue.*"""

    result = gh("issue", "create", "--repo", REPO,
                "--title", title,
                "--body", body,
                "--label", LABEL,
                parse_json=False)
    if result:
        print(f"Created vote issue: {result}")
    return result


def tally_and_merge(issue):
    """Tally votes on an existing issue and create devel→main PR if threshold met."""
    issue_number = issue["number"]
    thumbs_up, thumbs_down = get_reactions(issue_number)
    net = thumbs_up - thumbs_down

    print(f"Vote tally for #{issue_number}: 👍 {thumbs_up} / 👎 {thumbs_down} (net: {net}, threshold: {THRESHOLD})")

    if net < THRESHOLD:
        print(f"Threshold not met ({net} < {THRESHOLD}). No action taken.")
        # Post status update comment
        gh("issue", "comment", str(issue_number), "--repo", REPO,
           "--body", f"**Vote status:** 👍 {thumbs_up} / 👎 {thumbs_down} (net: {net}). "
                     f"Need {THRESHOLD - net} more net upvotes to deploy.",
           parse_json=False)
        return

    print(f"Threshold met! Creating devel → main PR...")

    # Check if a release PR already exists
    existing_prs = gh("pr", "list", "--repo", REPO,
                       "--head", "devel", "--base", "main",
                       "--state", "open", "--json", "number")
    if existing_prs:
        print(f"Release PR already exists: #{existing_prs[0]['number']}")
        gh("issue", "comment", str(issue_number), "--repo", REPO,
           "--body", f"**Vote passed!** 👍 {thumbs_up} / 👎 {thumbs_down} (net: {net})\n\n"
                     f"Release PR already exists: #{existing_prs[0]['number']}",
           parse_json=False)
        return

    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    pr_body = (
        f"## Production Release ({today})\n\n"
        f"Community vote passed on #{issue_number}: "
        f"👍 {thumbs_up} / 👎 {thumbs_down} (net: {net}, threshold: {THRESHOLD})\n\n"
        f"This PR merges `devel` into `main` to trigger a production deployment.\n\n"
        f"Closes #{issue_number}"
    )

    pr_result = gh("pr", "create", "--repo", REPO,
                    "--base", "main", "--head", "devel",
                    "--title", f"Release: Deploy to Production ({today})",
                    "--body", pr_body,
                    parse_json=False)

    if pr_result:
        print(f"Created release PR: {pr_result}")
        gh("issue", "comment", str(issue_number), "--repo", REPO,
           "--body", f"**Vote passed!** 👍 {thumbs_up} / 👎 {thumbs_down} (net: {net})\n\n"
                     f"Release PR created: {pr_result}\n\n"
                     f"A maintainer can now merge to deploy to production.",
           parse_json=False)
    else:
        print("Failed to create release PR", file=sys.stderr)


def main():
    print(f"Release vote script — action={ACTION}, threshold={THRESHOLD}")

    existing = get_open_vote_issue()

    if ACTION == "create":
        if existing:
            print(f"Closing existing vote issue #{existing['number']} before creating new one")
            gh("issue", "close", str(existing["number"]), "--repo", REPO,
               "--comment", "Superseded by a new release vote.",
               parse_json=False)
        create_vote_issue()
        return

    # ACTION == "check" (default, used by schedule)
    if existing:
        print(f"Found open vote issue #{existing['number']}: {existing['title']}")
        tally_and_merge(existing)
    else:
        print("No open vote issue found. Checking if devel is ahead of main...")
        result = create_vote_issue()
        if result is None:
            print("Nothing to do — devel and main are in sync.")


if __name__ == "__main__":
    main()

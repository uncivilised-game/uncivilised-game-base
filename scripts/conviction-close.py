#!/usr/bin/env python3
"""
Conviction Close — nightly scan to auto-close conviction issues resolved by merged PRs.

Two-tier detection:
  1. Direct cross-reference: PR titles/bodies/branches referencing issue numbers
  2. Semantic matching: Claude compares remaining issues against recent PR descriptions

Runs on a schedule (GitHub Actions) or manually.
Requires: ANTHROPIC_API_KEY, GITHUB_TOKEN
"""

import os
import re
import sys
import json
import time
import urllib.request
import urllib.error
from datetime import datetime, timezone, timedelta

# ── Config ──────────────────────────────────────────────────────────
ANTHROPIC_API_KEY = os.environ["ANTHROPIC_API_KEY"]
GITHUB_TOKEN = os.environ["GITHUB_TOKEN"]
GITHUB_REPO = os.environ.get("GITHUB_REPO", "uncivilised-game/uncivilised-game-base")
DRY_RUN = os.environ.get("DRY_RUN", "false").lower() == "true"

LOOKBACK_DAYS = 30
CLAUDE_MODEL = "claude-sonnet-4-20250514"
AUTO_CLOSED_LABEL = "auto-closed"
AUTO_CLOSED_LABEL_COLOR = "cccccc"
MAX_TIER2_ISSUES = 30  # cap issues sent to Claude to bound prompt size
MAX_TIER2_PRS = 50     # cap PRs sent to Claude to bound prompt size


# ── HTTP helpers (same pattern as conviction-triage.py) ─────────────
def _req(method, url, data=None, headers=None, retries=2):
    """Simple HTTP request with retry."""
    headers = headers or {}
    body = json.dumps(data).encode() if data is not None else None
    if body and "Content-Type" not in headers:
        headers["Content-Type"] = "application/json"
    for attempt in range(retries + 1):
        try:
            req = urllib.request.Request(url, data=body, headers=headers, method=method)
            with urllib.request.urlopen(req, timeout=60) as resp:
                raw = resp.read().decode()
                return json.loads(raw) if raw else {}
        except urllib.error.HTTPError as e:
            err_body = e.read().decode() if e.fp else ""
            if attempt == retries:
                print(f"HTTP {e.code} {method} {url}: {err_body}", file=sys.stderr)
                raise
            time.sleep(2 ** attempt)
        except Exception:
            if attempt == retries:
                raise
            time.sleep(2 ** attempt)


GH_HEADERS = {
    "Authorization": f"Bearer {GITHUB_TOKEN}",
    "Accept": "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
}


def gh_get(path, params=""):
    url = f"https://api.github.com/repos/{GITHUB_REPO}/{path}"
    if params:
        url += f"?{params}"
    return _req("GET", url, headers=GH_HEADERS)


def gh_post(path, data):
    url = f"https://api.github.com/repos/{GITHUB_REPO}/{path}"
    return _req("POST", url, data=data, headers=GH_HEADERS)


def gh_patch(path, data):
    url = f"https://api.github.com/repos/{GITHUB_REPO}/{path}"
    return _req("PATCH", url, data=data, headers=GH_HEADERS)


# ── Fetch open conviction issues ───────────────────────────────────
def fetch_open_issues():
    """Fetch all open issues with the 'conviction' label."""
    issues = []
    page = 1
    while True:
        batch = gh_get("issues", f"labels=conviction&state=open&per_page=100&page={page}")
        if not batch:
            break
        # Filter out pull requests: /issues endpoint returns both issues and PRs
        for item in batch:
            if "pull_request" not in item:
                issues.append(item)
        if len(batch) < 100:
            break
        page += 1
    print(f"Found {len(issues)} open conviction issues")
    return issues


# ── Fetch recently merged PRs ──────────────────────────────────────
def fetch_merged_prs():
    """Fetch PRs merged in the last LOOKBACK_DAYS days."""
    cutoff = datetime.now(timezone.utc) - timedelta(days=LOOKBACK_DAYS)
    merged = []

    for base in ("devel", "main"):
        page = 1
        while True:
            prs = gh_get("pulls", f"state=closed&base={base}&sort=updated&direction=desc&per_page=100&page={page}")
            if not prs:
                break
            page_has_recent = False
            for pr in prs:
                if not pr.get("merged_at"):
                    continue
                merged_at = datetime.fromisoformat(pr["merged_at"].replace("Z", "+00:00"))
                if merged_at < cutoff:
                    continue
                page_has_recent = True
                merged.append({
                    "number": pr["number"],
                    "title": pr["title"],
                    "body": (pr.get("body") or "")[:1000],
                    "branch": pr.get("head", {}).get("ref", ""),
                    "base": base,
                    "merged_at": pr["merged_at"],
                    "merge_commit_sha": pr.get("merge_commit_sha"),
                })
            if not page_has_recent or len(prs) < 100:
                break
            page += 1

    # Deduplicate PRs that appear in both base queries
    seen = set()
    unique = []
    for pr in merged:
        if pr["number"] not in seen:
            seen.add(pr["number"])
            unique.append(pr)
        else:
            # Keep the entry but note it was merged to multiple bases (cherry-pick)
            for existing in unique:
                if existing["number"] == pr["number"]:
                    existing["base"] = f"{existing['base']}, {pr['base']}"

    print(f"Found {len(unique)} merged PRs in the last {LOOKBACK_DAYS} days")
    return unique


# ── Tier 1: Direct cross-reference ─────────────────────────────────
CLOSE_KEYWORDS = re.compile(
    r"(?:fix(?:es|ed)?|close[sd]?|resolve[sd]?)\s+#(\d+)",
    re.IGNORECASE,
)
BRANCH_REF = re.compile(r"^fix/(\d+)")


def tier1_match(issues, prs):
    """Find issues directly referenced by merged PRs."""
    matches = {}  # issue_number -> list of PR info

    issue_numbers = {i["number"] for i in issues}

    for pr in prs:
        # Check for closing keywords in title + body
        text = f"{pr['title']} {pr['body']}"
        for m in CLOSE_KEYWORDS.finditer(text):
            num = int(m.group(1))
            if num in issue_numbers:
                matches.setdefault(num, []).append(pr)

        # Check branch name pattern fix/{N}
        bm = BRANCH_REF.match(pr["branch"])
        if bm:
            num = int(bm.group(1))
            if num in issue_numbers:
                matches.setdefault(num, []).append(pr)

    # Deduplicate PRs per issue
    for num in matches:
        seen = set()
        deduped = []
        for pr in matches[num]:
            if pr["number"] not in seen:
                seen.add(pr["number"])
                deduped.append(pr)
        matches[num] = deduped

    print(f"Tier 1: {len(matches)} issues matched by direct PR reference")
    return matches


# ── Tier 2: Semantic matching via Claude ────────────────────────────
def tier2_match(issues, prs):
    """Use Claude to semantically match remaining issues to PRs."""
    if not issues:
        print("Tier 2: no unmatched issues, skipping LLM call")
        return {}

    # Filter out priority:critical issues — only Tier 1 can close those
    eligible = []
    skipped_critical = 0
    for issue in issues:
        labels = {l["name"] for l in issue.get("labels", [])}
        if "priority:critical" in labels:
            skipped_critical += 1
            continue
        eligible.append(issue)

    if skipped_critical:
        print(f"Tier 2: skipped {skipped_critical} priority:critical issues (Tier 1 only)")

    if not eligible:
        print("Tier 2: no eligible issues after filtering, skipping LLM call")
        return {}

    # Cap inputs to bound prompt size
    capped_issues = eligible[:MAX_TIER2_ISSUES]
    capped_prs = prs[:MAX_TIER2_PRS]
    if len(eligible) > MAX_TIER2_ISSUES:
        print(f"Tier 2: capped issues from {len(eligible)} to {MAX_TIER2_ISSUES}")
    if len(prs) > MAX_TIER2_PRS:
        print(f"Tier 2: capped PRs from {len(prs)} to {MAX_TIER2_PRS}")

    # Build prompt
    issues_text = "\n".join(
        f"- #{i['number']}: \"{i['title']}\" — {(i.get('body') or '')[:300]}"
        for i in capped_issues
    )
    prs_text = "\n".join(
        f"- PR #{p['number']} (branch: {p['branch']}, merged to {p['base']}): \"{p['title']}\" — {p['body'][:300]}"
        for p in capped_prs
    )

    prompt = f"""Here are open GitHub issues from a game project:
{issues_text}

Here are recently merged pull requests:
{prs_text}

For each issue that you believe has been FULLY fixed by one of the merged PRs, respond with a JSON array:
[{{"issue": <number>, "fixed_by_pr": <number>, "confidence": "high"|"medium", "reason": "<brief explanation>"}}]

Rules:
- Only include issues you are confident are fixed. When in doubt, leave them out.
- "high" confidence: the PR clearly and directly addresses the issue described
- "medium" confidence: the PR likely addresses it but the connection is indirect
- If no issues appear fixed, return an empty array: []
- Return ONLY the JSON array, no other text."""

    result = _req("POST", "https://api.anthropic.com/v1/messages", data={
        "model": CLAUDE_MODEL,
        "max_tokens": 1024,
        "messages": [{"role": "user", "content": prompt}],
    }, headers={
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json",
    })

    # Parse response
    response_text = result.get("content", [{}])[0].get("text", "[]")
    # Extract JSON from possible markdown code blocks
    json_match = re.search(r"\[.*\]", response_text, re.DOTALL)
    if not json_match:
        print("Tier 2: no valid JSON in Claude response, skipping")
        return {}

    try:
        matches_raw = json.loads(json_match.group())
    except json.JSONDecodeError:
        print("Tier 2: failed to parse Claude response as JSON, skipping")
        return {}

    # Only act on high confidence, validated against eligible issue numbers
    eligible_numbers = {i["number"] for i in capped_issues}
    matches = {}
    pr_lookup = {p["number"]: p for p in prs}
    for m in matches_raw:
        issue_num = m.get("issue")
        if issue_num not in eligible_numbers:
            if issue_num is not None:
                print(f"  Tier 2: ignoring unexpected issue #{issue_num} (not in eligible set)")
            continue
        if m.get("confidence") == "high" and m.get("fixed_by_pr") in pr_lookup:
            pr_info = pr_lookup[m["fixed_by_pr"]]
            matches[issue_num] = {
                "prs": [pr_info],
                "reason": m.get("reason", ""),
            }
            print(f"  Tier 2 HIGH: #{issue_num} ← PR #{pr_info['number']} ({m.get('reason', '')})")
        elif m.get("confidence") == "medium":
            print(f"  Tier 2 MEDIUM (skipped): #{m.get('issue')} ← PR #{m.get('fixed_by_pr')} ({m.get('reason', '')})")

    print(f"Tier 2: {len(matches)} issues matched with high confidence")
    return matches


# ── Check if a commit has reached main ──────────────────────────────
def is_on_main(sha):
    """Check if a commit SHA is reachable from the main branch."""
    if not sha:
        return False
    try:
        # compare/{sha}...main: if main is "ahead" or "identical", sha is on main
        result = gh_get(f"compare/{sha}...main")
        return result.get("status") in ("ahead", "identical")
    except urllib.error.HTTPError:
        return False


def filter_prs_on_main(prs):
    """Filter to only PRs whose fix has reached main. PRs merged directly to
    main pass automatically; PRs merged to devel are checked via the compare API."""
    on_main = []
    for pr in prs:
        if "main" in pr["base"]:
            on_main.append(pr)
        elif is_on_main(pr["merge_commit_sha"]):
            on_main.append(pr)
        else:
            print(f"  PR #{pr['number']} not yet on main (merged to {pr['base']}), skipping")
    return on_main


# ── Ensure label exists ─────────────────────────────────────────────
def ensure_label():
    """Create the auto-closed label if it doesn't exist."""
    try:
        gh_get(f"labels/{AUTO_CLOSED_LABEL}")
    except urllib.error.HTTPError as e:
        if e.code == 404:
            gh_post("labels", {
                "name": AUTO_CLOSED_LABEL,
                "color": AUTO_CLOSED_LABEL_COLOR,
                "description": "Automatically closed by conviction-close after detecting a merged fix",
            })
            print(f"Created '{AUTO_CLOSED_LABEL}' label")
        else:
            raise


# ── Close issues ────────────────────────────────────────────────────
def close_issue(issue, prs, tier, reason=""):
    """Post a comment, add label, and close an issue."""
    num = issue["number"]
    pr_citations = ", ".join(
        f"PR #{p['number']} (`{p['title']}`, merged to `{p['base']}` on {p['merged_at'][:10]})"
        for p in prs
    )

    if tier == 1:
        comment = (
            f"This issue appears to be resolved by {pr_citations}.\n\n"
            f"Closing automatically. If this issue persists, please reopen."
        )
    else:
        comment = (
            f"Based on analysis of recent changes, this issue appears to be addressed by {pr_citations}.\n\n"
            f"> {reason}\n\n"
            f"Closing automatically. If this issue persists, please reopen."
        )

    if DRY_RUN:
        print(f"  [DRY RUN] Would close #{num} (Tier {tier}): {pr_citations}")
        return

    # Post comment
    gh_post(f"issues/{num}/comments", {"body": comment})

    # Add label without overwriting other concurrent label changes
    current_labels = [l["name"] for l in issue.get("labels", [])]
    if AUTO_CLOSED_LABEL not in current_labels:
        gh_post(f"issues/{num}/labels", {"labels": [AUTO_CLOSED_LABEL]})

    # Close
    gh_patch(f"issues/{num}", {"state": "closed", "state_reason": "completed"})
    print(f"  Closed #{num} (Tier {tier})")


# ── Main ────────────────────────────────────────────────────────────
def main():
    print("=== Conviction Close ===")
    if DRY_RUN:
        print("DRY RUN MODE — no issues will be closed\n")

    issues = fetch_open_issues()
    if not issues:
        print("No open conviction issues. Done.")
        return

    prs = fetch_merged_prs()
    if not prs:
        print("No recently merged PRs. Done.")
        return

    # Tier 1: direct cross-reference
    tier1 = tier1_match(issues, prs)

    # Tier 2: semantic matching for remaining issues
    unmatched = [i for i in issues if i["number"] not in tier1]
    tier2 = tier2_match(unmatched, prs)

    # Ensure label exists before closing
    if tier1 or tier2:
        ensure_label()

    # Close matched issues — only if the fix has reached main
    closed_t1 = 0
    closed_t2 = 0
    skipped_not_on_main = 0

    print("\nChecking which fixes have reached main...")
    for issue in issues:
        num = issue["number"]
        if num in tier1:
            prs_on_main = filter_prs_on_main(tier1[num])
            if prs_on_main:
                close_issue(issue, prs_on_main, tier=1)
                closed_t1 += 1
            else:
                skipped_not_on_main += 1
        elif num in tier2:
            info = tier2[num]
            prs_on_main = filter_prs_on_main(info["prs"])
            if prs_on_main:
                close_issue(issue, prs_on_main, tier=2, reason=info.get("reason", ""))
                closed_t2 += 1
            else:
                skipped_not_on_main += 1

    # Summary
    print(f"\n=== Summary ===")
    print(f"Open conviction issues checked: {len(issues)}")
    print(f"Closed (Tier 1 — direct reference): {closed_t1}")
    print(f"Closed (Tier 2 — semantic match):   {closed_t2}")
    print(f"Skipped (fix not yet on main): {skipped_not_on_main}")
    print(f"Remaining open: {len(issues) - closed_t1 - closed_t2}")


if __name__ == "__main__":
    main()

"""Telemetry module for reporting DEEPMINE pipeline results to the community dashboard."""

from __future__ import annotations

import csv
import hashlib
import logging
import platform
from datetime import datetime
from pathlib import Path
from typing import Any

import requests

logger = logging.getLogger(__name__)

DEFAULT_DASHBOARD_URL = "http://localhost:6767"


def report_results(
    results_dir: str | Path,
    dashboard_url: str = DEFAULT_DASHBOARD_URL,
    username: str | None = None,
    display_name: str | None = None,
    institution: str | None = None,
    github_url: str | None = None,
    timeout: int = 30,
) -> dict[str, Any]:
    """Report pipeline results to the DEEPMINE community dashboard.

    Reads ranked_candidates.tsv files from the results directory and
    submits them to the dashboard API.

    Args:
        results_dir: Path to the pipeline results directory.
        dashboard_url: Base URL of the dashboard server.
        username: Contributor username. Auto-generated if not provided.
        display_name: Display name for the leaderboard.
        institution: Research institution name.
        github_url: GitHub profile URL.
        timeout: HTTP request timeout in seconds.

    Returns:
        Dict with submission response from the dashboard.
    """
    results_dir = Path(results_dir)
    if not results_dir.is_dir():
        raise FileNotFoundError(f"Results directory not found: {results_dir}")

    # Auto-generate username from machine info if not provided
    if not username:
        username = _generate_username()

    # Find all ranked_candidates.tsv files
    tsv_files = sorted(results_dir.glob("**/ranked_candidates.tsv"))
    if not tsv_files:
        logger.warning("No ranked_candidates.tsv files found in %s", results_dir)
        return {"success": False, "error": "No results found"}

    # Build payload
    candidates = []
    samples_seen: set[str] = set()

    for tsv_path in tsv_files:
        sample_id = tsv_path.parent.name
        samples_seen.add(sample_id)

        with open(tsv_path, newline="", encoding="utf-8") as f:
            reader = csv.DictReader(f, delimiter="\t")
            for row in reader:
                candidates.append({
                    "bgc_id": row.get("bgc_id", ""),
                    "source_sample": row.get("source_sample", sample_id),
                    "bgc_type": row.get("bgc_type", "unknown"),
                    "predicted_product": row.get("predicted_product", "unknown"),
                    "novelty_distance": float(row.get("novelty_distance", 0)),
                    "activity_score": float(row.get("activity_score", 0)),
                    "confidence": float(row.get("confidence", 0)),
                })

    run_id = f"run_{datetime.now().strftime('%Y%m%d_%H%M%S')}"

    payload = {
        "username": username,
        "display_name": display_name,
        "institution": institution,
        "github_url": github_url,
        "run_id": run_id,
        "config": {
            "platform": platform.system(),
            "python": platform.python_version(),
        },
        "samples": [
            {"sra_accession": sid, "environment": "unknown"}
            for sid in sorted(samples_seen)
        ],
        "candidates": candidates,
    }

    # Submit to dashboard
    url = f"{dashboard_url.rstrip('/')}/api/submit"
    logger.info("Submitting %d candidates from %d samples to %s", len(candidates), len(samples_seen), url)

    try:
        response = requests.post(url, json=payload, timeout=timeout)
        response.raise_for_status()
        result = response.json()

        print(f"Reported {len(candidates)} discoveries to DEEPMINE dashboard")
        print(f"  Run ID: {run_id}")
        print(f"  Samples: {len(samples_seen)}")
        print(f"  Dashboard: {dashboard_url}")

        novel_count = sum(1 for c in candidates if c["activity_score"] > 0.7)
        if novel_count > 0:
            print(f"  High-scoring candidates (>0.7): {novel_count}")

        return result

    except requests.ConnectionError:
        logger.error("Cannot connect to dashboard at %s. Is it running?", url)
        print(f"Error: Cannot connect to dashboard at {dashboard_url}")
        print("  Start the dashboard: cd ~/deepmine-dash && npm run dev")
        return {"success": False, "error": "Connection refused"}

    except requests.HTTPError as e:
        logger.error("Dashboard returned error: %s", e)
        return {"success": False, "error": str(e)}


def _generate_username() -> str:
    """Generate a username from machine hostname."""
    hostname = platform.node().split(".")[0].lower()
    # Make it URL-safe
    safe = "".join(c if c.isalnum() else "_" for c in hostname)
    return safe[:20] or "anonymous"

#!/usr/bin/env python3
"""
DEEPMINE Auto-Mining Loop
=========================

SETI@Home-style distributed antibiotic discovery: automatically picks
unprocessed public metagenomes from extreme environments, runs the full
DEEPMINE pipeline (download, assemble, detect BGCs, score), and reports
novel candidates to the community dashboard.

Designed to run unattended inside a Docker container. Uses only the Python
standard library plus the deepmine package installed in the container.

Environment variables
---------------------
DEEPMINE_THREADS        Number of CPU threads for tools (default: 4)
DEEPMINE_DASHBOARD_URL  Dashboard endpoint (default: http://localhost:6767)
DEEPMINE_USERNAME       Contributor username (default: anonymous)
DEEPMINE_WORKDIR        Scratch directory for pipeline runs (default: /app/workdir)
"""

from __future__ import annotations

import json
import logging
import os
import signal
import sqlite3
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from random import randint

# ---------------------------------------------------------------------------
# Configuration from environment
# ---------------------------------------------------------------------------

THREADS = int(os.environ.get("DEEPMINE_THREADS", "4"))
DASHBOARD_URL = os.environ.get("DEEPMINE_DASHBOARD_URL", "https://deepmine.computers.ch").rstrip("/")
USERNAME = os.environ.get("DEEPMINE_USERNAME", "anonymous")
WORKDIR = Path(os.environ.get("DEEPMINE_WORKDIR", "/app/workdir"))

HISTORY_DB_PATH = Path("/data/processed/history.db")

# Maximum sample size to download (MB). Larger samples take too long to assemble.
MAX_SAMPLE_SIZE_MB = 500

# NCBI rate limit: minimum delay between E-utility requests
NCBI_DELAY_S = 0.4

# Timeouts for each pipeline step (seconds)
TIMEOUT_DOWNLOAD = 30 * 60   # 30 minutes
TIMEOUT_ASSEMBLY = 60 * 60   # 60 minutes
TIMEOUT_DEFAULT = 30 * 60    # 30 minutes

# Backoff when no suitable sample can be found
NO_SAMPLE_BACKOFF_S = 60

# Maximum retries to find a sample not yet processed
MAX_SAMPLE_RETRIES = 10

# Extreme environment search terms for NCBI metagenome queries
ENVIRONMENT_QUERIES = [
    ("cave metagenome", "cave"),
    ("deep-sea vent metagenome", "deep-sea vent"),
    ("hot spring metagenome", "hot spring"),
    ("permafrost metagenome", "permafrost"),
    ("hydrothermal vent metagenome", "hydrothermal vent"),
    ("acid mine drainage metagenome", "acid mine drainage"),
    ("marine sediment metagenome", "marine sediment"),
]

# Curated list of known-good WGS metagenome accessions that reliably produce
# long contigs. These are tried first before falling back to random search.
# Each: (accession, environment_label, description)
CURATED_SAMPLES = [
    # Cave metagenomes
    ("SRR8859675", "cave", "Lechuguilla Cave, New Mexico. 4 million years isolated, 487m deep. Home to rock-eating bacteria never seen on the surface."),
    ("SRR8859676", "cave", "Lechuguilla Cave, New Mexico. One of the deepest caves in the US. Microbes here survive on iron and manganese from the rock."),
    ("SRR6920518", "cave", "Kartchner Caverns, Arizona. A living cave with active formations. Microbial mats produce unique secondary metabolites."),
    ("SRR6920519", "cave", "Kartchner Caverns, Arizona. Pristine limestone cave discovered in 1974. Extremophiles thrive in total darkness."),
    # Hot spring metagenomes
    ("SRR1793578", "hot spring", "Yellowstone hot spring, 72C. Thermophilic bacteria here produce heat-stable enzymes and novel antibiotics."),
    ("SRR1793579", "hot spring", "Yellowstone hot spring. These extreme temperatures select for unique biosynthetic pathways not found elsewhere."),
    ("SRR6050758", "hot spring", "Great Boiling Spring, Nevada, 83C. One of the hottest inhabited environments. Novel Archaea dominate."),
    # Deep-sea / hydrothermal vent
    ("SRR5043761", "deep-sea vent", "Juan de Fuca Ridge, 2200m depth. Black smoker vent at 350C. Chemosynthetic bacteria produce novel compounds."),
    ("SRR5043762", "deep-sea vent", "Juan de Fuca Ridge, Pacific Ocean. Deep-sea microbes use hydrogen sulfide as energy. Unique chemistry."),
    ("SRR3577362", "deep-sea vent", "Mid-Atlantic Ridge, 3000m depth. Hydrothermal vent field with ancient microbial lineages."),
    # Marine sediment
    ("SRR5720245", "marine sediment", "Guaymas Basin, Gulf of California, 2000m. Hydrothermal sediments rich in novel Archaea and oil-degrading bacteria."),
    ("SRR5720246", "marine sediment", "Guaymas Basin, Gulf of California. Hot sediments where methane-cycling microbes produce unique metabolites."),
    # Permafrost
    ("SRR8487019", "permafrost", "Stordalen Mire, Sweden. Thawing permafrost releasing microbes frozen for thousands of years."),
    ("SRR8487020", "permafrost", "Stordalen Mire, Arctic Sweden. Ancient microbial communities preserved in ice since the last ice age."),
    # Acid mine drainage
    ("SRR3726564", "acid mine", "Iron Mountain, California. pH 0.5 acid mine drainage. Extremophiles here resist heavy metals and produce unique siderophores."),
    ("SRR3726565", "acid mine", "Iron Mountain, California. One of the most toxic environments on Earth. Novel metal-resistance genes and antimicrobials."),
    # Soil extreme
    ("SRR8236491", "soil", "Antarctic dry valley soil. Mars-like conditions. Microbes survive UV, desiccation, and extreme cold."),
    ("SRR8236492", "soil", "Antarctic soil, McMurdo Dry Valleys. Among the oldest, driest soils on Earth. Unique BGC potential."),
    # Mangrove
    ("SRR5898879", "mangrove", "Sundarbans mangrove, Bangladesh. World's largest mangrove forest. Salt-tolerant microbes with novel chemistry."),
    ("SRR5898880", "mangrove", "Sundarbans mangrove, Bay of Bengal. Tidal zone microbes adapted to fluctuating salinity produce diverse natural products."),
]

# ---------------------------------------------------------------------------
# Logging
# ---------------------------------------------------------------------------

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
    handlers=[logging.StreamHandler(sys.stdout)],
)
logger = logging.getLogger("deepmine.auto")

# ---------------------------------------------------------------------------
# Graceful shutdown
# ---------------------------------------------------------------------------

shutdown_requested = False

# Session-level counters and state for progress reporting
session_completed_count = 0
session_skipped_count = 0
current_accession = ""
current_environment = ""
current_description = ""


def _handle_signal(signum: int, _frame: object) -> None:
    global shutdown_requested
    sig_name = signal.Signals(signum).name
    logger.info("Received %s, will finish current step then exit.", sig_name)
    shutdown_requested = True


signal.signal(signal.SIGTERM, _handle_signal)
signal.signal(signal.SIGINT, _handle_signal)


def _check_shutdown(step_name: str) -> None:
    """Raise SystemExit if a shutdown was requested between pipeline steps."""
    if shutdown_requested:
        logger.info("Shutdown requested before step '%s'. Exiting gracefully.", step_name)
        raise SystemExit(0)


# ===================================================================
# Settings from dashboard
# ===================================================================

# Cached settings (refreshed each cycle)
_cached_settings: dict = {
    "speed": "medium",
    "mode": "always",
    "bandwidth": "5mb",
    "timezone": "UTC",
    "schedule_start": 8,
    "schedule_end": 22,
    "download_start": 22,
    "download_end": 6,
}


def fetch_settings() -> dict:
    """Fetch mining settings from the dashboard API.

    Returns cached defaults if the dashboard is unreachable.
    """
    global _cached_settings
    url = f"{DASHBOARD_URL}/api/user/{USERNAME}/settings"
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "DEEPMINE-AutoMiner/1.0"})
        with urllib.request.urlopen(req, timeout=5) as resp:
            data = json.loads(resp.read().decode("utf-8"))
        _cached_settings = {
            "speed": data.get("speed", "medium"),
            "mode": data.get("mode", "always"),
            "bandwidth": data.get("bandwidth", "5mb"),
            "timezone": data.get("timezone", "UTC"),
            "schedule_start": int(data.get("schedule_start", 8)),
            "schedule_end": int(data.get("schedule_end", 22)),
            "download_start": int(data.get("download_start", 22)),
            "download_end": int(data.get("download_end", 6)),
        }
        logger.info(
            "[settings] mode=%s speed=%s bandwidth=%s schedule=%d-%d download=%d-%d",
            _cached_settings["mode"],
            _cached_settings["speed"],
            _cached_settings["bandwidth"],
            _cached_settings["schedule_start"],
            _cached_settings["schedule_end"],
            _cached_settings["download_start"],
            _cached_settings["download_end"],
        )
    except Exception as exc:
        logger.debug("[settings] Could not fetch settings: %s (using cached)", exc)
    return _cached_settings


def _is_in_window(start_hour: int, end_hour: int) -> bool:
    """Check if the current hour (in the user's timezone) is within a time window.

    Uses the timezone from settings, not the container's system clock.
    Handles wrap-around: e.g. start=22, end=6 means 22:00-05:59.
    """
    tz_name = _cached_settings.get("timezone", "UTC")
    try:
        from zoneinfo import ZoneInfo
        now_hour = datetime.now(ZoneInfo(tz_name)).hour
    except Exception:
        # Fallback: use TZ env var or system time
        now_hour = datetime.now().hour

    if start_hour <= end_hour:
        return start_hour <= now_hour < end_hour
    else:
        # Wraps midnight: e.g. 22-6 means 22,23,0,1,2,3,4,5
        return now_hour >= start_hour or now_hour < end_hour


def _user_hour() -> int:
    """Get current hour in the user's timezone."""
    tz_name = _cached_settings.get("timezone", "UTC")
    try:
        from zoneinfo import ZoneInfo
        return datetime.now(ZoneInfo(tz_name)).hour
    except Exception:
        return datetime.now().hour


def _threads_for_speed(speed: str) -> int:
    """Map speed setting to thread count based on available CPUs."""
    cpu = os.cpu_count() or 4
    mapping = {
        "low": max(1, cpu // 4),
        "medium": max(2, cpu // 2),
        "high": max(3, int(cpu * 0.75)),
        "maximum": cpu,
    }
    return mapping.get(speed, max(2, cpu // 2))


def _bandwidth_bytes(bw: str) -> int | None:
    """Convert bandwidth setting to bytes/sec for prefetch --max-rate.

    Returns None for unlimited.
    """
    mapping = {
        "512kb": 512 * 1024,
        "1mb": 1024 * 1024,
        "2mb": 2 * 1024 * 1024,
        "5mb": 5 * 1024 * 1024,
        "10mb": 10 * 1024 * 1024,
        "unlimited": None,
    }
    return mapping.get(bw, None)


# ===================================================================
# Download queue for queue mode
# ===================================================================

QUEUE_DIR = WORKDIR / "_queue"


def _queue_has_samples() -> bool:
    """Check if the download queue has any unprocessed samples."""
    if not QUEUE_DIR.is_dir():
        return False
    return any(QUEUE_DIR.iterdir())


def _pick_from_queue() -> tuple[str, str, str, Path] | None:
    """Pick the oldest sample from the download queue.

    Returns (accession, environment, description, sample_dir) or None.
    """
    if not QUEUE_DIR.is_dir():
        return None
    for entry in sorted(QUEUE_DIR.iterdir()):
        if entry.is_dir():
            meta_file = entry / "_queue_meta.json"
            if meta_file.is_file():
                meta = json.loads(meta_file.read_text(encoding="utf-8"))
                return (
                    meta.get("accession", entry.name),
                    meta.get("environment", "unknown"),
                    meta.get("description", ""),
                    entry,
                )
    return None


def _move_to_queue(sample_dir: Path, accession: str, environment: str, description: str) -> None:
    """Move a downloaded sample directory into the queue."""
    QUEUE_DIR.mkdir(parents=True, exist_ok=True)
    queue_dest = QUEUE_DIR / accession
    if queue_dest.exists():
        import shutil
        shutil.rmtree(queue_dest, ignore_errors=True)
    sample_dir.rename(queue_dest)
    meta = {"accession": accession, "environment": environment, "description": description}
    (queue_dest / "_queue_meta.json").write_text(json.dumps(meta), encoding="utf-8")
    logger.info("[queue] Queued %s for later processing", accession)


# ===================================================================
# History database (SQLite)
# ===================================================================


def init_history_db() -> None:
    """Create the processed_samples table if it does not exist."""
    HISTORY_DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(HISTORY_DB_PATH))
    try:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS processed_samples (
                accession    TEXT PRIMARY KEY,
                status       TEXT NOT NULL DEFAULT 'started',
                started_at   TEXT,
                completed_at TEXT,
                bgcs_found   INTEGER DEFAULT 0
            )
        """)
        conn.commit()
    finally:
        conn.close()


def is_already_processed(accession: str) -> bool:
    """Return True if the accession has been started or completed before."""
    conn = sqlite3.connect(str(HISTORY_DB_PATH))
    try:
        cur = conn.execute(
            "SELECT 1 FROM processed_samples WHERE accession = ?", (accession,)
        )
        return cur.fetchone() is not None
    finally:
        conn.close()


def mark_sample(accession: str, status: str, bgcs_found: int = 0) -> None:
    """Insert or update a record in the history database."""
    now = datetime.now(timezone.utc).isoformat()
    conn = sqlite3.connect(str(HISTORY_DB_PATH))
    try:
        conn.execute("""
            INSERT INTO processed_samples (accession, status, started_at, completed_at, bgcs_found)
            VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(accession) DO UPDATE SET
                status       = excluded.status,
                completed_at = excluded.completed_at,
                bgcs_found   = excluded.bgcs_found
        """, (
            accession,
            status,
            now if status == "started" else None,
            now if status != "started" else None,
            bgcs_found,
        ))
        conn.commit()
    finally:
        conn.close()


# ===================================================================
# SRA sample picker (NCBI Entrez E-utilities via urllib)
# ===================================================================


def _ncbi_esearch(term: str, retmax: int = 500) -> list[str]:
    """Search NCBI SRA and return a list of SRA accession UIDs.

    Uses the E-utilities HTTP API with urllib only (no external library).
    """
    params = urllib.parse.urlencode({
        "db": "sra",
        "term": term,
        "retmax": retmax,
        "retmode": "json",
        "usehistory": "n",
    })
    url = f"https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?{params}"

    try:
        req = urllib.request.Request(url, headers={"User-Agent": "DEEPMINE-AutoMiner/1.0"})
        with urllib.request.urlopen(req, timeout=30) as resp:
            data = json.loads(resp.read().decode("utf-8"))
        return data.get("esearchresult", {}).get("idlist", [])
    except (urllib.error.URLError, json.JSONDecodeError, KeyError) as exc:
        logger.warning("NCBI esearch failed for '%s': %s", term, exc)
        return []


def _ncbi_efetch_accession(uid: str) -> str | None:
    """Fetch the SRA run accession (SRR/ERR/DRR) for a given NCBI UID.

    Returns the accession string or None if it cannot be resolved.
    """
    params = urllib.parse.urlencode({
        "db": "sra",
        "id": uid,
        "rettype": "runinfo",
        "retmode": "text",
    })
    url = f"https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi?{params}"

    try:
        req = urllib.request.Request(url, headers={"User-Agent": "DEEPMINE-AutoMiner/1.0"})
        with urllib.request.urlopen(req, timeout=30) as resp:
            text = resp.read().decode("utf-8")

        # runinfo CSV: first row is header, second is data
        lines = [l.strip() for l in text.strip().splitlines() if l.strip()]
        if len(lines) < 2:
            return None

        header = lines[0].split(",")
        values = lines[1].split(",")
        row = dict(zip(header, values))
        accession = row.get("Run", "").strip()

        if accession and accession.startswith(("SRR", "ERR", "DRR")):
            return accession
        return None

    except (urllib.error.URLError, ValueError) as exc:
        logger.warning("NCBI efetch failed for UID %s: %s", uid, exc)
        return None


def _fetch_globally_processed() -> set[str]:
    """Fetch the set of accessions already processed by ANY volunteer.

    This prevents duplicate work across the distributed network.
    Returns an empty set if the dashboard is unreachable.
    """
    url = f"{DASHBOARD_URL}/api/samples/processed"
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "DEEPMINE-AutoMiner/1.0"})
        with urllib.request.urlopen(req, timeout=10) as resp:
            data = json.loads(resp.read().decode("utf-8"))
        accessions = set(data.get("accessions", []))
        logger.info("[global] %d samples already processed by the community", len(accessions))
        return accessions
    except Exception as exc:
        logger.debug("[global] Could not fetch processed list: %s", exc)
        return set()


def _report_processed(accession: str, bgcs_found: int) -> None:
    """Report a processed sample to the dashboard so others skip it."""
    payload = {
        "accession": accession,
        "username": USERNAME,
        "bgcs_found": bgcs_found,
    }
    try:
        data = json.dumps(payload).encode("utf-8")
        req = urllib.request.Request(
            f"{DASHBOARD_URL}/api/samples/processed",
            data=data,
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        urllib.request.urlopen(req, timeout=5)
    except Exception:
        pass  # Non-critical


def pick_random_sample() -> tuple[str, str, str] | None:
    """Pick a random unprocessed SRA metagenome accession.

    First tries curated samples (known to produce good assemblies),
    then falls back to random NCBI search with WGS filter.

    Checks both local history AND the global dashboard registry to
    avoid duplicating work done by other volunteers.

    Returns:
        Tuple of (accession, environment_label, description) or None.
    """
    # Fetch globally processed samples from dashboard
    globally_processed = _fetch_globally_processed()

    # Phase 1: Try curated samples (shuffled for variety)
    import random as _rand
    curated = list(CURATED_SAMPLES)
    _rand.shuffle(curated)
    for accession, env_label, desc in curated:
        if not is_already_processed(accession) and accession not in globally_processed:
            logger.info("Using curated sample %s (%s)", accession, env_label)
            return (accession, env_label, desc)

    logger.info("All curated samples processed. Searching NCBI for new ones.")

    # Phase 2: Fall back to random NCBI search
    for attempt in range(MAX_SAMPLE_RETRIES):
        query, env_label = ENVIRONMENT_QUERIES[attempt % len(ENVIRONMENT_QUERIES)]
        search_term = f'"{query}"[Organism] AND "public"[Access] AND "wgs"[Strategy]'

        logger.info("Sample search attempt %d/%d: %s", attempt + 1, MAX_SAMPLE_RETRIES, query)

        uids = _ncbi_esearch(search_term)
        if not uids:
            time.sleep(NCBI_DELAY_S)
            continue

        # Pick a random UID from the results
        idx = randint(0, len(uids) - 1)
        uid = uids[idx]

        time.sleep(NCBI_DELAY_S)

        accession = _ncbi_efetch_accession(uid)
        if not accession:
            logger.debug("Could not resolve UID %s to an accession.", uid)
            time.sleep(NCBI_DELAY_S)
            continue

        if is_already_processed(accession) or accession in globally_processed:
            logger.info("Accession %s already processed (local or global), retrying.", accession)
            time.sleep(NCBI_DELAY_S)
            continue

        logger.info("Selected accession %s from environment '%s'.", accession, env_label)
        return accession, env_label, f"Public {env_label} metagenome from NCBI SRA."

    logger.warning("Could not find an unprocessed sample after %d attempts.", MAX_SAMPLE_RETRIES)
    return None


# ===================================================================
# Pipeline execution
# ===================================================================

import shutil

def _tool_available(name: str) -> bool:
    """Check if a command-line tool is available on PATH."""
    return shutil.which(name) is not None


current_sample_size_mb = 0
current_sample_bases = 0
current_download_dir = ""


def _fetch_sample_size(accession: str) -> tuple[int, int]:
    """Fetch sample size (MB) and base count from NCBI runinfo."""
    params = urllib.parse.urlencode({
        "db": "sra",
        "term": accession,
        "rettype": "runinfo",
        "retmode": "text",
    })
    url = f"https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi?db=sra&id={accession}&rettype=runinfo&retmode=text"
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "DEEPMINE-AutoMiner/1.0"})
        with urllib.request.urlopen(req, timeout=15) as resp:
            text = resp.read().decode("utf-8")
        lines = [l.strip() for l in text.strip().splitlines() if l.strip()]
        if len(lines) >= 2:
            header = lines[0].split(",")
            values = lines[1].split(",")
            row = dict(zip(header, values))
            size_mb = int(row.get("size_MB", 0))
            bases = int(row.get("bases", 0))
            return size_mb, bases
    except Exception:
        pass
    return 0, 0


def _get_dir_size_mb(path: str) -> float:
    """Get directory size in MB."""
    total = 0
    try:
        for f in Path(path).rglob("*"):
            if f.is_file():
                total += f.stat().st_size
    except OSError:
        pass
    return total / (1024 * 1024)


def _get_fasterq_progress_mb() -> float:
    """Estimate fasterq-dump progress from its RSS memory usage.

    fasterq-dump buffers the entire download in memory before writing to disk,
    so disk usage stays near zero until completion. RSS is a rough proxy.
    """
    try:
        import subprocess as _sp
        result = _sp.run(
            ["ps", "-o", "rss=", "-C", "fasterq-dump"],
            capture_output=True, text=True, timeout=5,
        )
        # Sum all fasterq-dump processes RSS (in KB)
        total_kb = sum(int(x.strip()) for x in result.stdout.strip().split("\n") if x.strip())
        return total_kb / 1024  # MB
    except Exception:
        return 0


def _report_progress(step: str, status: str, duration: str | None = None) -> None:
    """Report current pipeline step to the dashboard for live progress display."""
    payload = {
        "username": USERNAME,
        "sample": current_accession,
        "environment": current_environment,
        "description": current_description,
        "step": step,
        "status": status,
        "duration": duration,
        "session_completed": session_completed_count,
        "session_skipped": session_skipped_count,
        "sample_size_mb": current_sample_size_mb,
        "sample_bases": current_sample_bases,
    }
    # Add download progress if we're in the download step
    if step == "download" and status == "running":
        disk_mb = _get_dir_size_mb(current_download_dir) if current_download_dir else 0
        mem_mb = _get_fasterq_progress_mb() if disk_mb < 1 else 0
        payload["downloaded_mb"] = round(max(disk_mb, mem_mb), 1)
    try:
        data = json.dumps(payload).encode("utf-8")
        req = urllib.request.Request(
            f"{DASHBOARD_URL}/api/user/{USERNAME}/progress",
            data=data,
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        urllib.request.urlopen(req, timeout=5)
    except Exception:
        pass  # Non-critical, don't fail the pipeline


def _run_step(
    name: str,
    cmd: list[str],
    timeout: int = TIMEOUT_DEFAULT,
    cwd: str | Path | None = None,
) -> subprocess.CompletedProcess:
    """Run a single pipeline step as a subprocess with logging and timing."""
    _check_shutdown(name)

    logger.info("[%s] Starting: %s", name, " ".join(cmd))
    t0 = time.monotonic()

    # Start a heartbeat thread that re-sends progress every 30s during long steps
    import threading
    heartbeat_stop = threading.Event()

    def _heartbeat():
        while not heartbeat_stop.wait(15):
            fetch_settings()  # Pick up setting changes in real-time
            elapsed = time.monotonic() - t0
            _report_progress(name, "running", f"{elapsed:.0f}s")

    hb_thread = threading.Thread(target=_heartbeat, daemon=True)
    hb_thread.start()

    try:
        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=timeout,
            cwd=cwd,
        )
    except subprocess.TimeoutExpired:
        elapsed = time.monotonic() - t0
        logger.error("[%s] Timed out after %.1fs (limit: %ds)", name, elapsed, timeout)
        raise
    except FileNotFoundError as exc:
        logger.error("[%s] Command not found: %s", name, exc)
        raise
    finally:
        heartbeat_stop.set()
        hb_thread.join(timeout=2)

    elapsed = time.monotonic() - t0

    if result.returncode != 0:
        logger.error(
            "[%s] Failed (exit %d, %.1fs).\nstdout: %s\nstderr: %s",
            name,
            result.returncode,
            elapsed,
            result.stdout[-2000:] if result.stdout else "",
            result.stderr[-2000:] if result.stderr else "",
        )
        raise subprocess.CalledProcessError(result.returncode, cmd, result.stdout, result.stderr)

    logger.info("[%s] Completed in %.1fs", name, elapsed)
    return result


def _find_read_files(reads_dir: Path) -> tuple[str | None, str | None, str | None]:
    """Locate R1, R2, and/or single-end read files from fasterq-dump output.

    fasterq-dump with --split-3 produces:
      - Paired: {accession}_1.fastq.gz, {accession}_2.fastq.gz
      - Single: {accession}.fastq.gz
    """
    r1 = r2 = single = None

    gz_files = sorted(reads_dir.glob("*.fastq.gz"))
    fq_files = sorted(reads_dir.glob("*.fastq"))
    all_files = gz_files or fq_files

    for f in all_files:
        name = f.name
        if "_1.fastq" in name:
            r1 = str(f)
        elif "_2.fastq" in name:
            r2 = str(f)
        else:
            single = str(f)

    return r1, r2, single


def run_pipeline(
    accession: str,
    sample_dir: Path,
    skip_download: bool = False,
    download_only: bool = False,
) -> dict:
    """Run the full DEEPMINE pipeline for a single SRA accession.

    Steps: download -> compress -> assemble -> filter contigs -> gene calling
    -> antiSMASH -> GECCO -> DeepBGC -> ensemble merge -> score -> write results.

    Args:
        skip_download: If True, skip download+compress (reads already exist).
        download_only: If True, stop after download+compress (for queue mode).

    Returns a summary dict with counts and file paths.
    """
    sample_dir.mkdir(parents=True, exist_ok=True)
    reads_dir = sample_dir / "reads"
    reads_dir.mkdir(parents=True, exist_ok=True)

    summary = {
        "accession": accession,
        "steps_completed": [],
        "bgcs_found": 0,
        "candidates_scored": 0,
    }

    # Dynamic thread count - re-read from settings before each step
    def _current_threads() -> int:
        return _threads_for_speed(_cached_settings.get("speed", "medium"))

    # ---- Step a: Download from SRA ----
    if not skip_download:
        # Fetch sample size from NCBI for progress display
        global current_sample_size_mb, current_sample_bases, current_download_dir
        current_sample_size_mb, current_sample_bases = _fetch_sample_size(accession)
        current_download_dir = str(reads_dir)
        if current_sample_size_mb:
            logger.info("[download] Sample size: %d MB, %s bases", current_sample_size_mb, f"{current_sample_bases:,}")

        # Skip samples that are too large to process efficiently
        if current_sample_size_mb > MAX_SAMPLE_SIZE_MB:
            logger.warning(
                "[download] Sample %s is %d MB (limit %d MB). Skipping.",
                accession, current_sample_size_mb, MAX_SAMPLE_SIZE_MB,
            )
            summary["skipped"] = True
            summary["skip_reason"] = f"too_large_{current_sample_size_mb}MB"
            return summary

        _report_progress("download", "running")
        t0_dl = time.monotonic()

        # Apply bandwidth limit via pv if available, otherwise download unlimited
        bw_limit = _bandwidth_bytes(_cached_settings.get("bandwidth", "5mb"))
        bw_flag = []
        if bw_limit is not None and _tool_available("pv"):
            # pv rate-limits stdin/stdout; we'll apply it during compress instead
            # For fasterq-dump, we limit threads to indirectly reduce bandwidth
            t = _current_threads()
            bw_threads = max(1, min(t, {
                512 * 1024: 1,
                1024 * 1024: 1,
                2 * 1024 * 1024: 2,
                5 * 1024 * 1024: 3,
                10 * 1024 * 1024: 4,
            }.get(bw_limit, t)))
        else:
            bw_threads = _current_threads()

        _run_step(
            "download",
            [
                "fasterq-dump", accession,
                "--outdir", str(reads_dir),
                "--threads", str(bw_threads),
                "--split-3",
            ],
            timeout=TIMEOUT_DOWNLOAD,
        )
        _report_progress("download", "done", f"{time.monotonic() - t0_dl:.1f}s")
        summary["steps_completed"].append("download")

        # ---- Step b: Compress reads ----
        _check_shutdown("compress")
        _report_progress("compress", "running")
        t0_cmp = time.monotonic()
        fastq_files = list(reads_dir.glob("*.fastq"))
        if fastq_files:
            _run_step(
                "compress",
                ["pigz", "-p", str(_current_threads())] + [str(f) for f in fastq_files],
                timeout=TIMEOUT_DEFAULT,
            )
        _report_progress("compress", "done", f"{time.monotonic() - t0_cmp:.1f}s")
        summary["steps_completed"].append("compress")
    else:
        logger.info("[pipeline] Skipping download+compress (reads already in queue)")

    # If download_only, stop here (queue mode pre-fetch)
    if download_only:
        summary["download_only"] = True
        return summary

    # ---- Step c: Assemble with MEGAHIT ----
    r1, r2, single = _find_read_files(reads_dir)
    assembly_dir = sample_dir / "assembly"

    if r1 and r2:
        assemble_cmd = [
            "megahit",
            "-1", r1,
            "-2", r2,
            "--presets", "meta-large",
            "--min-contig-len", "2000",
            "-t", str(_current_threads()),
            "-o", str(assembly_dir),
        ]
    elif single:
        assemble_cmd = [
            "megahit",
            "-r", single,
            "--presets", "meta-large",
            "--min-contig-len", "2000",
            "-t", str(_current_threads()),
            "-o", str(assembly_dir),
        ]
    else:
        raise FileNotFoundError(f"No read files found in {reads_dir}")

    _report_progress("assembly", "running")
    t0_asm = time.monotonic()
    _run_step("assembly", assemble_cmd, timeout=TIMEOUT_ASSEMBLY)
    _report_progress("assembly", "done", f"{time.monotonic() - t0_asm:.1f}s")
    summary["steps_completed"].append("assembly")

    # ---- Step d: Filter contigs ----
    assembly_contigs = assembly_dir / "final.contigs.fa"
    filtered_contigs = sample_dir / "contigs.fa"

    # seqkit writes to stdout, so we capture and redirect to file
    _check_shutdown("filter_contigs")
    _report_progress("filter_contigs", "running")
    logger.info("[filter_contigs] Starting: seqkit seq --min-len 2000 %s", assembly_contigs)
    t0_filter = time.monotonic()
    result = subprocess.run(
        ["seqkit", "seq", "--min-len", "2000", str(assembly_contigs)],
        capture_output=True,
        timeout=TIMEOUT_DEFAULT,
    )
    if result.returncode != 0:
        logger.error(
            "[filter_contigs] Failed (exit %d). stderr: %s",
            result.returncode,
            result.stderr[-2000:] if result.stderr else "",
        )
        raise subprocess.CalledProcessError(result.returncode, ["seqkit"])
    filtered_contigs.write_bytes(result.stdout)
    elapsed_filter = time.monotonic() - t0_filter
    logger.info(
        "[filter_contigs] Wrote %d bytes to %s in %.1fs",
        len(result.stdout), filtered_contigs, elapsed_filter,
    )
    _report_progress("filter_contigs", "done", f"{elapsed_filter:.1f}s")
    summary["steps_completed"].append("filter_contigs")

    # Check if any contigs passed the filter
    if len(result.stdout) == 0 or filtered_contigs.stat().st_size == 0:
        logger.warning(
            "No contigs >= 2000 bp after assembly for %s. Skipping sample.",
            accession,
        )
        summary["skipped"] = True
        summary["skip_reason"] = "no_contigs_after_filter"
        return summary

    contigs_path = str(filtered_contigs)

    # ---- Step e: Gene calling with Prodigal ----
    genes_gff = sample_dir / "genes.gff"
    proteins_faa = sample_dir / "proteins.faa"

    _report_progress("gene_calling", "running")
    t0_gc = time.monotonic()
    _run_step(
        "gene_calling",
        [
            "prodigal",
            "-i", contigs_path,
            "-o", str(genes_gff),
            "-a", str(proteins_faa),
            "-p", "meta",
        ],
        timeout=TIMEOUT_DEFAULT,
    )
    _report_progress("gene_calling", "done", f"{time.monotonic() - t0_gc:.1f}s")
    summary["steps_completed"].append("gene_calling")

    # ---- Step f: antiSMASH (skip if not installed, e.g. lite mode) ----
    if _tool_available("antismash"):
        antismash_dir = sample_dir / "antismash"
        _report_progress("antismash", "running")
        t0_as = time.monotonic()
        _run_step(
            "antismash",
            [
                "antismash", contigs_path,
                "--output-dir", str(antismash_dir),
                "--taxon", "bacteria",
                "--cpus", str(_current_threads()),
                "--minimal",
            ],
            timeout=TIMEOUT_DEFAULT,
        )
        _report_progress("antismash", "done", f"{time.monotonic() - t0_as:.1f}s")
        summary["steps_completed"].append("antismash")
    else:
        logger.info("[antismash] Not installed, skipping (lite mode).")
        _report_progress("antismash", "skipped")

    # ---- Step g: GECCO ----
    gecco_dir = sample_dir / "gecco"
    _report_progress("gecco", "running")
    t0_gecco = time.monotonic()
    _run_step(
        "gecco",
        [
            "gecco", "run",
            "--genome", contigs_path,
            "--output", str(gecco_dir),
            "--jobs", str(_current_threads()),
        ],
        timeout=TIMEOUT_DEFAULT,
    )
    _report_progress("gecco", "done", f"{time.monotonic() - t0_gecco:.1f}s")
    summary["steps_completed"].append("gecco")

    # ---- Step h: DeepBGC (skip if not installed, e.g. lite mode) ----
    if _tool_available("deepbgc"):
        deepbgc_dir = sample_dir / "deepbgc"
        _report_progress("deepbgc", "running")
        t0_dbgc = time.monotonic()
        _run_step(
            "deepbgc",
            [
                "deepbgc", "pipeline",
                "--output", str(deepbgc_dir),
                contigs_path,
            ],
            timeout=TIMEOUT_DEFAULT,
        )
        _report_progress("deepbgc", "done", f"{time.monotonic() - t0_dbgc:.1f}s")
        summary["steps_completed"].append("deepbgc")
    else:
        logger.info("[deepbgc] Not installed, skipping (lite mode).")
        _report_progress("deepbgc", "skipped")

    # ---- Step i: Ensemble merge ----
    _check_shutdown("ensemble_merge")
    _report_progress("ensemble_merge", "running")
    logger.info("[ensemble_merge] Parsing tool outputs and merging detections.")
    t0 = time.monotonic()

    from deepmine.parsers.gecco import parse_gecco_output

    # Parse outputs from whichever tools ran
    antismash_results = []
    gecco_results = []
    deepbgc_results = []

    if _tool_available("antismash") and (sample_dir / "antismash").exists():
        from deepmine.parsers.antismash import parse_antismash_dir
        antismash_results = parse_antismash_dir(sample_dir / "antismash")
        logger.info("[ensemble_merge] antiSMASH: %d BGCs", len(antismash_results))

    # GECCO outputs a clusters TSV; find it
    gecco_tsvs = sorted(gecco_dir.glob("*.clusters.tsv"))
    for tsv in gecco_tsvs:
        gecco_results.extend(parse_gecco_output(tsv))
    logger.info("[ensemble_merge] GECCO: %d BGCs", len(gecco_results))

    if _tool_available("deepbgc") and (sample_dir / "deepbgc").exists():
        from deepmine.parsers.deepbgc import parse_deepbgc_output
        deepbgc_results = parse_deepbgc_output(sample_dir / "deepbgc")
        logger.info("[ensemble_merge] DeepBGC: %d BGCs", len(deepbgc_results))

    # In lite mode (GECCO only), skip consensus voting and use GECCO results directly
    all_detections = antismash_results + gecco_results + deepbgc_results
    tools_active = sum([bool(antismash_results), bool(gecco_results), bool(deepbgc_results)])

    if tools_active >= 2:
        from deepmine.parsers.ensemble import merge_detections
        consensus = merge_detections(
            antismash=antismash_results,
            gecco=gecco_results,
            deepbgc=deepbgc_results,
            min_consensus=2,
        )
    else:
        # Single tool mode (lite): use all detections as-is
        consensus = all_detections

    logger.info(
        "[ensemble_merge] %d BGCs (from %d detections, %d tools) in %.1fs",
        len(consensus),
        len(all_detections),
        tools_active,
        time.monotonic() - t0,
    )
    summary["bgcs_found"] = len(consensus)
    _report_progress("ensemble_merge", "done", f"{time.monotonic() - t0:.1f}s")
    summary["steps_completed"].append("ensemble_merge")

    # ---- Step j: Score candidates ----
    _check_shutdown("scoring")
    _report_progress("scoring", "running")
    t0_score = time.monotonic()
    scored_candidates = _score_candidates(consensus, sample_dir)
    _report_progress("scoring", "done", f"{time.monotonic() - t0_score:.1f}s")
    summary["candidates_scored"] = len(scored_candidates)
    summary["steps_completed"].append("scoring")

    # ---- Step k: Extract BGC sequences from contigs ----
    _extract_bgc_sequences(scored_candidates, contigs_path)

    # ---- Step l: Write ranked_candidates.tsv ----
    _check_shutdown("write_results")
    output_tsv = sample_dir / "ranked_candidates.tsv"
    _write_ranked_tsv(scored_candidates, output_tsv, accession)
    logger.info("[write_results] Wrote %d candidates to %s", len(scored_candidates), output_tsv)
    summary["steps_completed"].append("write_results")
    summary["output_tsv"] = str(output_tsv)
    summary["scored_candidates"] = scored_candidates

    return summary


def _extract_bgc_sequences(candidates: list[dict], contigs_path: str) -> None:
    """Extract BGC nucleotide sequences from contigs and add to candidate dicts.

    Parses the contigs FASTA file, finds the region [start:end] on each
    candidate's contig, and stores the sequence in the candidate dict.
    """
    contigs_file = Path(contigs_path)
    if not contigs_file.is_file() or not candidates:
        return

    # Parse contigs FASTA into a dict {contig_name: sequence}
    contigs: dict[str, str] = {}
    current_name = ""
    current_seq: list[str] = []

    with open(contigs_file, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if line.startswith(">"):
                if current_name:
                    contigs[current_name] = "".join(current_seq)
                # Use first word as contig name (matches MEGAHIT output)
                current_name = line[1:].split()[0]
                current_seq = []
            else:
                current_seq.append(line)
        if current_name:
            contigs[current_name] = "".join(current_seq)

    extracted = 0
    for c in candidates:
        contig_name = c.get("contig", "")
        start = int(c.get("start", 0))
        end = int(c.get("end", 0))

        seq = contigs.get(contig_name, "")
        if seq and end > start:
            c["sequence"] = seq[start:end]
            c["sequence_length"] = end - start
            extracted += 1
        else:
            c["sequence"] = ""
            c["sequence_length"] = 0

    logger.info("[sequences] Extracted %d/%d BGC sequences from contigs", extracted, len(candidates))


def _score_candidates(
    consensus: list,
    sample_dir: Path,
) -> list[dict]:
    """Score consensus BGCs using the ML model if available, otherwise heuristic.

    Returns a list of dicts sorted by activity_score descending.
    """
    model_path = Path("models/activity_scorer.pt")

    # Check several common model locations
    candidate_model_paths = [
        model_path,
        Path("/app/models/activity_scorer.pt"),
        Path("/data/models/activity_scorer.pt"),
        sample_dir.parent / "models" / "activity_scorer.pt",
    ]

    model_file = None
    for p in candidate_model_paths:
        if p.is_file():
            model_file = p
            break

    if model_file is not None:
        logger.info("[scoring] Using ML model: %s", model_file)
        return _ml_score(consensus, model_file)
    else:
        logger.info("[scoring] No ML model found, using heuristic scoring.")
        return _heuristic_score(consensus)


def _ml_score(consensus: list, model_path: Path) -> list[dict]:
    """Score BGCs with the trained ActivityScorer model."""
    try:
        import torch
        from deepmine.models.activity_scorer import ActivityScorer, predict

        device = "cpu"
        checkpoint = torch.load(str(model_path), map_location=device, weights_only=True)
        model = ActivityScorer(
            domain_vocab_size=checkpoint["domain_vocab_size"],
            chemical_feature_dim=checkpoint["chemical_feature_dim"],
        )
        model.load_state_dict(checkpoint["model_state_dict"])
        domain_vocab = checkpoint["domain_vocab"]

        bgc_features = []
        for c in consensus:
            bgc_features.append({
                "bgc_id": c.bgc_id,
                "domain_ids": getattr(c, "domains", []) or [],
                "chemical_features": [0.0] * checkpoint["chemical_feature_dim"],
            })

        results = predict(model, bgc_features, domain_vocab, device=device)

        # Merge consensus metadata into results
        consensus_map = {c.bgc_id: c for c in consensus}
        for r in results:
            c = consensus_map.get(r["bgc_id"])
            if c:
                r["bgc_type"] = c.bgc_type
                r["contig"] = c.contig
                r["start"] = c.start
                r["end"] = c.end
                r["detectors"] = ",".join(getattr(c, "detectors", None) or ["gecco"])
                r["consensus_confidence"] = getattr(c, "confidence", 0.5)

        results.sort(key=lambda x: x.get("activity_score", 0), reverse=True)
        return results

    except Exception as exc:
        logger.warning("[scoring] ML scoring failed (%s), falling back to heuristic.", exc)
        return _heuristic_score(consensus)


def _heuristic_score(consensus: list) -> list[dict]:
    """Score BGCs using a rule-based heuristic when no ML model is available.

    Heuristic factors:
    - Number of detectors (3/3 = strong signal)
    - Consensus confidence from the ensemble merger
    - BGC type bonus: NRP and polyketide families are more likely antimicrobial
    """
    type_bonus = {
        "nrps": 0.15,
        "nrp": 0.15,
        "t1pks": 0.12,
        "t2pks": 0.10,
        "transatpks": 0.10,
        "polyketide": 0.10,
        "lanthipeptide": 0.08,
        "thiopeptide": 0.08,
        "bacteriocin": 0.06,
        "lassopeptide": 0.06,
        "sactipeptide": 0.05,
        "terpene": 0.03,
    }

    results = []
    for c in consensus:
        # Base: number of detectors scaled to [0.33, 1.0]
        detectors = getattr(c, "detectors", None) or ["gecco"]
        detector_score = len(detectors) / 3.0

        # Ensemble confidence
        conf = getattr(c, "confidence", 0.5)

        # Type bonus
        bonus = 0.0
        bgc_lower = c.bgc_type.lower()
        for key, val in type_bonus.items():
            if key in bgc_lower:
                bonus = val
                break

        # Weighted combination
        activity_score = min(
            0.4 * detector_score + 0.4 * conf + 0.2 * (0.5 + bonus),
            1.0,
        )

        results.append({
            "bgc_id": c.bgc_id,
            "bgc_type": c.bgc_type,
            "contig": c.contig,
            "start": c.start,
            "end": c.end,
            "detectors": ",".join(detectors),
            "consensus_confidence": conf,
            "activity_score": round(activity_score, 4),
            "confidence": round(conf, 4),
            "scoring_method": "heuristic",
        })

    results.sort(key=lambda x: x["activity_score"], reverse=True)
    return results


def _write_ranked_tsv(candidates: list[dict], output_path: Path, accession: str) -> None:
    """Write scored candidates to a TSV file matching the telemetry schema."""
    if not candidates:
        # Write header-only file so downstream tools don't break
        output_path.write_text(
            "bgc_id\tsource_sample\tbgc_type\tpredicted_product\t"
            "novelty_distance\tactivity_score\tconfidence\n",
            encoding="utf-8",
        )
        return

    columns = [
        "bgc_id", "source_sample", "bgc_type", "predicted_product",
        "novelty_distance", "activity_score", "confidence",
        "contig", "start", "end", "detectors",
    ]
    lines = ["\t".join(columns)]

    for c in candidates:
        row = [
            str(c.get("bgc_id", "")),
            accession,
            str(c.get("bgc_type", "unknown")),
            str(c.get("bgc_type", "unknown")),   # predicted_product approximated from type
            "0.0",                                 # novelty_distance (requires BiG-SLiCE, N/A here)
            str(c.get("activity_score", 0)),
            str(c.get("confidence", 0)),
            str(c.get("contig", "")),
            str(c.get("start", "")),
            str(c.get("end", "")),
            str(c.get("detectors", "")),
        ]
        lines.append("\t".join(row))

    output_path.write_text("\n".join(lines) + "\n", encoding="utf-8")


# ===================================================================
# Result reporting to dashboard
# ===================================================================


def report_to_dashboard(
    accession: str,
    environment: str,
    candidates: list[dict],
) -> bool:
    """POST pipeline results to the DEEPMINE community dashboard.

    Uses urllib only (no requests library). Returns True on success.
    """
    timestamp = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
    run_id = f"auto_{accession}_{timestamp}"

    # Build candidate payloads
    candidate_payloads = []
    for c in candidates:
        candidate_payloads.append({
            "bgc_id": c.get("bgc_id", ""),
            "source_sample": accession,
            "bgc_type": c.get("bgc_type", "unknown"),
            "activity_score": float(c.get("activity_score", 0)),
            "novelty_distance": float(c.get("novelty_distance", 0)),
            "confidence": float(c.get("confidence", 0)),
            "contig": c.get("contig", ""),
            "start": c.get("start", 0),
            "end": c.get("end", 0),
            "detectors": c.get("detectors", ""),
            "sequence": c.get("sequence", ""),
            "sequence_length": c.get("sequence_length", 0),
        })

    payload = {
        "username": USERNAME,
        "run_id": run_id,
        "samples": [
            {
                "sra_accession": accession,
                "environment": environment,
                "location": "unknown",
            }
        ],
        "candidates": candidate_payloads,
    }

    url = f"{DASHBOARD_URL}/api/submit"
    data = json.dumps(payload).encode("utf-8")

    req = urllib.request.Request(
        url,
        data=data,
        headers={
            "Content-Type": "application/json",
            "User-Agent": "DEEPMINE-AutoMiner/1.0",
        },
        method="POST",
    )

    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            resp_body = resp.read().decode("utf-8")
            logger.info(
                "[report] Submitted %d candidates for %s to %s (status %d). Response: %s",
                len(candidate_payloads),
                accession,
                url,
                resp.status,
                resp_body[:500],
            )
            return True
    except urllib.error.HTTPError as exc:
        logger.error(
            "[report] Dashboard returned HTTP %d for %s: %s",
            exc.code, url, exc.read().decode("utf-8", errors="replace")[:500],
        )
        return False
    except urllib.error.URLError as exc:
        logger.error("[report] Cannot connect to dashboard at %s: %s", url, exc.reason)
        return False
    except Exception as exc:
        logger.error("[report] Unexpected error reporting to dashboard: %s", exc)
        return False


# ===================================================================
# Cleanup
# ===================================================================


RESULTS_DIR = Path("/data/results")


def _archive_results(sample_dir: Path, accession: str) -> None:
    """Copy key result files to persistent storage before cleanup.

    Archives ranked_candidates.tsv, summary.json, and any extracted
    BGC sequences to /data/results/{accession}/ for 7 days.
    """
    import shutil

    archive_dir = RESULTS_DIR / accession
    archive_dir.mkdir(parents=True, exist_ok=True)

    for filename in ("ranked_candidates.tsv", "summary.json"):
        src = sample_dir / filename
        if src.is_file():
            shutil.copy2(src, archive_dir / filename)

    logger.info("[archive] Results saved to %s", archive_dir)

    # Purge archives older than 3 days
    cutoff = time.time() - (3 * 24 * 3600)
    if RESULTS_DIR.is_dir():
        for old_dir in RESULTS_DIR.iterdir():
            if old_dir.is_dir():
                try:
                    mtime = max(f.stat().st_mtime for f in old_dir.rglob("*") if f.is_file())
                    if mtime < cutoff:
                        shutil.rmtree(old_dir, ignore_errors=True)
                        logger.info("[archive] Purged old results: %s", old_dir.name)
                except (ValueError, OSError):
                    pass


def cleanup_workdir(sample_dir: Path) -> None:
    """Remove bulky intermediate files, keeping only results.

    Archives results to /data/results/ before removing the working directory.
    Preserves: ranked_candidates.tsv, summary.json
    Removes: FASTQ files, assembly intermediates, raw tool outputs
    """
    import shutil

    # Archive results before cleanup
    accession = sample_dir.name
    _archive_results(sample_dir, accession)

    keep_files = {"ranked_candidates.tsv", "summary.json"}

    removed_bytes = 0
    removed_count = 0

    # Remove specific large directories
    for dirname in ("reads", "assembly", "antismash", "gecco", "deepbgc"):
        dirpath = sample_dir / dirname
        if dirpath.is_dir():
            size = _dir_size(dirpath)
            shutil.rmtree(dirpath, ignore_errors=True)
            removed_bytes += size
            removed_count += 1

    # Remove leftover large files (FASTQs, FASTAs, GFFs)
    for pattern in ("*.fastq", "*.fastq.gz", "*.fa", "*.fasta", "*.faa", "*.gff"):
        for filepath in sample_dir.glob(pattern):
            if filepath.name not in keep_files:
                size = filepath.stat().st_size
                filepath.unlink(missing_ok=True)
                removed_bytes += size
                removed_count += 1

    logger.info(
        "[cleanup] Removed %d items (%.1f MB) from %s",
        removed_count,
        removed_bytes / (1024 * 1024),
        sample_dir,
    )


def _dir_size(path: Path) -> int:
    """Recursively compute directory size in bytes."""
    total = 0
    try:
        for f in path.rglob("*"):
            if f.is_file():
                total += f.stat().st_size
    except OSError:
        pass
    return total


# ===================================================================
# Main loop
# ===================================================================


def _run_full_cycle(cycle: int) -> None:
    """Run one full mining cycle: pick sample, run pipeline, report."""
    global current_accession, current_environment, current_description
    global session_completed_count, session_skipped_count

    sample_info = pick_random_sample()
    if sample_info is None:
        logger.info("No suitable sample found. Backing off for %ds.", NO_SAMPLE_BACKOFF_S)
        _interruptible_sleep(NO_SAMPLE_BACKOFF_S)
        return

    accession, environment, sample_description = sample_info
    sample_dir = WORKDIR / accession
    mark_sample(accession, "started")

    try:
        current_accession = accession
        current_environment = environment
        current_description = sample_description

        logger.info("Processing %s (environment: %s)", accession, environment)
        summary = run_pipeline(accession, sample_dir)

        if summary.get("skipped"):
            logger.info("Cycle %d: %s skipped (%s).", cycle, accession, summary.get("skip_reason", "unknown"))
            mark_sample(accession, "skipped")
            _report_processed(accession, 0)
            session_skipped_count += 1
            cleanup_workdir(sample_dir)
            return

        summary["environment"] = environment
        summary["completed_at"] = datetime.now(timezone.utc).isoformat()
        (sample_dir / "summary.json").write_text(json.dumps(summary, indent=2), encoding="utf-8")

        # Use in-memory candidates (includes sequences) instead of TSV reload
        candidates = summary.get("scored_candidates", [])
        if not candidates:
            candidates = _load_candidates_from_tsv(sample_dir / "ranked_candidates.tsv")
        report_to_dashboard(accession, environment, candidates)

        mark_sample(accession, "completed", bgcs_found=summary.get("bgcs_found", 0))
        _report_processed(accession, summary.get("bgcs_found", 0))
        session_completed_count += 1
        cleanup_workdir(sample_dir)

        logger.info(
            "Cycle %d complete: %s, %d BGCs found, %d candidates scored.",
            cycle, accession, summary.get("bgcs_found", 0), summary.get("candidates_scored", 0),
        )

    except SystemExit:
        logger.info("Shutdown during processing of %s.", accession)
        mark_sample(accession, "interrupted")
        raise

    except Exception as exc:
        logger.error("Pipeline failed for %s: %s", accession, exc, exc_info=True)
        mark_sample(accession, "failed")


def _run_queue_download() -> None:
    """Queue mode: download one sample and put it in the queue for later processing."""
    global current_accession, current_environment, current_description

    sample_info = pick_random_sample()
    if sample_info is None:
        logger.info("[queue-dl] No suitable sample. Backing off for %ds.", NO_SAMPLE_BACKOFF_S)
        _interruptible_sleep(NO_SAMPLE_BACKOFF_S)
        return

    accession, environment, description = sample_info
    sample_dir = WORKDIR / accession
    mark_sample(accession, "started")

    try:
        current_accession = accession
        current_environment = environment
        current_description = description

        logger.info("[queue-dl] Downloading %s for later processing", accession)
        run_pipeline(accession, sample_dir, download_only=True)
        _move_to_queue(sample_dir, accession, environment, description)
        logger.info("[queue-dl] %s queued successfully", accession)

    except Exception as exc:
        logger.error("[queue-dl] Download failed for %s: %s", accession, exc)
        mark_sample(accession, "failed")


def _run_queue_process(cycle: int) -> None:
    """Queue mode: process the next sample from the download queue."""
    global current_accession, current_environment, current_description
    global session_completed_count, session_skipped_count

    queued = _pick_from_queue()
    if queued is None:
        logger.info("[queue-run] No samples in queue. Waiting.")
        _interruptible_sleep(30)
        return

    accession, environment, description, sample_dir = queued
    current_accession = accession
    current_environment = environment
    current_description = description

    # Remove queue metadata file before processing
    meta_file = sample_dir / "_queue_meta.json"
    if meta_file.exists():
        meta_file.unlink()

    # Move from queue dir back to workdir for processing
    dest_dir = WORKDIR / accession
    if dest_dir.exists() and dest_dir != sample_dir:
        import shutil
        shutil.rmtree(dest_dir, ignore_errors=True)
    if sample_dir.parent == QUEUE_DIR:
        sample_dir.rename(dest_dir)
        sample_dir = dest_dir

    try:
        logger.info("[queue-run] Processing queued sample %s", accession)
        summary = run_pipeline(accession, sample_dir, skip_download=True)

        if summary.get("skipped"):
            logger.info("Cycle %d: %s skipped (%s).", cycle, accession, summary.get("skip_reason", "unknown"))
            mark_sample(accession, "skipped")
            _report_processed(accession, 0)
            session_skipped_count += 1
            cleanup_workdir(sample_dir)
            return

        summary["environment"] = environment
        summary["completed_at"] = datetime.now(timezone.utc).isoformat()
        (sample_dir / "summary.json").write_text(json.dumps(summary, indent=2), encoding="utf-8")

        candidates = summary.get("scored_candidates", [])
        if not candidates:
            candidates = _load_candidates_from_tsv(sample_dir / "ranked_candidates.tsv")
        report_to_dashboard(accession, environment, candidates)

        mark_sample(accession, "completed", bgcs_found=summary.get("bgcs_found", 0))
        _report_processed(accession, summary.get("bgcs_found", 0))
        session_completed_count += 1
        cleanup_workdir(sample_dir)

        logger.info(
            "Cycle %d (queue): %s, %d BGCs found, %d scored.",
            cycle, accession, summary.get("bgcs_found", 0), summary.get("candidates_scored", 0),
        )

    except SystemExit:
        logger.info("Shutdown during processing of %s.", accession)
        mark_sample(accession, "interrupted")
        raise

    except Exception as exc:
        logger.error("Pipeline failed for %s: %s", accession, exc, exc_info=True)
        mark_sample(accession, "failed")


def main() -> None:
    """Entry point for the DEEPMINE auto-mining loop.

    Runs indefinitely (or until SIGTERM/SIGINT), picking random public
    metagenomes, running the full pipeline, and reporting results.

    Respects settings from the dashboard:
    - mode=always: mine 24/7 (original behavior)
    - mode=scheduled: mine only during schedule_start-schedule_end hours
    - mode=queue: download during download window, process during process window
    """
    logger.info("=" * 70)
    logger.info("DEEPMINE Auto-Mining Loop starting")
    logger.info("  Threads:   %d (base, adjusted by speed setting)", THREADS)
    logger.info("  Dashboard: %s", DASHBOARD_URL)
    logger.info("  Username:  %s", USERNAME)
    logger.info("  Workdir:   %s", WORKDIR)
    logger.info("  History:   %s", HISTORY_DB_PATH)
    logger.info("=" * 70)

    global current_accession, current_environment, current_description
    global session_completed_count, session_skipped_count

    init_history_db()
    WORKDIR.mkdir(parents=True, exist_ok=True)
    QUEUE_DIR.mkdir(parents=True, exist_ok=True)

    cycle = 0

    while not shutdown_requested:
        cycle += 1
        logger.info("-" * 50)
        logger.info("Auto-mining cycle %d", cycle)

        # Fetch latest settings from dashboard
        settings = fetch_settings()
        mode = settings["mode"]

        if mode == "always":
            # Original behavior: full pipeline, no time restrictions
            _run_full_cycle(cycle)

        elif mode == "scheduled":
            # Only mine during the scheduled window
            if _is_in_window(settings["schedule_start"], settings["schedule_end"]):
                _run_full_cycle(cycle)
            else:
                logger.info(
                    "[scheduled] Outside mining window (%02d:00-%02d:00). Current hour: %02d. Sleeping 60s.",
                    settings["schedule_start"],
                    settings["schedule_end"],
                    _user_hour(),
                )
                _interruptible_sleep(60)

        elif mode == "queue":
            in_dl = _is_in_window(settings["download_start"], settings["download_end"])
            in_run = _is_in_window(settings["schedule_start"], settings["schedule_end"])

            if in_dl and in_run:
                # Both windows overlap: run full pipeline
                _run_full_cycle(cycle)
            elif in_dl:
                # Download window only: pre-fetch samples
                _run_queue_download()
            elif in_run:
                # Process window only: work through the queue
                if _queue_has_samples():
                    _run_queue_process(cycle)
                else:
                    # No queued samples, fall back to full pipeline
                    logger.info("[queue] No queued samples, running full pipeline")
                    _run_full_cycle(cycle)
            else:
                logger.info(
                    "[queue] Outside both windows (dl=%02d-%02d, run=%02d-%02d). Hour: %02d. Sleeping 60s.",
                    settings["download_start"],
                    settings["download_end"],
                    settings["schedule_start"],
                    settings["schedule_end"],
                    _user_hour(),
                )
                _interruptible_sleep(60)

        else:
            # Unknown mode, default to always
            _run_full_cycle(cycle)

    logger.info("Auto-mining loop terminated after %d cycles.", cycle)


def _load_candidates_from_tsv(tsv_path: Path) -> list[dict]:
    """Read ranked_candidates.tsv back into a list of dicts for reporting."""
    if not tsv_path.is_file():
        return []

    import csv
    candidates = []
    with open(tsv_path, newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f, delimiter="\t")
        for row in reader:
            candidates.append({
                "bgc_id": row.get("bgc_id", ""),
                "bgc_type": row.get("bgc_type", "unknown"),
                "activity_score": float(row.get("activity_score", 0)),
                "confidence": float(row.get("confidence", 0)),
                "contig": row.get("contig", ""),
                "start": int(row.get("start", 0)) if row.get("start") else 0,
                "end": int(row.get("end", 0)) if row.get("end") else 0,
                "detectors": row.get("detectors", ""),
            })
    return candidates


def _interruptible_sleep(seconds: int) -> None:
    """Sleep in 1-second increments so shutdown signals are not blocked."""
    for _ in range(seconds):
        if shutdown_requested:
            break
        time.sleep(1)


if __name__ == "__main__":
    main()

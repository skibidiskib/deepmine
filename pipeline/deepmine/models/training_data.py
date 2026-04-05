"""
Training data preparation for the DEEPMINE activity scorer.

Builds training datasets from the MIBiG (Minimum Information about a
Biosynthetic Gene cluster) reference database by:

1. Scanning MIBiG GenBank files and extracting Pfam domain sequences plus
   chemical/genomic features for each BGC.
2. Cross-referencing with a curated antimicrobial activity labels CSV to
   assign positive/negative labels.
3. Constructing a domain vocabulary (Pfam ID -> integer index) from all
   observed domains across the training set.

The resulting ``ActivityDataset`` can be directly fed to ``train_model``.
"""

from __future__ import annotations

import csv
import logging
import re
from collections import Counter
from pathlib import Path

from Bio import SeqIO

from deepmine.models.activity_scorer import ActivityDataset, BGCSample

logger = logging.getLogger(__name__)

# Special token indices (must be consistent with activity_scorer.py)
PAD_TOKEN = "<PAD>"
UNK_TOKEN = "<UNK>"
PAD_IDX = 0
UNK_IDX = 1

# Pfam accession regex
_PFAM_RE = re.compile(r"(PF\d{5})")


def build_domain_vocabulary(
    bgc_genbanks: list[Path],
    min_count: int = 2,
) -> dict[str, int]:
    """Build a Pfam domain vocabulary from a collection of BGC GenBank files.

    Scans each GenBank file for CDS features annotated with Pfam domains
    (via ``/sec_met_domain``, ``/db_xref``, or ``/NRPS_PKS`` qualifiers)
    and counts occurrences. Domains appearing fewer than ``min_count`` times
    are mapped to ``<UNK>`` to reduce vocabulary noise from annotation errors.

    Index 0 is reserved for padding (``<PAD>``).

    Args:
        bgc_genbanks: List of paths to GenBank (``.gbk``) files, one per BGC.
        min_count: Minimum number of occurrences for a domain to receive its
            own vocabulary index. Rare domains below this threshold will be
            represented by the ``<UNK>`` token at inference time.

    Returns:
        Dict mapping Pfam ID strings (e.g., ``"PF00109"``) to integer indices.
        Index 0 is reserved for ``<PAD>`` and index 1 for ``<UNK>``.
    """
    domain_counts: Counter[str] = Counter()

    for gbk_path in bgc_genbanks:
        domains = _extract_pfam_domains_from_genbank(gbk_path)
        domain_counts.update(domains)

    # Build vocabulary with reserved special tokens
    vocab: dict[str, int] = {PAD_TOKEN: PAD_IDX, UNK_TOKEN: UNK_IDX}
    idx = 2

    for domain, count in domain_counts.most_common():
        if count >= min_count:
            vocab[domain] = idx
            idx += 1

    logger.info(
        "Built domain vocabulary: %d unique domains (%d passed min_count=%d).",
        len(domain_counts),
        idx - 2,
        min_count,
    )

    return vocab


def build_training_set_from_mibig(
    mibig_dir: Path,
    activity_labels_path: Path,
    domain_vocab: dict[str, int] | None = None,
    min_domain_count: int = 2,
) -> ActivityDataset:
    """Build a training dataset from the MIBiG reference database.

    Scans the MIBiG directory for ``.gbk`` files, reads a CSV of activity
    labels, extracts domain sequences and chemical features from each BGC,
    and returns a ready-to-train ``ActivityDataset``.

    The MIBiG directory may use either a flat layout::

        mibig_dir/
            BGC0000001.gbk
            BGC0000002.gbk
            ...

    Or the standard nested layout::

        mibig_dir/
            BGC0000001/
                BGC0000001.gbk
            BGC0000002/
                BGC0000002.gbk
            ...

    The activity labels CSV must have columns ``bgc_id`` and
    ``antimicrobial_activity`` (1 = active, 0 = inactive)::

        bgc_id,antimicrobial_activity
        BGC0000001,1
        BGC0000002,0
        ...

    BGCs present in the directory but absent from the labels CSV are skipped.

    Args:
        mibig_dir: Path to the MIBiG data directory.
        activity_labels_path: Path to the CSV activity labels file.
        domain_vocab: Pre-built domain vocabulary. If ``None``, a new
            vocabulary is built from the discovered GenBank files.
        min_domain_count: Minimum domain frequency for vocabulary
            construction (only used when ``domain_vocab is None``).

    Returns:
        An ``ActivityDataset`` ready for training with ``train_model``.
    """
    mibig_dir = Path(mibig_dir)
    if not mibig_dir.is_dir():
        raise FileNotFoundError(f"MIBiG directory not found: {mibig_dir}")

    # --- Discover GenBank files ---
    gbk_files: dict[str, Path] = {}

    # Nested layout: mibig_dir/BGC_ID/BGC_ID.gbk
    for subdir in sorted(mibig_dir.iterdir()):
        if subdir.is_dir():
            gbk = subdir / f"{subdir.name}.gbk"
            if gbk.exists():
                gbk_files[subdir.name] = gbk

    # Flat layout: mibig_dir/*.gbk
    for gbk_path in sorted(mibig_dir.glob("*.gbk")):
        bgc_id = gbk_path.stem
        if bgc_id not in gbk_files:
            gbk_files[bgc_id] = gbk_path

    logger.info("Found %d GenBank files in MIBiG directory.", len(gbk_files))

    # --- Load activity labels from CSV ---
    activity_labels: dict[str, float] = {}
    with open(activity_labels_path, "r", newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for row in reader:
            bgc_id = row["bgc_id"].strip()
            label = float(row["antimicrobial_activity"])
            activity_labels[bgc_id] = label

    logger.info("Loaded activity labels for %d BGCs.", len(activity_labels))

    # --- Build vocabulary if not provided ---
    if domain_vocab is None:
        domain_vocab = build_domain_vocabulary(
            list(gbk_files.values()),
            min_count=min_domain_count,
        )

    # --- Build samples ---
    samples: list[BGCSample] = []
    skipped = 0

    for bgc_id, gbk_path in gbk_files.items():
        if bgc_id not in activity_labels:
            skipped += 1
            continue

        label = activity_labels[bgc_id]

        # Extract ordered domain sequence
        raw_domains = _extract_pfam_domains_from_genbank(gbk_path)
        if not raw_domains:
            skipped += 1
            continue

        domain_ids = [domain_vocab.get(d, UNK_IDX) for d in raw_domains]

        # Extract chemical/genomic features
        chemical_features = _extract_chemical_features_from_genbank(gbk_path)

        samples.append(
            BGCSample(
                domain_ids=domain_ids,
                chemical_features=chemical_features,
                label=label,
            )
        )

    pos_count = sum(1 for s in samples if s.label > 0.5)
    neg_count = len(samples) - pos_count

    logger.info(
        "Built training set: %d samples (%d positive, %d negative), %d skipped.",
        len(samples),
        pos_count,
        neg_count,
        skipped,
    )

    return ActivityDataset(samples)


# ===================================================================
# Private helpers
# ===================================================================


def _extract_pfam_domains_from_genbank(gbk_path: Path) -> list[str]:
    """Extract ordered Pfam domain IDs from a GenBank file.

    Parses CDS features and collects Pfam annotations from
    ``/sec_met_domain``, ``/db_xref``, and ``/NRPS_PKS`` qualifiers.
    Domains are returned in genomic order (sorted by CDS start position)
    to preserve biosynthetic colinearity.

    Falls back to regex-based extraction if BioPython parsing fails.
    """
    try:
        return _extract_domains_biopython(gbk_path)
    except Exception:
        return _extract_domains_regex(gbk_path)


def _extract_domains_biopython(gbk_path: Path) -> list[str]:
    """Extract Pfam domains using BioPython's GenBank parser."""
    domains: list[str] = []

    for record in SeqIO.parse(str(gbk_path), "genbank"):
        cds_features = [f for f in record.features if f.type == "CDS"]
        cds_features.sort(key=lambda f: int(f.location.start))

        for feature in cds_features:
            qualifiers = feature.qualifiers

            # /sec_met_domain (antiSMASH style)
            for qual_key in ("sec_met_domain", "sec_met_domains"):
                for value in qualifiers.get(qual_key, []):
                    for match in _PFAM_RE.finditer(value):
                        domains.append(match.group(1))

            # /db_xref="PFAM:PF00109"
            for xref in qualifiers.get("db_xref", []):
                for match in _PFAM_RE.finditer(xref):
                    domains.append(match.group(1))

            # /NRPS_PKS annotations
            for value in qualifiers.get("NRPS_PKS", []):
                for match in _PFAM_RE.finditer(value):
                    domains.append(match.group(1))

    return domains


def _extract_domains_regex(gbk_path: Path) -> list[str]:
    """Fallback: extract Pfam domain accessions via regex over raw text."""
    text = gbk_path.read_text(errors="replace")
    return _PFAM_RE.findall(text)


def _extract_chemical_features_from_genbank(gbk_path: Path) -> list[float]:
    """Extract numerical chemical/genomic features from a single BGC GenBank.

    Uses the same feature set as ``bgc_features.build_feature_matrix`` to
    ensure training and inference produce compatible feature dimensions.

    Returns a fixed-length feature vector (10 elements):
        [0] cluster_length_bp    : Genomic span in base pairs
        [1] gc_content           : GC fraction (0-1)
        [2] n_genes              : Number of CDS features
        [3] n_domains            : Total Pfam domain count
        [4] n_unique_domains     : Number of distinct Pfam domains
        [5] domain_diversity     : n_unique / n_domains (0-1)
        [6] has_nrps             : 1.0 if NRPS marker domains present
        [7] has_pks              : 1.0 if PKS marker domains present
        [8] has_ripp             : 1.0 if RiPP marker domains present
        [9] has_terpene          : 1.0 if terpene marker domains present

    Note: The ``chemical_feature_dim`` stored in the model checkpoint must
    match this vector length. Both training and inference paths must use the
    same feature count.
    """
    text = gbk_path.read_text(errors="replace")

    # Cluster length from LOCUS line
    locus_match = re.search(r"LOCUS\s+\S+\s+(\d+)\s+bp", text)
    cluster_length_bp = int(locus_match.group(1)) if locus_match else 0

    # Gene count
    n_genes = text.count("     CDS ")

    # GC content from ORIGIN sequence block
    gc_content = 0.0
    origin_match = re.search(r"ORIGIN\s*\n(.*?)//", text, re.DOTALL)
    if origin_match:
        seq = re.sub(r"[^acgtACGT]", "", origin_match.group(1))
        if seq:
            gc_count = seq.count("g") + seq.count("G") + seq.count("c") + seq.count("C")
            gc_content = gc_count / len(seq)

    # Domain features
    pfam_domains = _PFAM_RE.findall(text)
    n_domains = len(pfam_domains)
    unique_domains = set(pfam_domains)
    n_unique_domains = len(unique_domains)
    domain_diversity = n_unique_domains / max(n_domains, 1)

    # BGC type indicator features based on known marker Pfam families
    nrps_markers = {"PF00501", "PF00668", "PF07993", "PF00550"}
    pks_markers = {"PF00109", "PF02801", "PF00698", "PF16197"}
    ripp_markers = {"PF00881", "PF05147", "PF04055"}
    terpene_markers = {"PF00494", "PF19086", "PF03936"}

    has_nrps = 1.0 if unique_domains & nrps_markers else 0.0
    has_pks = 1.0 if unique_domains & pks_markers else 0.0
    has_ripp = 1.0 if unique_domains & ripp_markers else 0.0
    has_terpene = 1.0 if unique_domains & terpene_markers else 0.0

    return [
        float(cluster_length_bp),
        gc_content,
        float(n_genes),
        float(n_domains),
        float(n_unique_domains),
        domain_diversity,
        has_nrps,
        has_pks,
        has_ripp,
        has_terpene,
    ]

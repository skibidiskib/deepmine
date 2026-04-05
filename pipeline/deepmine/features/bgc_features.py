"""
Feature extraction from biosynthetic gene clusters (BGCs).

Extracts three categories of features from GenBank-annotated BGC regions:

1. **Domain features**: Pfam domain architecture, including counts of key
   biosynthetic domains (KS, AT, ACP, C, A, T, TE for NRPS/PKS systems)
   and the ordered domain list. This captures the enzymatic assembly line
   layout used by the Transformer encoder.

2. **Chemical features**: Heuristic estimates derived from domain architecture
   rather than direct chemical analysis: predicted molecular weight range
   (from module count), lipophilicity proxies, and ring system predictions
   based on cyclase/aromatase domains.

3. **Genomic context**: Sequence-level descriptors of the BGC region: GC
   content, codon usage bias (RSCU deviation), and functional annotations
   of flanking genes.

All extraction functions accept duck-typed BGC objects (anything with
``.bgc_id``, ``.contig``, ``.start``, ``.end`` attributes), matching
``ConsensusResult`` from ``deepmine.parsers.ensemble``.
"""

from __future__ import annotations

import logging
import re
from collections import Counter
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Sequence

import numpy as np
from Bio import SeqIO
from Bio.SeqRecord import SeqRecord
from Bio.SeqUtils import gc_fraction

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Key biosynthetic domain families tracked as individual features
# ---------------------------------------------------------------------------

BIOSYNTHETIC_DOMAINS: list[str] = [
    "PKS_KS",       # Ketosynthase
    "PKS_AT",       # Acyltransferase
    "ACP",          # Acyl carrier protein
    "PKS_KR",       # Ketoreductase
    "PKS_DH",       # Dehydratase
    "PKS_ER",       # Enoylreductase
    "Condensation",  # NRPS condensation
    "AMP-binding",   # NRPS adenylation
    "PP-binding",    # Thiolation / PCP
    "Thioesterase",  # TE release
    "Epimerization",
    "nMT",           # N-methyltransferase
    "cMT",           # C-methyltransferase
    "oMT",           # O-methyltransferase
    "Heterocyclization",
    "TIGR01720",     # LanB-family lanthipeptide
    "Lant_dehydr_N",
    "Lant_dehydr_C",
    "YcaO",          # Azoline-forming
    "PF00881",       # Nitroreductase-like
]

# Shorthand aliases for matching domain annotations to canonical names
_DOMAIN_ALIASES: dict[str, list[str]] = {
    "PKS_KS": ["PKS_KS", "KS", "ketosynthase", "PF00109", "PF02801"],
    "PKS_AT": ["PKS_AT", "AT", "acyltransferase", "PF00698"],
    "ACP": ["ACP", "PP-binding", "PF00550", "acyl_carrier"],
    "PKS_KR": ["PKS_KR", "KR", "ketoreductase", "PF08659"],
    "PKS_DH": ["PKS_DH", "DH", "dehydratase", "PF00107", "PS-DH"],
    "PKS_ER": ["PKS_ER", "ER", "enoylreductase", "PF13561"],
    "Condensation": ["Condensation", "C", "PF00668"],
    "AMP-binding": ["AMP-binding", "A", "adenylation", "PF00501"],
    "PP-binding": ["PP-binding", "T", "PCP", "PF00550"],
    "Thioesterase": ["Thioesterase", "TE", "PF00975"],
    "Epimerization": ["Epimerization", "E"],
    "nMT": ["nMT", "N-MT", "n-methyltransferase"],
    "cMT": ["cMT", "C-MT", "c-methyltransferase"],
    "oMT": ["oMT", "O-MT", "o-methyltransferase"],
    "Heterocyclization": ["Heterocyclization", "Cy", "heterocyclization"],
}

# Cyclase/aromatase domains that predict ring systems
_CYCLASE_DOMAINS: set[str] = {
    "PF03364", "PF10604", "PF00494",
    "Polyketide_cyc", "Polyketide_cyc2",
    "SnoaL", "SnoaL_2", "SnoaL_3", "SnoaL_4",
}

# Pfam ID regex for extracting accessions from qualifier text
_PFAM_RE = re.compile(r"(PF\d{5})")

# Standard 64 codons for RSCU computation
_STANDARD_CODONS = [
    "TTT", "TTC", "TTA", "TTG", "CTT", "CTC", "CTA", "CTG",
    "ATT", "ATC", "ATA", "ATG", "GTT", "GTC", "GTA", "GTG",
    "TCT", "TCC", "TCA", "TCG", "CCT", "CCC", "CCA", "CCG",
    "ACT", "ACC", "ACA", "ACG", "GCT", "GCC", "GCA", "GCG",
    "TAT", "TAC", "TAA", "TAG", "CAT", "CAC", "CAA", "CAG",
    "AAT", "AAC", "AAA", "AAG", "GAT", "GAC", "GAA", "GAG",
    "TGT", "TGC", "TGA", "TGG", "CGT", "CGC", "CGA", "CGG",
    "AGT", "AGC", "AGA", "AGG", "GGT", "GGC", "GGA", "GGG",
]

# Codon-to-amino-acid mapping (standard bacterial code)
_CODON_TABLE: dict[str, str] = {
    "TTT": "F", "TTC": "F", "TTA": "L", "TTG": "L",
    "CTT": "L", "CTC": "L", "CTA": "L", "CTG": "L",
    "ATT": "I", "ATC": "I", "ATA": "I", "ATG": "M",
    "GTT": "V", "GTC": "V", "GTA": "V", "GTG": "V",
    "TCT": "S", "TCC": "S", "TCA": "S", "TCG": "S",
    "CCT": "P", "CCC": "P", "CCA": "P", "CCG": "P",
    "ACT": "T", "ACC": "T", "ACA": "T", "ACG": "T",
    "GCT": "A", "GCC": "A", "GCA": "A", "GCG": "A",
    "TAT": "Y", "TAC": "Y", "TAA": "*", "TAG": "*",
    "CAT": "H", "CAC": "H", "CAA": "Q", "CAG": "Q",
    "AAT": "N", "AAC": "N", "AAA": "K", "AAG": "K",
    "GAT": "D", "GAC": "D", "GAA": "E", "GAG": "E",
    "TGT": "C", "TGC": "C", "TGA": "*", "TGG": "W",
    "CGT": "R", "CGC": "R", "CGA": "R", "CGG": "R",
    "AGT": "S", "AGC": "S", "AGA": "R", "AGG": "R",
    "GGT": "G", "GGC": "G", "GGA": "G", "GGG": "G",
}

# Keywords for detecting flanking gene functions
_RESISTANCE_KEYWORDS = frozenset({
    "resistance", "beta-lactamase", "efflux", "aminoglycoside",
    "chloramphenicol", "tetracycline", "vancomycin", "macrolide",
    "erm", "mfs_1", "abc_tran",
})
_TRANSPORT_KEYWORDS = frozenset({
    "transporter", "permease", "abc", "mfs", "export", "pump",
    "mate_efflux", "drug_export",
})
_REGULATOR_KEYWORDS = frozenset({
    "regulator", "transcription", "luxr", "tetr", "gntr", "lysr",
    "arac", "marr", "response_regulator", "sigma",
})


@dataclass
class BGCFeatureVector:
    """Container for all extracted features of a single BGC."""

    bgc_id: str
    bgc_type: str
    length_bp: int = 0
    gc_content: float = 0.0
    n_cds: int = 0
    domain_counts: dict[str, int] = field(default_factory=dict)
    domain_order: list[str] = field(default_factory=list)
    total_domains: int = 0
    unique_domains: int = 0
    estimated_mw_min: float = 0.0
    estimated_mw_max: float = 0.0
    estimated_logp: float = 0.0
    estimated_ring_count: int = 0
    codon_usage_bias: float = 0.0
    flanking_resistance: bool = False
    flanking_transport: bool = False
    flanking_regulator: bool = False


# ===================================================================
# Domain feature extraction
# ===================================================================


def extract_domain_features(bgc: Any, genbank_path: Path) -> dict:
    """Extract Pfam domain architecture features from a BGC's GenBank record.

    Parses the GenBank file to find CDS features within the BGC coordinates,
    then tallies occurrences of key biosynthetic domains (KS, AT, ACP, C, A,
    T, TE, etc.) and records domain order for the Transformer encoder.

    Args:
        bgc: Object with ``.bgc_id``, ``.contig``, ``.start``, ``.end``
            attributes (duck-typed, matches ``ConsensusResult``).
        genbank_path: Path to the GenBank file containing this BGC's contig.

    Returns:
        Dict with keys ``domain_counts``, ``domain_order``, ``total_domains``,
        ``unique_domains``, ``n_cds``.
    """
    domain_counts: dict[str, int] = {d: 0 for d in BIOSYNTHETIC_DOMAINS}
    all_domains: list[str] = []

    record = _load_record_for_bgc(bgc, genbank_path)
    if record is None:
        return {
            "domain_counts": domain_counts,
            "domain_order": [],
            "total_domains": 0,
            "unique_domains": 0,
            "n_cds": 0,
        }

    n_cds = 0
    for feat in record.features:
        if feat.type != "CDS":
            continue
        feat_start = int(feat.location.start)
        feat_end = int(feat.location.end)
        if feat_end < bgc.start or feat_start > bgc.end:
            continue

        n_cds += 1
        feat_domains: list[str] = []
        for key in ("domain", "sec_met_domain", "aSDomain", "PFAM_domain", "db_xref"):
            feat_domains.extend(feat.qualifiers.get(key, []))

        for raw_domain in feat_domains:
            # Clean: "PKS_KS (E-value: 1.2e-30)" -> "PKS_KS"
            clean = raw_domain.split("(")[0].strip().split(":")[0].strip()
            all_domains.append(clean)
            for canonical, aliases in _DOMAIN_ALIASES.items():
                if clean in aliases or clean.lower() in [a.lower() for a in aliases]:
                    domain_counts[canonical] = domain_counts.get(canonical, 0) + 1
                    break

    return {
        "domain_counts": domain_counts,
        "domain_order": all_domains,
        "total_domains": len(all_domains),
        "unique_domains": len(set(all_domains)),
        "n_cds": n_cds,
    }


# ===================================================================
# Chemical feature estimation
# ===================================================================


def extract_chemical_features(bgc: Any) -> dict:
    """Estimate chemical properties from BGC type and genomic span.

    Produces rough molecular weight range, lipophilicity (logP) estimate,
    and predicted ring count based on the biosynthetic logic encoded in the
    cluster type. Cyclase domains further refine ring predictions.

    Args:
        bgc: Object with ``.bgc_id``, ``.bgc_type``, ``.start``, ``.end``
            attributes.

    Returns:
        Dict with keys ``estimated_mw_min``, ``estimated_mw_max``,
        ``estimated_logp``, ``estimated_ring_count``.
    """
    bgc_type = getattr(bgc, "bgc_type", "unknown").lower()

    # Base MW range and properties by BGC class
    if "nrps" in bgc_type or "nrp" in bgc_type:
        mw_min, mw_max = 400.0, 2500.0
        logp_base = -0.5
        ring_base = 1
    elif "t1pks" in bgc_type or "pks" in bgc_type or "polyketide" in bgc_type:
        mw_min, mw_max = 300.0, 3000.0
        logp_base = 1.5
        ring_base = 2
    elif "terpene" in bgc_type:
        mw_min, mw_max = 200.0, 800.0
        logp_base = 3.0
        ring_base = 3
    elif "lanthipeptide" in bgc_type or "ripp" in bgc_type:
        mw_min, mw_max = 1000.0, 5000.0
        logp_base = -2.0
        ring_base = 2
    elif "hybrid" in bgc_type or "+" in bgc_type:
        mw_min, mw_max = 500.0, 3500.0
        logp_base = 0.5
        ring_base = 3
    else:
        mw_min, mw_max = 200.0, 2000.0
        logp_base = 0.0
        ring_base = 1

    # Scale by cluster size (larger clusters tend to produce larger molecules)
    size_bp = bgc.end - bgc.start
    size_factor = min(size_bp / 50000.0, 3.0)
    mw_min *= max(0.5, size_factor * 0.5)
    mw_max *= min(3.0, size_factor * 1.2)

    ring_count = ring_base
    if "heterocycl" in bgc_type:
        ring_count += 2

    return {
        "estimated_mw_min": round(mw_min, 1),
        "estimated_mw_max": round(mw_max, 1),
        "estimated_logp": round(logp_base, 2),
        "estimated_ring_count": ring_count,
    }


# ===================================================================
# Genomic context extraction
# ===================================================================


def extract_genomic_context(bgc: Any, genbank_path: Path) -> dict:
    """Extract genomic context features from the BGC and its flanking regions.

    Computes GC content of the BGC region, codon usage bias (chi-squared
    deviation from whole-contig average), and flags for resistance,
    transporter, and regulatory genes in the 5 kb flanking regions.

    Args:
        bgc: Object with ``.bgc_id``, ``.contig``, ``.start``, ``.end``
            attributes.
        genbank_path: Path to the GenBank file containing this BGC's contig.

    Returns:
        Dict with keys ``gc_content``, ``codon_usage_bias``,
        ``flanking_resistance``, ``flanking_transport``,
        ``flanking_regulator``, ``flanking_gene_functions``.
    """
    record = _load_record_for_bgc(bgc, genbank_path)
    if record is None:
        return _empty_genomic_context()

    seq = record.seq
    bgc_start = max(0, bgc.start)
    bgc_end = min(len(seq), bgc.end)
    bgc_seq = seq[bgc_start:bgc_end]

    # GC content
    gc = gc_fraction(bgc_seq) if len(bgc_seq) > 0 else 0.0

    # Codon usage bias: compare BGC region to whole contig
    bgc_codon_freq = _codon_frequencies(str(bgc_seq))
    contig_codon_freq = _codon_frequencies(str(seq))
    bias = _chi_squared_codon_bias(bgc_codon_freq, contig_codon_freq)

    # Flanking gene analysis (5 kb on each side)
    flank_bp = 5000
    flank_start = max(0, bgc_start - flank_bp)
    flank_end = min(len(seq), bgc_end + flank_bp)

    resistance = False
    transport = False
    regulator = False
    flanking_functions: list[str] = []

    for feat in record.features:
        if feat.type != "CDS":
            continue
        feat_start = int(feat.location.start)
        feat_end = int(feat.location.end)

        in_flank = (
            (flank_start <= feat_start < bgc_start)
            or (bgc_end < feat_end <= flank_end)
        )
        if not in_flank:
            continue

        product = feat.qualifiers.get("product", ["unknown"])[0]
        flanking_functions.append(product)

        annotation = " ".join(
            feat.qualifiers.get("product", [])
            + feat.qualifiers.get("function", [])
            + feat.qualifiers.get("note", [])
        ).lower()
        domain_annots = " ".join(
            feat.qualifiers.get("domain", [])
            + feat.qualifiers.get("PFAM_domain", [])
        ).lower()
        combined = annotation + " " + domain_annots

        if any(kw in combined for kw in _RESISTANCE_KEYWORDS):
            resistance = True
        if any(kw in combined for kw in _TRANSPORT_KEYWORDS):
            transport = True
        if any(kw in combined for kw in _REGULATOR_KEYWORDS):
            regulator = True

    return {
        "gc_content": round(float(gc), 4),
        "codon_usage_bias": round(bias, 4),
        "flanking_resistance": resistance,
        "flanking_transport": transport,
        "flanking_regulator": regulator,
        "flanking_gene_functions": flanking_functions,
    }


def _empty_genomic_context() -> dict:
    return {
        "gc_content": 0.0,
        "codon_usage_bias": 0.0,
        "flanking_resistance": False,
        "flanking_transport": False,
        "flanking_regulator": False,
        "flanking_gene_functions": [],
    }


# ===================================================================
# Feature matrix construction
# ===================================================================


def build_feature_matrix(
    bgcs: list[Any],
    genbank_dir: Path,
) -> tuple[np.ndarray, list[str], list[str]]:
    """Build a numeric feature matrix from a list of BGC objects.

    For each BGC, locates the corresponding GenBank file in ``genbank_dir``
    (matching by contig name), extracts domain, chemical, and genomic
    context features, and assembles them into a single row.

    Args:
        bgcs: List of objects with ``.bgc_id``, ``.contig``, ``.start``,
            ``.end`` attributes (e.g., ``ConsensusResult`` instances).
        genbank_dir: Directory containing GenBank (``.gbk`` / ``.gbff``)
            files.

    Returns:
        Tuple of ``(feature_matrix, feature_names, bgc_ids)`` where:
            - ``feature_matrix``: numpy array of shape ``(n_bgcs, n_features)``
            - ``feature_names``: ordered list of feature column names
            - ``bgc_ids``: list of BGC identifiers in row order
    """
    genbank_dir = Path(genbank_dir)
    gbk_index = _index_genbank_dir(genbank_dir)

    feature_names = (
        ["length_bp", "gc_content", "n_cds", "total_domains", "unique_domains"]
        + [f"domain_{d}" for d in BIOSYNTHETIC_DOMAINS]
        + [
            "estimated_mw_min",
            "estimated_mw_max",
            "estimated_logp",
            "estimated_ring_count",
            "codon_usage_bias",
            "flanking_resistance",
            "flanking_transport",
            "flanking_regulator",
        ]
    )

    rows: list[list[float]] = []
    bgc_ids: list[str] = []

    for bgc in bgcs:
        gbk_path = _find_genbank_for_contig(bgc.contig, gbk_index, genbank_dir)

        if gbk_path is None:
            logger.warning(
                "No GenBank file found for BGC %s (contig=%s), using empty features.",
                bgc.bgc_id,
                bgc.contig,
            )

        domain_feats = extract_domain_features(bgc, gbk_path) if gbk_path else {
            "domain_counts": {d: 0 for d in BIOSYNTHETIC_DOMAINS},
            "domain_order": [],
            "total_domains": 0,
            "unique_domains": 0,
            "n_cds": 0,
        }
        chem_feats = extract_chemical_features(bgc)
        context_feats = extract_genomic_context(bgc, gbk_path) if gbk_path else _empty_genomic_context()

        row: list[float] = [
            float(bgc.end - bgc.start),
            context_feats["gc_content"],
            float(domain_feats["n_cds"]),
            float(domain_feats["total_domains"]),
            float(domain_feats["unique_domains"]),
        ]
        domain_counts = domain_feats["domain_counts"]
        for d in BIOSYNTHETIC_DOMAINS:
            row.append(float(domain_counts.get(d, 0)))

        row.extend([
            chem_feats["estimated_mw_min"],
            chem_feats["estimated_mw_max"],
            chem_feats["estimated_logp"],
            float(chem_feats["estimated_ring_count"]),
            context_feats["codon_usage_bias"],
            float(context_feats["flanking_resistance"]),
            float(context_feats["flanking_transport"]),
            float(context_feats["flanking_regulator"]),
        ])

        rows.append(row)
        bgc_ids.append(bgc.bgc_id)

    if rows:
        matrix = np.array(rows, dtype=np.float64)
    else:
        matrix = np.empty((0, len(feature_names)), dtype=np.float64)

    return matrix, feature_names, bgc_ids


# ===================================================================
# Internal helpers
# ===================================================================


def _load_record_for_bgc(bgc: Any, genbank_path: Path | None) -> SeqRecord | None:
    """Load the SeqRecord matching a BGC's contig from a GenBank file."""
    if genbank_path is None or not genbank_path.exists():
        return None
    try:
        first_record = None
        for record in SeqIO.parse(str(genbank_path), "genbank"):
            if first_record is None:
                first_record = record
            if record.id == bgc.contig or record.name == bgc.contig:
                return record
        # Fallback: return first record (single-contig files)
        return first_record
    except Exception as exc:
        logger.warning("Failed to load GenBank %s: %s", genbank_path, exc)
        return None


def _index_genbank_dir(genbank_dir: Path) -> dict[str, Path]:
    """Build a mapping from record ID/name to GenBank file path."""
    index: dict[str, Path] = {}
    for gbk_path in genbank_dir.glob("**/*.gb*"):
        try:
            for record in SeqIO.parse(str(gbk_path), "genbank"):
                index[record.id] = gbk_path
                index[record.name] = gbk_path
        except Exception:
            continue
    return index


def _find_genbank_for_contig(
    contig: str,
    index: dict[str, Path],
    genbank_dir: Path,
) -> Path | None:
    """Find the GenBank file containing a given contig."""
    if contig in index:
        return index[contig]
    # Fallback: try matching by filename stem
    for gbk_path in genbank_dir.glob("**/*.gb*"):
        if contig in gbk_path.stem:
            return gbk_path
    return None


def _codon_frequencies(seq: str) -> dict[str, float]:
    """Compute relative codon frequencies from a nucleotide sequence."""
    seq = seq.upper().replace("U", "T")
    counts: Counter[str] = Counter()
    total = 0
    for i in range(0, len(seq) - 2, 3):
        codon = seq[i : i + 3]
        if len(codon) == 3 and all(c in "ACGT" for c in codon):
            counts[codon] += 1
            total += 1
    if total == 0:
        return {c: 1.0 / 64 for c in _STANDARD_CODONS}
    return {c: counts.get(c, 0) / total for c in _STANDARD_CODONS}


def _chi_squared_codon_bias(
    observed: dict[str, float],
    expected: dict[str, float],
) -> float:
    """Compute a chi-squared statistic measuring codon usage deviation."""
    chi2 = 0.0
    for codon in _STANDARD_CODONS:
        obs = observed.get(codon, 0.0)
        exp = expected.get(codon, 1.0 / 64)
        if exp > 0:
            chi2 += (obs - exp) ** 2 / exp
    return chi2

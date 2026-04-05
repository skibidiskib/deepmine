from __future__ import annotations

import csv
import logging
from dataclasses import dataclass, field
from pathlib import Path
from typing import Sequence

from Bio import SeqIO

logger = logging.getLogger(__name__)


@dataclass
class DeepBGCResult:
    bgc_id: str
    contig: str
    start: int
    end: int
    bgc_type: str
    product_class: str
    deepbgc_score: float = 0.0
    product_activity: str = ""
    domains: list[str] = field(default_factory=list)
    nucl_sequence: str = ""


def parse_deepbgc_output(output_dir: Path) -> list[DeepBGCResult]:
    """Parse a DeepBGC output directory and return detected BGC clusters.

    Reads both the TSV summary (``*.bgc.tsv``) for coordinates/scores and
    the GenBank files (``*.bgc.gbk``) for domain annotations and nucleotide
    sequences. If only one format is available the parser still returns
    results from whichever is present.
    """
    output_dir = Path(output_dir)
    results_from_tsv = _parse_tsv_files(output_dir)
    results_from_gbk = _parse_gbk_files(output_dir)

    # Merge: TSV is the primary source; enrich with GBK domain/sequence data
    gbk_index: dict[str, DeepBGCResult] = {}
    for r in results_from_gbk:
        gbk_index[r.bgc_id] = r
        # Also index by contig+coords for fuzzy matching
        gbk_index[f"{r.contig}:{r.start}-{r.end}"] = r

    merged: list[DeepBGCResult] = []
    seen_ids: set[str] = set()

    for tsv_result in results_from_tsv:
        gbk_match = gbk_index.get(tsv_result.bgc_id) or gbk_index.get(
            f"{tsv_result.contig}:{tsv_result.start}-{tsv_result.end}"
        )
        if gbk_match:
            if not tsv_result.domains:
                tsv_result.domains = gbk_match.domains
            if not tsv_result.nucl_sequence:
                tsv_result.nucl_sequence = gbk_match.nucl_sequence
        merged.append(tsv_result)
        seen_ids.add(tsv_result.bgc_id)

    # Add any GBK-only results not already covered by TSV
    for r in results_from_gbk:
        if r.bgc_id not in seen_ids:
            merged.append(r)
            seen_ids.add(r.bgc_id)

    return merged


def _parse_tsv_files(output_dir: Path) -> list[DeepBGCResult]:
    """Parse DeepBGC ``*.bgc.tsv`` summary files."""
    results: list[DeepBGCResult] = []
    tsv_files = sorted(output_dir.glob("*.bgc.tsv"))
    if not tsv_files:
        tsv_files = sorted(output_dir.glob("**/*.bgc.tsv"))

    for tsv_path in tsv_files:
        try:
            text = tsv_path.read_text(encoding="utf-8")
        except OSError as exc:
            logger.warning("Cannot read %s: %s", tsv_path, exc)
            continue

        reader = csv.DictReader(text.splitlines(), delimiter="\t")
        headers = set(reader.fieldnames or [])

        for row_num, row in enumerate(reader, start=2):
            try:
                bgc_id = _pick(row, headers, ["bgc_id", "cluster_id", "BGC_ID"], f"deepbgc_{tsv_path.stem}_{row_num}")
                contig = _pick(row, headers, ["sequence_id", "contig_id", "contig", "nucl_accession"], "")
                start = int(_pick(row, headers, ["nucl_start", "start", "bgc_start"], "0"))
                end = int(_pick(row, headers, ["nucl_end", "end", "bgc_end"], "0"))
                bgc_type = _pick(row, headers, ["product_class", "predicted_class", "type", "bgc_type"], "unknown")
                score = float(_pick(row, headers, ["deepbgc_score", "score", "confidence"], "0"))
                activity = _pick(row, headers, ["product_activity", "activity", "antibacterial_prediction"], "")

                domain_str = _pick(row, headers, ["pfam_ids", "domains", "domain_annotations"], "")
                domains = [d.strip() for d in domain_str.split(";") if d.strip()]

                product_class = _normalise_class(bgc_type)

                results.append(
                    DeepBGCResult(
                        bgc_id=bgc_id,
                        contig=contig,
                        start=start,
                        end=end,
                        bgc_type=bgc_type,
                        product_class=product_class,
                        deepbgc_score=score,
                        product_activity=activity,
                        domains=domains,
                    )
                )
            except (ValueError, KeyError) as exc:
                logger.warning("Skipping malformed DeepBGC TSV row %d in %s: %s", row_num, tsv_path, exc)
                continue

    return results


def _parse_gbk_files(output_dir: Path) -> list[DeepBGCResult]:
    """Extract BGC records from DeepBGC ``*.bgc.gbk`` GenBank files."""
    results: list[DeepBGCResult] = []
    gbk_files = sorted(output_dir.glob("*.bgc.gbk"))
    if not gbk_files:
        gbk_files = sorted(output_dir.glob("**/*.bgc.gbk"))

    for gbk_path in gbk_files:
        try:
            for record in SeqIO.parse(str(gbk_path), "genbank"):
                cluster_features = [
                    f for f in record.features if f.type in ("cluster", "protocluster", "region", "misc_feature")
                ]
                if not cluster_features:
                    # Treat the entire record as one BGC
                    cluster_features = [_whole_record_feature(record)]

                for idx, feat in enumerate(cluster_features, start=1):
                    start = int(feat.location.start)
                    end = int(feat.location.end)
                    qualifiers = feat.qualifiers

                    bgc_id = _first_qualifier(qualifiers, ["cluster_id", "bgc_id", "note"], f"{record.id}_cluster{idx}")
                    bgc_type = _first_qualifier(qualifiers, ["product", "product_class", "predicted_class"], "unknown")
                    activity = _first_qualifier(qualifiers, ["product_activity", "antibacterial"], "")
                    score = _safe_float(_first_qualifier(qualifiers, ["deepbgc_score", "score", "confidence"], "0"))

                    domains = _extract_domains_from_record(record, start, end)
                    nucl_seq = str(record.seq[start:end]) if record.seq else ""

                    results.append(
                        DeepBGCResult(
                            bgc_id=bgc_id,
                            contig=record.id,
                            start=start,
                            end=end,
                            bgc_type=bgc_type,
                            product_class=_normalise_class(bgc_type),
                            deepbgc_score=score,
                            product_activity=activity,
                            domains=domains,
                            nucl_sequence=nucl_seq,
                        )
                    )
        except Exception as exc:
            logger.warning("Error parsing %s: %s", gbk_path, exc)
            continue

    return results


def _extract_domains_from_record(record, start: int, end: int) -> list[str]:
    """Collect Pfam/domain annotations from CDS features within a coordinate range."""
    domains: list[str] = []
    for feat in record.features:
        if feat.type != "CDS":
            continue
        feat_start = int(feat.location.start)
        feat_end = int(feat.location.end)
        # Check overlap with BGC region
        if feat_end < start or feat_start > end:
            continue
        for key in ("domain", "sec_met_domain", "aSDomain", "PFAM_domain"):
            vals = feat.qualifiers.get(key, [])
            domains.extend(vals)
    return domains


class _SyntheticFeature:
    """Minimal stand-in when we need to treat a full record as one feature."""

    def __init__(self, start: int, end: int, qualifiers: dict):
        self.location = type("Loc", (), {"start": start, "end": end})()
        self.qualifiers = qualifiers
        self.type = "region"


def _whole_record_feature(record) -> _SyntheticFeature:
    return _SyntheticFeature(
        start=0,
        end=len(record.seq) if record.seq else 0,
        qualifiers={},
    )


def _first_qualifier(qualifiers: dict, keys: Sequence[str], default: str) -> str:
    for key in keys:
        vals = qualifiers.get(key, [])
        if vals:
            return vals[0]
    return default


def _pick(row: dict, headers: set[str], candidates: list[str], default: str) -> str:
    for c in candidates:
        if c in headers and row.get(c):
            return row[c]
    return default


def _safe_float(val: str) -> float:
    try:
        return float(val)
    except (ValueError, TypeError):
        return 0.0


def _normalise_class(bgc_type: str) -> str:
    t = bgc_type.lower()
    if "nrp" in t:
        return "NRP"
    if "polyketide" in t or "pks" in t:
        return "Polyketide"
    if "terpene" in t:
        return "Terpene"
    if "ripp" in t or "lanthipeptide" in t or "bacteriocin" in t:
        return "RiPP"
    if "saccharide" in t:
        return "Saccharide"
    return "Unknown"

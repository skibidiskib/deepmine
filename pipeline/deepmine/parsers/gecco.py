from __future__ import annotations

import csv
import logging
from dataclasses import dataclass, field
from pathlib import Path

logger = logging.getLogger(__name__)


@dataclass
class GeccoResult:
    bgc_id: str
    contig: str
    start: int
    end: int
    bgc_type: str
    product_class: str
    domains: list[str] = field(default_factory=list)
    average_p: float = 0.0
    max_p: float = 0.0


def parse_gecco_output(tsv_path: Path) -> list[GeccoResult]:
    """Parse a GECCO cluster prediction TSV and return structured BGC results.

    Reads the clusters TSV file produced by ``gecco run`` (typically named
    ``<prefix>.clusters.tsv``). Each row describes one predicted BGC cluster
    with its genomic coordinates, predicted type, domain annotations, and
    posterior probabilities.
    """
    tsv_path = Path(tsv_path)
    results: list[GeccoResult] = []

    try:
        text = tsv_path.read_text(encoding="utf-8")
    except OSError as exc:
        logger.error("Cannot read GECCO output %s: %s", tsv_path, exc)
        return results

    reader = csv.DictReader(text.splitlines(), delimiter="\t")

    # Normalise header names: GECCO versions vary between snake_case and
    # camelCase, and between "cluster_id" and "bgc_id".
    field_map = _build_field_map(reader.fieldnames or [])

    for row_num, row in enumerate(reader, start=2):
        try:
            bgc_id = _get(row, field_map, "bgc_id", fallback=f"gecco_bgc_{row_num}")
            contig = _get(row, field_map, "sequence_id", fallback="")
            start = int(_get(row, field_map, "start", fallback="0"))
            end = int(_get(row, field_map, "end", fallback="0"))
            bgc_type = _get(row, field_map, "type", fallback="unknown")
            product_class = _normalise_product_class(bgc_type)

            domain_str = _get(row, field_map, "domains", fallback="")
            domains = [d.strip() for d in domain_str.split(";") if d.strip()]

            average_p = float(_get(row, field_map, "average_p", fallback="0"))
            max_p = float(_get(row, field_map, "max_p", fallback="0"))

            results.append(
                GeccoResult(
                    bgc_id=bgc_id,
                    contig=contig,
                    start=start,
                    end=end,
                    bgc_type=bgc_type,
                    product_class=product_class,
                    domains=domains,
                    average_p=average_p,
                    max_p=max_p,
                )
            )
        except (ValueError, KeyError) as exc:
            logger.warning("Skipping malformed GECCO row %d: %s", row_num, exc)
            continue

    return results


_COLUMN_ALIASES: dict[str, list[str]] = {
    "bgc_id": ["bgc_id", "cluster_id", "BGC_Id", "clusterId", "id"],
    "sequence_id": ["sequence_id", "sequenceId", "contig", "contig_id", "seqid", "seq_id"],
    "start": ["start", "bgc_start", "Start"],
    "end": ["end", "bgc_end", "End"],
    "type": ["type", "bgc_type", "Type", "product_type", "predicted_class"],
    "domains": ["domains", "domain_annotations", "pfam_domains", "Domains"],
    "average_p": ["average_p", "avg_p", "average_probability", "avgP", "p_avg"],
    "max_p": ["max_p", "maximum_p", "max_probability", "maxP", "p_max"],
}


def _build_field_map(headers: list[str]) -> dict[str, str]:
    """Map canonical field names to actual column headers present in the file."""
    header_set = set(headers)
    mapping: dict[str, str] = {}
    for canonical, aliases in _COLUMN_ALIASES.items():
        for alias in aliases:
            if alias in header_set:
                mapping[canonical] = alias
                break
    return mapping


def _get(row: dict, field_map: dict[str, str], canonical: str, fallback: str) -> str:
    actual = field_map.get(canonical)
    if actual is None:
        return fallback
    return row.get(actual, fallback)


def _normalise_product_class(bgc_type: str) -> str:
    """Map GECCO BGC type strings to broad product classes."""
    t = bgc_type.lower().strip()
    if "nrp" in t or "nrps" in t:
        return "NRP"
    if "polyketide" in t or "pks" in t or "t1pks" in t or "t2pks" in t:
        return "Polyketide"
    if "terpene" in t:
        return "Terpene"
    if "ripp" in t or "lanthipeptide" in t or "bacteriocin" in t:
        return "RiPP"
    if "saccharide" in t:
        return "Saccharide"
    if "alkaloid" in t:
        return "Alkaloid"
    return "Unknown"

from __future__ import annotations

import json
import logging
from dataclasses import dataclass, field
from pathlib import Path

logger = logging.getLogger(__name__)


@dataclass
class AntiSmashResult:
    bgc_id: str
    contig: str
    start: int
    end: int
    bgc_type: str
    product_class: str
    domains: list[str] = field(default_factory=list)
    smiles_prediction: str | None = None


def parse_antismash_dir(output_dir: Path) -> list[AntiSmashResult]:
    """Parse an antiSMASH output directory and extract all detected BGC regions.

    Supports both antiSMASH 6.x and 7.x JSON output formats. Looks for the
    top-level JSON result files (one per input sequence record) and extracts
    region annotations including type, product class, domain architecture, and
    any SMILES predictions from the NRPS/PKS module.
    """
    output_dir = Path(output_dir)
    results: list[AntiSmashResult] = []

    json_files = sorted(output_dir.glob("*.json"))
    if not json_files:
        # antiSMASH 7.x sometimes nests output one level deeper
        json_files = sorted(output_dir.glob("*/*.json"))

    for json_path in json_files:
        if json_path.name in ("index.json", "regions.json", "knownclusterblast.json"):
            continue

        try:
            data = json.loads(json_path.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError) as exc:
            logger.warning("Skipping %s: %s", json_path, exc)
            continue

        records = _extract_records(data)
        for record in records:
            record_id = record.get("id", json_path.stem)
            regions = _extract_regions(record)
            for idx, region in enumerate(regions, start=1):
                bgc_id = f"{record_id}.region{idx:03d}"
                start = region.get("start", region.get("location", {}).get("start", 0))
                end = region.get("end", region.get("location", {}).get("end", 0))

                bgc_type, product_class = _classify_region(region)
                domains = _collect_domains(region)
                smiles = _extract_smiles(region)

                results.append(
                    AntiSmashResult(
                        bgc_id=bgc_id,
                        contig=record_id,
                        start=int(start),
                        end=int(end),
                        bgc_type=bgc_type,
                        product_class=product_class,
                        domains=domains,
                        smiles_prediction=smiles,
                    )
                )

    return results


def _extract_records(data: dict) -> list[dict]:
    """Return the list of sequence records from the top-level JSON, handling
    both antiSMASH 6.x (flat list under 'records') and 7.x (nested under
    'results' or directly as a list)."""
    if "records" in data:
        return data["records"]
    if "results" in data:
        results = data["results"]
        if isinstance(results, list):
            return results
        if isinstance(results, dict):
            return list(results.values())
    # Single-record files (antiSMASH 7.x minimal output)
    if "id" in data and ("regions" in data or "areas" in data or "subregions" in data):
        return [data]
    return []


def _extract_regions(record: dict) -> list[dict]:
    """Pull region annotations from a record. antiSMASH 6.x uses 'regions'
    while 7.x uses 'areas' with a nested 'regions' key."""
    if "regions" in record:
        return record["regions"]
    if "areas" in record:
        areas = record["areas"]
        regions: list[dict] = []
        for area in areas:
            if "regions" in area:
                regions.extend(area["regions"])
            else:
                regions.append(area)
        return regions
    # Fallback: look inside features for region qualifiers
    features = record.get("features", [])
    return [f for f in features if f.get("type") == "region"]


def _classify_region(region: dict) -> tuple[str, str]:
    """Return (bgc_type, product_class) from region annotation."""
    # antiSMASH 6.x
    if "product" in region:
        products = region["product"]
        if isinstance(products, list):
            bgc_type = "+".join(products)
        else:
            bgc_type = str(products)
    elif "type" in region and region["type"] != "region":
        bgc_type = region["type"]
    else:
        bgc_type = "unknown"

    product_class = region.get("category", region.get("product_class", ""))
    if not product_class and "qualifiers" in region:
        product_class = region["qualifiers"].get("product", [""])[0]

    # Normalize common BGC type strings
    type_to_class: dict[str, str] = {
        "nrps": "NRP",
        "t1pks": "Polyketide",
        "t2pks": "Polyketide",
        "t3pks": "Polyketide",
        "transatpks": "Polyketide",
        "terpene": "Terpene",
        "lanthipeptide": "RiPP",
        "thiopeptide": "RiPP",
        "sactipeptide": "RiPP",
        "bacteriocin": "RiPP",
        "lassopeptide": "RiPP",
        "arylpolyene": "Other",
        "siderophore": "NRP",
    }
    if not product_class:
        for key, cls in type_to_class.items():
            if key in bgc_type.lower():
                product_class = cls
                break
        else:
            product_class = "Unknown"

    return bgc_type, product_class


def _collect_domains(region: dict) -> list[str]:
    """Extract biosynthetic domain identifiers from a region."""
    domains: list[str] = []

    # antiSMASH 6.x: 'domains' or nested in 'cds_features'
    if "domains" in region:
        for dom in region["domains"]:
            if isinstance(dom, dict):
                domains.append(dom.get("name", dom.get("type", "unknown")))
            else:
                domains.append(str(dom))

    for cds in region.get("cds_features", region.get("cdses", [])):
        for dom in cds.get("domains", []):
            if isinstance(dom, dict):
                domains.append(dom.get("name", dom.get("type", "unknown")))
            else:
                domains.append(str(dom))

    # antiSMASH 7.x: 'modules' list with domain architecture
    for module in region.get("modules", []):
        for dom in module.get("domains", []):
            if isinstance(dom, dict):
                domains.append(dom.get("name", dom.get("type", "unknown")))
            else:
                domains.append(str(dom))

    return domains


def _extract_smiles(region: dict) -> str | None:
    """Return a predicted SMILES string if present in the region annotation."""
    # Direct SMILES field
    if "smiles" in region:
        return region["smiles"] or None

    # NRPS/PKS module predictions
    for module in region.get("modules", region.get("nrps_pks_modules", [])):
        if "smiles" in module:
            return module["smiles"]

    # Qualifiers-based (GenBank-derived JSON)
    qualifiers = region.get("qualifiers", {})
    smiles_list = qualifiers.get("SMILES", [])
    if smiles_list:
        return smiles_list[0]

    return None

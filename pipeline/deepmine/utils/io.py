"""
I/O utilities for the DEEPMINE pipeline.

Handles configuration loading, bioinformatics file parsing (GenBank, GFF),
and structured output writing for candidate BGC results.
"""

from __future__ import annotations

import json
import logging
from pathlib import Path
from typing import Any

import pandas as pd
import yaml
from Bio import SeqIO
from Bio.SeqRecord import SeqRecord

logger = logging.getLogger(__name__)


def load_config(path: str | Path) -> dict[str, Any]:
    """Load a YAML configuration file and return it as a dictionary.

    Parameters
    ----------
    path : str or Path
        Path to the YAML configuration file (typically ``config/config.yaml``).

    Returns
    -------
    dict[str, Any]
        Parsed configuration dictionary.

    Raises
    ------
    FileNotFoundError
        If the configuration file does not exist.
    yaml.YAMLError
        If the file contains invalid YAML.
    """
    path = Path(path)
    if not path.exists():
        raise FileNotFoundError(f"Configuration file not found: {path}")

    with open(path, "r", encoding="utf-8") as fh:
        try:
            config = yaml.safe_load(fh)
        except yaml.YAMLError as exc:
            logger.error("Failed to parse YAML config at %s: %s", path, exc)
            raise

    if config is None:
        logger.warning("Configuration file %s is empty, returning empty dict", path)
        return {}

    logger.info("Loaded configuration from %s (%d top-level keys)", path, len(config))
    return config


def parse_genbank(path: str | Path) -> list[SeqRecord]:
    """Parse a GenBank (.gbk / .gbff) file into a list of SeqRecord objects.

    This is the primary format output by antiSMASH for detected BGC regions.

    Parameters
    ----------
    path : str or Path
        Path to the GenBank file.

    Returns
    -------
    list[SeqRecord]
        List of BioPython SeqRecord objects, one per record in the file.

    Raises
    ------
    FileNotFoundError
        If the GenBank file does not exist.
    ValueError
        If the file contains no valid GenBank records.
    """
    path = Path(path)
    if not path.exists():
        raise FileNotFoundError(f"GenBank file not found: {path}")

    records: list[SeqRecord] = []
    with open(path, "r", encoding="utf-8") as fh:
        for record in SeqIO.parse(fh, "genbank"):
            records.append(record)

    if not records:
        raise ValueError(f"No GenBank records found in {path}")

    logger.info("Parsed %d GenBank record(s) from %s", len(records), path)
    return records


def parse_gff(path: str | Path) -> pd.DataFrame:
    """Parse a GFF3 annotation file into a pandas DataFrame.

    Handles comment lines (starting with ``#``) and the standard 9-column GFF3
    format. The ``attributes`` column is kept as a raw string; use
    :func:`_parse_gff_attributes` to expand it into individual fields.

    Parameters
    ----------
    path : str or Path
        Path to the GFF3 file.

    Returns
    -------
    pd.DataFrame
        DataFrame with columns: seqid, source, type, start, end, score, strand,
        phase, attributes. Coordinates are 1-based inclusive as per GFF3 spec.

    Raises
    ------
    FileNotFoundError
        If the GFF file does not exist.
    ValueError
        If the file contains no data rows.
    """
    path = Path(path)
    if not path.exists():
        raise FileNotFoundError(f"GFF file not found: {path}")

    column_names = [
        "seqid",
        "source",
        "type",
        "start",
        "end",
        "score",
        "strand",
        "phase",
        "attributes",
    ]

    df = pd.read_csv(
        path,
        sep="\t",
        comment="#",
        header=None,
        names=column_names,
        dtype={
            "seqid": str,
            "source": str,
            "type": str,
            "start": "Int64",
            "end": "Int64",
            "score": str,
            "strand": str,
            "phase": str,
            "attributes": str,
        },
        na_values=["."],
        low_memory=False,
    )

    if df.empty:
        raise ValueError(f"No data rows found in GFF file: {path}")

    # Convert score to numeric where possible (GFF allows '.' for missing)
    df["score"] = pd.to_numeric(df["score"], errors="coerce")

    logger.info("Parsed GFF file %s: %d features across %d sequences", path, len(df), df["seqid"].nunique())
    return df


def _parse_gff_attributes(attr_string: str) -> dict[str, str]:
    """Parse a single GFF3 attributes string into a key-value dictionary.

    GFF3 attributes are semicolon-delimited ``key=value`` pairs, e.g.
    ``ID=gene001;Name=bpsA;product=blue pigment synthetase``.

    Parameters
    ----------
    attr_string : str
        Raw attributes string from column 9 of a GFF3 line.

    Returns
    -------
    dict[str, str]
        Parsed attribute key-value pairs.
    """
    if pd.isna(attr_string) or not attr_string.strip():
        return {}

    attrs: dict[str, str] = {}
    for pair in attr_string.strip().rstrip(";").split(";"):
        if "=" in pair:
            key, value = pair.split("=", maxsplit=1)
            attrs[key.strip()] = value.strip()
    return attrs


def write_results(candidates: list[dict[str, Any]], output_path: str | Path) -> None:
    """Write candidate BGC results as both JSON (full detail) and TSV (summary).

    Produces two files:
      - ``{output_path}.json``: Full candidate data with all fields.
      - ``{output_path}.tsv``: Tab-separated summary with key columns for quick review.

    Parameters
    ----------
    candidates : list[dict[str, Any]]
        List of candidate dictionaries. Expected keys include (but are not limited to):
        ``bgc_id``, ``contig``, ``start``, ``end``, ``bgc_type``, ``score``,
        ``novelty_distance``, ``detection_tools``, ``product_smiles``.
    output_path : str or Path
        Base path for output files (extensions are appended automatically).

    Raises
    ------
    ValueError
        If candidates list is empty.
    """
    if not candidates:
        raise ValueError("No candidates to write. Pipeline produced zero results.")

    output_path = Path(output_path)
    output_path.parent.mkdir(parents=True, exist_ok=True)

    # Full JSON output
    json_path = output_path.with_suffix(".json")
    with open(json_path, "w", encoding="utf-8") as fh:
        json.dump(
            {
                "pipeline": "deepmine",
                "version": "0.1.0",
                "total_candidates": len(candidates),
                "candidates": candidates,
            },
            fh,
            indent=2,
            default=str,
        )
    logger.info("Wrote %d candidates to %s", len(candidates), json_path)

    # TSV summary for quick inspection
    summary_columns = [
        "bgc_id",
        "contig",
        "start",
        "end",
        "bgc_type",
        "score",
        "novelty_distance",
        "detection_tools",
    ]

    df = pd.DataFrame(candidates)

    # Only include columns that exist in the data
    available_columns = [col for col in summary_columns if col in df.columns]
    if not available_columns:
        # Fall back to all columns if none of the expected ones are present
        available_columns = list(df.columns)

    tsv_path = output_path.with_suffix(".tsv")
    df[available_columns].to_csv(tsv_path, sep="\t", index=False)
    logger.info("Wrote TSV summary (%d columns) to %s", len(available_columns), tsv_path)

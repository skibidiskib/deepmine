"""
DEEPMINE: Ensemble BGC Merging
Merge BGC detections from antiSMASH, GECCO, and DeepBGC into a
consensus set based on genomic coordinate overlap.

Called via Snakemake `script:` directive. Expects the `snakemake` object
with inputs, outputs, params, and log as defined in bgc_detection.smk.
"""

import csv
import glob
import logging
import os
import re
import sys
from collections import defaultdict
from dataclasses import dataclass, field
from pathlib import Path
from typing import List

from Bio import SeqIO


# ---------------------------------------------------------------------------
# Data structures
# ---------------------------------------------------------------------------

@dataclass
class BGCRegion:
    """A single BGC detection from any tool."""
    contig: str
    start: int
    end: int
    tool: str
    bgc_type: str = "unknown"
    score: float = 0.0
    predicted_product: str = "unknown"
    raw_id: str = ""


@dataclass
class ConsensusBGC:
    """A merged BGC supported by multiple detection tools."""
    bgc_id: str
    contig: str
    start: int
    end: int
    bgc_type: str
    predicted_product: str
    tools: List[str] = field(default_factory=list)
    tool_count: int = 0
    mean_score: float = 0.0


# ---------------------------------------------------------------------------
# Parsers for each tool's output
# ---------------------------------------------------------------------------

def parse_antismash(antismash_dir: str) -> List[BGCRegion]:
    """
    Parse antiSMASH output directory. Looks for region GenBank files
    and extracts coordinates + product type from the annotations.
    """
    regions = []
    pattern = os.path.join(antismash_dir, "*.region*.gbk")
    gbk_files = glob.glob(pattern)

    for gbk_path in gbk_files:
        try:
            for record in SeqIO.parse(gbk_path, "genbank"):
                contig = record.id
                for feature in record.features:
                    if feature.type == "region":
                        start = int(feature.location.start)
                        end = int(feature.location.end)
                        # Extract product types from qualifiers
                        products = feature.qualifiers.get("product", ["unknown"])
                        bgc_type = ",".join(products)
                        raw_id = os.path.basename(gbk_path).replace(".gbk", "")
                        regions.append(BGCRegion(
                            contig=contig,
                            start=start,
                            end=end,
                            tool="antismash",
                            bgc_type=bgc_type,
                            score=1.0,
                            predicted_product=bgc_type,
                            raw_id=raw_id,
                        ))
        except Exception as e:
            logging.warning(f"Failed to parse {gbk_path}: {e}")

    # Also try parsing from the knownclusterblast / regions.js
    regions_js = os.path.join(antismash_dir, "regions.js")
    if not gbk_files and os.path.exists(regions_js):
        try:
            with open(regions_js) as f:
                content = f.read()
            # Very simplified JS variable extraction
            match = re.search(r"var defined_regions = (\[.*?\]);", content, re.DOTALL)
            if match:
                import json
                data = json.loads(match.group(1))
                for entry in data:
                    regions.append(BGCRegion(
                        contig=entry.get("anchor", "unknown"),
                        start=entry.get("start", 0),
                        end=entry.get("end", 0),
                        tool="antismash",
                        bgc_type=entry.get("type", "unknown"),
                        score=1.0,
                        predicted_product=entry.get("type", "unknown"),
                        raw_id=entry.get("anchor", ""),
                    ))
        except Exception as e:
            logging.warning(f"Failed to parse regions.js: {e}")

    return regions


def parse_gecco(gecco_tsv: str) -> List[BGCRegion]:
    """
    Parse GECCO clusters TSV output. Expected columns:
    sequence_id, bgc_id, start, end, average_p, max_p, type, ...
    """
    regions = []
    try:
        with open(gecco_tsv) as f:
            reader = csv.DictReader(f, delimiter="\t")
            for row in reader:
                # GECCO column names can vary by version; try common names
                contig = row.get("sequence_id", row.get("Sequence_ID", "unknown"))
                start = int(row.get("start", row.get("Start", 0)))
                end = int(row.get("end", row.get("End", 0)))
                score = float(row.get("average_p", row.get("Average_p", 0.0)))
                bgc_type = row.get("type", row.get("Type", "unknown"))
                bgc_id = row.get("bgc_id", row.get("BGC_ID", ""))

                regions.append(BGCRegion(
                    contig=contig,
                    start=start,
                    end=end,
                    tool="gecco",
                    bgc_type=bgc_type,
                    score=score,
                    predicted_product=bgc_type,
                    raw_id=bgc_id,
                ))
    except Exception as e:
        logging.warning(f"Failed to parse GECCO output {gecco_tsv}: {e}")

    return regions


def parse_deepbgc(deepbgc_tsv: str) -> List[BGCRegion]:
    """
    Parse DeepBGC BGC TSV output. Expected columns:
    sequence_id, cluster_id, start, end, score, product_class
    """
    regions = []
    try:
        with open(deepbgc_tsv) as f:
            reader = csv.DictReader(f, delimiter="\t")
            for row in reader:
                contig = row.get("sequence_id", row.get("nucl_accession", "unknown"))
                start = int(row.get("start", row.get("nucl_start", 0)))
                end = int(row.get("end", row.get("nucl_end", 0)))
                score = float(row.get("score", row.get("deepbgc_score", 0.0)))
                bgc_type = row.get("product_class", row.get("product_activity", "unknown"))
                cluster_id = row.get("cluster_id", row.get("bgc_candidate_id", ""))

                regions.append(BGCRegion(
                    contig=contig,
                    start=start,
                    end=end,
                    tool="deepbgc",
                    bgc_type=bgc_type,
                    score=score,
                    predicted_product=bgc_type,
                    raw_id=cluster_id,
                ))
    except Exception as e:
        logging.warning(f"Failed to parse DeepBGC output {deepbgc_tsv}: {e}")

    return regions


# ---------------------------------------------------------------------------
# Overlap detection and merging
# ---------------------------------------------------------------------------

def reciprocal_overlap(a_start, a_end, b_start, b_end) -> float:
    """
    Compute the reciprocal overlap fraction between two intervals.
    Returns the minimum of (overlap / len_a) and (overlap / len_b).
    """
    overlap_start = max(a_start, b_start)
    overlap_end = min(a_end, b_end)
    overlap_len = max(0, overlap_end - overlap_start)

    len_a = max(1, a_end - a_start)
    len_b = max(1, b_end - b_start)

    return min(overlap_len / len_a, overlap_len / len_b)


def merge_regions(
    all_regions: List[BGCRegion],
    min_overlap_frac: float,
    min_consensus: int,
) -> List[ConsensusBGC]:
    """
    Cluster overlapping BGC regions across tools. A consensus BGC is
    formed when regions from >= min_consensus distinct tools share
    reciprocal overlap >= min_overlap_frac.
    """
    # Group regions by contig
    by_contig = defaultdict(list)
    for r in all_regions:
        by_contig[r.contig].append(r)

    consensus_bgcs = []
    bgc_counter = 0

    for contig, regions in by_contig.items():
        # Sort by start position
        regions.sort(key=lambda r: r.start)

        # Simple greedy clustering: merge overlapping regions
        clusters = []
        used = [False] * len(regions)

        for i, anchor in enumerate(regions):
            if used[i]:
                continue

            cluster = [anchor]
            used[i] = True
            cluster_start = anchor.start
            cluster_end = anchor.end

            for j in range(i + 1, len(regions)):
                if used[j]:
                    continue
                candidate = regions[j]
                # Check if candidate overlaps with the current cluster envelope
                overlap = reciprocal_overlap(
                    cluster_start, cluster_end,
                    candidate.start, candidate.end,
                )
                if overlap >= min_overlap_frac:
                    cluster.append(candidate)
                    used[j] = True
                    cluster_start = min(cluster_start, candidate.start)
                    cluster_end = max(cluster_end, candidate.end)

            clusters.append(cluster)

        # Build consensus BGCs from clusters
        for cluster in clusters:
            tools = list(set(r.tool for r in cluster))
            if len(tools) < min_consensus:
                continue

            bgc_counter += 1
            merged_start = min(r.start for r in cluster)
            merged_end = max(r.end for r in cluster)
            scores = [r.score for r in cluster if r.score > 0]
            mean_score = sum(scores) / len(scores) if scores else 0.0

            # Pick the most specific bgc_type (longest non-"unknown" string)
            types = [r.bgc_type for r in cluster if r.bgc_type != "unknown"]
            bgc_type = max(types, key=len) if types else "unknown"

            products = [r.predicted_product for r in cluster if r.predicted_product != "unknown"]
            product = max(products, key=len) if products else "unknown"

            consensus_bgcs.append(ConsensusBGC(
                bgc_id=f"DEEPMINE_{bgc_counter:06d}",
                contig=contig,
                start=merged_start,
                end=merged_end,
                bgc_type=bgc_type,
                predicted_product=product,
                tools=sorted(tools),
                tool_count=len(tools),
                mean_score=round(mean_score, 4),
            ))

    return consensus_bgcs


# ---------------------------------------------------------------------------
# Extract FASTA sequences for consensus BGCs
# ---------------------------------------------------------------------------

def extract_bgc_sequences(
    consensus_bgcs: List[ConsensusBGC],
    contigs_fasta: str,
) -> dict:
    """
    Extract the nucleotide sequence for each consensus BGC from the
    assembled contigs FASTA.
    """
    # Index contigs by ID
    contig_seqs = {}
    for record in SeqIO.parse(contigs_fasta, "fasta"):
        contig_seqs[record.id] = record

    bgc_sequences = {}
    for bgc in consensus_bgcs:
        if bgc.contig in contig_seqs:
            seq = contig_seqs[bgc.contig].seq[bgc.start:bgc.end]
            bgc_sequences[bgc.bgc_id] = str(seq)
        else:
            logging.warning(
                f"Contig {bgc.contig} not found for BGC {bgc.bgc_id}"
            )

    return bgc_sequences


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    # Set up logging
    logging.basicConfig(
        filename=snakemake.log[0],
        level=logging.INFO,
        format="%(asctime)s %(levelname)s: %(message)s",
    )
    logger = logging.getLogger("ensemble_bgc")

    # Parse inputs
    antismash_dir = str(snakemake.params.antismash_dir)
    gecco_tsv = str(snakemake.input.gecco_clusters)
    deepbgc_tsv = str(snakemake.input.deepbgc_tsv)
    contigs_fasta = str(snakemake.input.contigs)

    min_consensus = int(snakemake.params.min_consensus)
    min_overlap_frac = float(snakemake.params.min_overlap_frac)

    consensus_out = str(snakemake.output.consensus)
    fasta_out = str(snakemake.output.fasta)

    logger.info("Parsing antiSMASH results...")
    antismash_regions = parse_antismash(antismash_dir)
    logger.info(f"  antiSMASH: {len(antismash_regions)} regions")

    logger.info("Parsing GECCO results...")
    gecco_regions = parse_gecco(gecco_tsv)
    logger.info(f"  GECCO: {len(gecco_regions)} clusters")

    logger.info("Parsing DeepBGC results...")
    deepbgc_regions = parse_deepbgc(deepbgc_tsv)
    logger.info(f"  DeepBGC: {len(deepbgc_regions)} BGCs")

    all_regions = antismash_regions + gecco_regions + deepbgc_regions
    logger.info(f"Total input regions: {len(all_regions)}")

    if not all_regions:
        logger.warning("No BGC regions detected by any tool.")
        # Write empty outputs
        with open(consensus_out, "w") as f:
            f.write(
                "bgc_id\tcontig\tstart\tend\tbgc_type\tpredicted_product\t"
                "tools\ttool_count\tmean_score\n"
            )
        with open(fasta_out, "w") as f:
            pass
        return

    # Merge overlapping regions across tools
    logger.info(
        f"Merging with min_overlap_frac={min_overlap_frac}, "
        f"min_consensus={min_consensus}..."
    )
    consensus = merge_regions(all_regions, min_overlap_frac, min_consensus)
    logger.info(f"Consensus BGCs: {len(consensus)}")

    # Write consensus TSV
    os.makedirs(os.path.dirname(consensus_out), exist_ok=True)
    with open(consensus_out, "w", newline="") as f:
        writer = csv.writer(f, delimiter="\t")
        writer.writerow([
            "bgc_id", "contig", "start", "end", "bgc_type",
            "predicted_product", "tools", "tool_count", "mean_score",
        ])
        for bgc in consensus:
            writer.writerow([
                bgc.bgc_id,
                bgc.contig,
                bgc.start,
                bgc.end,
                bgc.bgc_type,
                bgc.predicted_product,
                ",".join(bgc.tools),
                bgc.tool_count,
                bgc.mean_score,
            ])

    # Extract and write FASTA sequences
    logger.info("Extracting BGC sequences from contigs...")
    sequences = extract_bgc_sequences(consensus, contigs_fasta)

    with open(fasta_out, "w") as f:
        for bgc in consensus:
            seq = sequences.get(bgc.bgc_id, "")
            if seq:
                f.write(f">{bgc.bgc_id} {bgc.contig}:{bgc.start}-{bgc.end} "
                        f"type={bgc.bgc_type} tools={','.join(bgc.tools)}\n")
                # Write sequence in 80-char lines
                for i in range(0, len(seq), 80):
                    f.write(seq[i:i+80] + "\n")

    logger.info(
        f"Wrote {len(consensus)} consensus BGCs and "
        f"{len(sequences)} sequences."
    )


main()

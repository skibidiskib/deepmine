"""
DEEPMINE: Feature Extraction for Novel BGCs
Extracts genomic, structural, and domain features from novel BGCs
for downstream ML-based activity prediction.

Called via Snakemake `script:` directive. Expects the `snakemake` object
with inputs, outputs, params, and log as defined in scoring.smk.
"""

import csv
import logging
import math
import os
import re
from collections import Counter
from pathlib import Path

from Bio import SeqIO


# ---------------------------------------------------------------------------
# Feature computation functions
# ---------------------------------------------------------------------------

def gc_content(seq: str) -> float:
    """Compute GC content fraction for a nucleotide sequence."""
    seq = seq.upper()
    total = len(seq)
    if total == 0:
        return 0.0
    gc = seq.count("G") + seq.count("C")
    return round(gc / total, 4)


def count_domains(protein_records: list, bgc_contig: str, bgc_start: int, bgc_end: int) -> dict:
    """
    Count protein features (crude domain detection based on protein
    properties) for proteins falling within a BGC region.
    Returns a dict of feature counts.
    """
    domains = Counter()
    gene_count = 0

    for record in protein_records:
        # Prodigal FASTA headers: >contig_genenum # start # end # strand # ID=...
        header = record.description
        parts = header.split(" # ")
        if len(parts) < 4:
            continue

        # Extract contig name (everything before the last _N gene number)
        gene_name = parts[0].strip()
        contig_match = re.match(r"^(.+)_(\d+)$", gene_name)
        if not contig_match:
            continue

        contig = contig_match.group(1)
        if contig != bgc_contig:
            continue

        try:
            gene_start = int(parts[1].strip())
            gene_end = int(parts[2].strip())
        except ValueError:
            continue

        # Check if gene overlaps with BGC region
        if gene_end < bgc_start or gene_start > bgc_end:
            continue

        gene_count += 1
        seq = str(record.seq).replace("*", "")
        seq_len = len(seq)

        if seq_len == 0:
            continue

        # Compute protein-level features as rough domain proxies
        # Cysteine-rich: possible thiopeptide/lanthipeptide
        cys_frac = seq.count("C") / seq_len
        if cys_frac > 0.08:
            domains["cysteine_rich"] += 1

        # Large proteins (>500 aa): possible NRPS/PKS
        if seq_len > 500:
            domains["large_enzyme"] += 1
        if seq_len > 1000:
            domains["mega_enzyme"] += 1

        # Serine/threonine-rich: possible glycosylation targets
        ser_thr_frac = (seq.count("S") + seq.count("T")) / seq_len
        if ser_thr_frac > 0.15:
            domains["ser_thr_rich"] += 1

        # Hydrophobic-rich: possible transmembrane/lipopeptide
        hydrophobic = sum(seq.count(aa) for aa in "AILMFWVP")
        if hydrophobic / seq_len > 0.5:
            domains["hydrophobic_rich"] += 1

        # Charge distribution
        positive = seq.count("R") + seq.count("K") + seq.count("H")
        negative = seq.count("D") + seq.count("E")
        net_charge = positive - negative
        if net_charge > 5:
            domains["cationic_protein"] += 1
        elif net_charge < -5:
            domains["anionic_protein"] += 1

        # Small ORFs (< 100 aa): possible precursor peptides
        if seq_len < 100:
            domains["small_orf"] += 1

    domains["total_genes"] = gene_count
    return dict(domains)


def compute_bgc_features(
    bgc_id: str,
    contig: str,
    start: int,
    end: int,
    bgc_type: str,
    bgc_seq: str,
    protein_records: list,
    feature_set: str = "all",
) -> dict:
    """
    Compute the full feature vector for a single BGC.
    Returns a flat dict of feature_name -> value.
    """
    features = {"bgc_id": bgc_id}
    length = end - start

    # -- Genomic features --
    features["bgc_length"] = length
    features["gc_content"] = gc_content(bgc_seq)
    features["log_length"] = round(math.log10(max(1, length)), 4)

    # Nucleotide composition beyond GC
    seq_upper = bgc_seq.upper()
    total_nt = max(1, len(seq_upper))
    for nt in "ACGT":
        features[f"frac_{nt}"] = round(seq_upper.count(nt) / total_nt, 4)

    # Dinucleotide frequencies (16 possible)
    dinucs = Counter()
    for i in range(len(seq_upper) - 1):
        di = seq_upper[i:i+2]
        if all(c in "ACGT" for c in di):
            dinucs[di] += 1
    total_di = max(1, sum(dinucs.values()))
    for d1 in "ACGT":
        for d2 in "ACGT":
            di = d1 + d2
            features[f"dinuc_{di}"] = round(dinucs.get(di, 0) / total_di, 6)

    # -- Domain/protein features --
    domain_counts = count_domains(protein_records, contig, start, end)
    gene_count = domain_counts.get("total_genes", 0)
    features["gene_count"] = gene_count
    features["gene_density"] = round(gene_count / max(1, length) * 1000, 4)

    domain_features = [
        "cysteine_rich", "large_enzyme", "mega_enzyme", "ser_thr_rich",
        "hydrophobic_rich", "cationic_protein", "anionic_protein", "small_orf",
    ]
    for df in domain_features:
        features[f"domain_{df}"] = domain_counts.get(df, 0)

    # -- BGC type encoding (one-hot for common types) --
    common_types = [
        "NRPS", "T1PKS", "T2PKS", "T3PKS", "terpene", "RiPP",
        "lanthipeptide", "bacteriocin", "siderophore", "other",
    ]
    bgc_type_lower = bgc_type.lower()
    for ct in common_types:
        features[f"type_{ct}"] = 1 if ct.lower() in bgc_type_lower else 0

    # If none matched, set "other"
    if not any(features.get(f"type_{ct}", 0) for ct in common_types[:-1]):
        features["type_other"] = 1

    return features


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    logging.basicConfig(
        filename=snakemake.log[0],
        level=logging.INFO,
        format="%(asctime)s %(levelname)s: %(message)s",
    )
    logger = logging.getLogger("extract_features")

    novel_tsv = str(snakemake.input.novel_tsv)
    novel_fasta = str(snakemake.input.novel_fasta)
    proteins_fasta = str(snakemake.input.proteins)
    contigs_fasta = str(snakemake.input.contigs)
    output_path = str(snakemake.output.features)
    feature_set = str(snakemake.params.feature_set)

    # Load novel BGC metadata
    bgcs = []
    with open(novel_tsv) as f:
        reader = csv.DictReader(f, delimiter="\t")
        for row in reader:
            bgcs.append(row)
    logger.info(f"Loaded {len(bgcs)} novel BGCs.")

    if not bgcs:
        # Write empty feature file with header
        os.makedirs(os.path.dirname(output_path), exist_ok=True)
        with open(output_path, "w") as f:
            f.write("bgc_id\n")
        logger.info("No BGCs to process; wrote empty features file.")
        return

    # Load BGC nucleotide sequences
    bgc_seqs = {}
    for record in SeqIO.parse(novel_fasta, "fasta"):
        bgc_seqs[record.id] = str(record.seq)
    logger.info(f"Loaded {len(bgc_seqs)} BGC sequences.")

    # Load all protein records once
    logger.info("Loading protein sequences...")
    protein_records = list(SeqIO.parse(proteins_fasta, "fasta"))
    logger.info(f"Loaded {len(protein_records)} protein records.")

    # Compute features for each BGC
    all_features = []
    for bgc in bgcs:
        bgc_id = bgc["bgc_id"]
        contig = bgc.get("contig", "")
        start = int(bgc.get("start", 0))
        end = int(bgc.get("end", 0))
        bgc_type = bgc.get("bgc_type", "unknown")

        seq = bgc_seqs.get(bgc_id, "")
        if not seq:
            logger.warning(f"No sequence found for {bgc_id}, skipping.")
            continue

        features = compute_bgc_features(
            bgc_id=bgc_id,
            contig=contig,
            start=start,
            end=end,
            bgc_type=bgc_type,
            bgc_seq=seq,
            protein_records=protein_records,
            feature_set=feature_set,
        )
        all_features.append(features)

    logger.info(f"Computed features for {len(all_features)} BGCs.")

    # Collect all feature names (union across all BGCs)
    all_keys = set()
    for feat in all_features:
        all_keys.update(feat.keys())

    # Ensure bgc_id is first column
    all_keys.discard("bgc_id")
    columns = ["bgc_id"] + sorted(all_keys)

    # Write TSV
    os.makedirs(os.path.dirname(output_path), exist_ok=True)
    with open(output_path, "w", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=columns, delimiter="\t",
                                extrasaction="ignore")
        writer.writeheader()
        for feat in all_features:
            # Fill missing keys with 0
            row = {k: feat.get(k, 0) for k in columns}
            writer.writerow(row)

    logger.info(
        f"Wrote {len(all_features)} x {len(columns)} feature matrix "
        f"to {output_path}"
    )


main()

# =============================================================================
# DEEPMINE - Novelty Filtering Rules
# Query against BiG-SLiCE DB, keep only novel BGCs
# =============================================================================


rule run_bigslice_query:
    """
    Query consensus BGCs against the BiG-SLiCE pre-computed database
    to measure distance to known gene cluster families (GCFs).
    Each BGC gets a distance score to its nearest MIBiG reference.
    """
    input:
        consensus=f"{OUTDIR}/{{sample}}/bgc/consensus_bgcs.tsv",
        bgc_fasta=f"{OUTDIR}/{{sample}}/bgc/consensus_bgcs.fa",
        antismash_done=f"{OUTDIR}/{{sample}}/bgc/antismash/.done",
    output:
        query_result=f"{OUTDIR}/{{sample}}/novelty/bigslice_query.tsv",
    params:
        antismash_dir=lambda wc: f"{OUTDIR}/{wc.sample}/bgc/antismash",
        bigslice_db=config["novelty"]["bigslice_db"],
        threshold=config["novelty"]["bigslice_threshold"],
        query_dir=lambda wc: f"{OUTDIR}/{wc.sample}/novelty/bigslice_query",
    threads: config["novelty"]["bigslice_threads"]
    resources:
        mem_mb=config["resources"]["high_mem_mb"],
    log:
        f"{OUTDIR}/{{sample}}/logs/bigslice_query.log",
    benchmark:
        f"{OUTDIR}/{{sample}}/benchmarks/bigslice_query.txt"
    shell:
        r"""
        echo "[$(date)] Querying BGCs against BiG-SLiCE DB for {wildcards.sample}..." > {log}

        mkdir -p {params.query_dir}

        # BiG-SLiCE expects antiSMASH-format output dirs. We symlink the
        # antiSMASH results under a query input folder structure:
        #   query_dir/datasets.tsv  (dataset descriptor)
        #   query_dir/<sample>/     (antiSMASH output)
        QUERY_INPUT={params.query_dir}/input
        mkdir -p "$QUERY_INPUT"

        ln -sfn $(realpath {params.antismash_dir}) "$QUERY_INPUT/{wildcards.sample}"

        # Create the datasets.tsv descriptor
        echo -e "#dataset_folder\tdataset_name" > "$QUERY_INPUT/datasets.tsv"
        echo -e "{wildcards.sample}\t{wildcards.sample}" >> "$QUERY_INPUT/datasets.tsv"

        bigslice \
            --query "$QUERY_INPUT" \
            --db_path {params.bigslice_db} \
            --threshold {params.threshold} \
            --n_cpu {threads} \
            -o {params.query_dir}/output \
            2>&1 | tee -a {log}

        # Parse BiG-SLiCE query results into a flat TSV:
        # bgc_id  gcf_id  distance  mibig_member
        python3 - << 'PYEOF'
import sqlite3
import csv
import os
import sys

query_db = os.path.join("{params.query_dir}", "output", "result", "data.db")
if not os.path.exists(query_db):
    # Fall back: write header-only file so downstream rules can proceed
    with open("{output.query_result}", "w") as f:
        f.write("bgc_id\tgcf_id\tdistance\tnearest_mibig\n")
    print("No BiG-SLiCE result DB found; wrote empty output.", file=sys.stderr)
    sys.exit(0)

conn = sqlite3.connect(query_db)
cur = conn.cursor()

rows = cur.execute("""
    SELECT
        q.bgc_name,
        q.gcf_id,
        q.membership_value,
        COALESCE(m.bgc_name, 'none')
    FROM bgc_gcf_membership q
    LEFT JOIN gcf_membership gm ON gm.gcf_id = q.gcf_id
    LEFT JOIN bgc m ON m.id = gm.bgc_id AND m.bgc_name LIKE 'BGC%'
    ORDER BY q.membership_value ASC
""").fetchall()

conn.close()

with open("{output.query_result}", "w", newline="") as f:
    w = csv.writer(f, delimiter="\t")
    w.writerow(["bgc_id", "gcf_id", "distance", "nearest_mibig"])
    for row in rows:
        w.writerow(row)
PYEOF

        QUERY_HITS=$(tail -n +2 {output.query_result} | wc -l | tr -d ' ')
        echo "[$(date)] BiG-SLiCE query returned $QUERY_HITS BGC-GCF pairs." >> {log}
        """


rule filter_novel:
    """
    Keep only BGCs whose distance to the nearest MIBiG entry exceeds
    the max_known_distance threshold, i.e. they are sufficiently novel.
    """
    input:
        consensus=f"{OUTDIR}/{{sample}}/bgc/consensus_bgcs.tsv",
        bgc_fasta=f"{OUTDIR}/{{sample}}/bgc/consensus_bgcs.fa",
        bigslice=f"{OUTDIR}/{{sample}}/novelty/bigslice_query.tsv",
    output:
        novel_tsv=f"{OUTDIR}/{{sample}}/novelty/novel_bgcs.tsv",
        novel_fasta=f"{OUTDIR}/{{sample}}/novelty/novel_bgcs.fa",
    params:
        max_known_distance=config["novelty"]["max_known_distance"],
    threads: 1
    resources:
        mem_mb=config["resources"]["default_mem_mb"],
    log:
        f"{OUTDIR}/{{sample}}/logs/filter_novel.log",
    benchmark:
        f"{OUTDIR}/{{sample}}/benchmarks/filter_novel.txt"
    run:
        import pandas as pd
        from Bio import SeqIO
        import logging

        logging.basicConfig(
            filename=log[0], level=logging.INFO,
            format="%(asctime)s %(levelname)s: %(message)s",
        )
        logger = logging.getLogger("filter_novel")

        max_dist = float(params.max_known_distance)

        # Load consensus BGCs
        consensus = pd.read_csv(input.consensus, sep="\t")
        logger.info(f"Loaded {len(consensus)} consensus BGCs.")

        # Load BiG-SLiCE query results
        bigslice = pd.read_csv(input.bigslice, sep="\t")

        if bigslice.empty:
            # No BiG-SLiCE hits means everything is novel (no known match)
            logger.info("No BiG-SLiCE matches; all BGCs treated as novel.")
            novel_ids = set(consensus["bgc_id"])
            consensus["novelty_distance"] = 1.0
        else:
            # For each BGC, find the minimum distance to any known MIBiG member
            min_distances = (
                bigslice
                .groupby("bgc_id")["distance"]
                .min()
                .reset_index()
                .rename(columns={"distance": "novelty_distance"})
            )

            consensus = consensus.merge(min_distances, on="bgc_id", how="left")

            # BGCs with no BiG-SLiCE match at all get distance = 1.0 (maximally novel)
            consensus["novelty_distance"] = consensus["novelty_distance"].fillna(1.0)

            # Filter: keep only those above the novelty threshold
            novel_mask = consensus["novelty_distance"] > max_dist
            logger.info(
                f"Novelty filter (distance > {max_dist}): "
                f"{novel_mask.sum()} / {len(consensus)} BGCs pass."
            )
            novel_ids = set(consensus.loc[novel_mask, "bgc_id"])
            consensus = consensus.loc[novel_mask].copy()

        # Write novel BGC table
        consensus.to_csv(output.novel_tsv, sep="\t", index=False)

        # Extract matching FASTA sequences
        novel_records = []
        for record in SeqIO.parse(input.bgc_fasta, "fasta"):
            if record.id in novel_ids:
                novel_records.append(record)

        SeqIO.write(novel_records, output.novel_fasta, "fasta")
        logger.info(
            f"Wrote {len(novel_records)} novel BGC sequences to FASTA."
        )

# =============================================================================
# DEEPMINE - Scoring Rules
# Feature extraction -> ML activity prediction -> final ranking
# =============================================================================


rule extract_features:
    """
    Extract genomic and structural features from novel BGCs for
    activity prediction. Computes:
      - Domain architecture (Pfam, NRPS/PKS modules)
      - Chemical property estimates (MW, LogP, HBD/HBA, TPSA)
      - Genomic context (GC%, contig position, gene density)
      - Comparative features (closest MIBiG class, domain rarity)
    """
    input:
        novel_tsv=f"{OUTDIR}/{{sample}}/novelty/novel_bgcs.tsv",
        novel_fasta=f"{OUTDIR}/{{sample}}/novelty/novel_bgcs.fa",
        proteins=f"{OUTDIR}/{{sample}}/gene_calling/proteins.faa",
        contigs=f"{OUTDIR}/{{sample}}/assembly/contigs.fa",
    output:
        features=f"{OUTDIR}/{{sample}}/scoring/features.tsv",
    params:
        feature_set=config["scoring"]["feature_set"],
    threads: config["resources"]["default_threads"]
    resources:
        mem_mb=config["resources"]["default_mem_mb"],
    log:
        f"{OUTDIR}/{{sample}}/logs/extract_features.log",
    benchmark:
        f"{OUTDIR}/{{sample}}/benchmarks/extract_features.txt"
    script:
        "../scripts/extract_features.py"


rule predict_activity:
    """
    Run the trained ML model on extracted features to predict
    antimicrobial activity probability for each novel BGC.
    """
    input:
        features=f"{OUTDIR}/{{sample}}/scoring/features.tsv",
    output:
        predictions=f"{OUTDIR}/{{sample}}/scoring/predictions.tsv",
    params:
        model_path=config["scoring"]["model_path"],
    threads: 1
    resources:
        mem_mb=config["resources"]["default_mem_mb"],
    log:
        f"{OUTDIR}/{{sample}}/logs/predict_activity.log",
    benchmark:
        f"{OUTDIR}/{{sample}}/benchmarks/predict_activity.txt"
    script:
        "../scripts/predict_activity.py"


rule rank_candidates:
    """
    Sort predicted BGCs by activity score, apply minimum score
    threshold, and produce the final ranked output with columns:
      bgc_id, source_sample, bgc_type, predicted_product,
      novelty_distance, activity_score, confidence
    """
    input:
        predictions=f"{OUTDIR}/{{sample}}/scoring/predictions.tsv",
        novel_tsv=f"{OUTDIR}/{{sample}}/novelty/novel_bgcs.tsv",
    output:
        ranked=f"{OUTDIR}/{{sample}}/ranked_candidates.tsv",
    params:
        score_threshold=config["scoring"]["score_threshold"],
        top_n=config["scoring"]["top_n"],
        sample="{sample}",
    threads: 1
    resources:
        mem_mb=config["resources"]["default_mem_mb"],
    log:
        f"{OUTDIR}/{{sample}}/logs/rank_candidates.log",
    benchmark:
        f"{OUTDIR}/{{sample}}/benchmarks/rank_candidates.txt"
    run:
        import pandas as pd
        import logging

        logging.basicConfig(
            filename=log[0], level=logging.INFO,
            format="%(asctime)s %(levelname)s: %(message)s",
        )
        logger = logging.getLogger("rank_candidates")

        # Load predictions and novelty metadata
        predictions = pd.read_csv(input.predictions, sep="\t")
        novel = pd.read_csv(input.novel_tsv, sep="\t")

        logger.info(
            f"Loaded {len(predictions)} predictions and "
            f"{len(novel)} novel BGC records."
        )

        # Merge novelty distance into predictions
        merged = predictions.merge(
            novel[["bgc_id", "novelty_distance", "bgc_type", "predicted_product"]],
            on="bgc_id",
            how="left",
            suffixes=("", "_novel"),
        )

        # Use prediction columns if novelty merge didn't provide them
        for col in ["bgc_type", "predicted_product"]:
            novel_col = f"{col}_novel"
            if novel_col in merged.columns:
                merged[col] = merged[col].fillna(merged[novel_col])
                merged.drop(columns=[novel_col], inplace=True)

        # Apply score threshold
        min_score = float(params.score_threshold)
        above_threshold = merged["activity_score"] >= min_score
        logger.info(
            f"Score threshold {min_score}: "
            f"{above_threshold.sum()} / {len(merged)} BGCs pass."
        )
        merged = merged.loc[above_threshold].copy()

        # Sort by activity score descending, then by novelty distance descending
        merged.sort_values(
            ["activity_score", "novelty_distance"],
            ascending=[False, False],
            inplace=True,
        )

        # Limit to top N
        top_n = int(params.top_n)
        if len(merged) > top_n:
            logger.info(f"Limiting output to top {top_n} candidates.")
            merged = merged.head(top_n)

        # Add source_sample column
        merged.insert(0, "source_sample", params.sample)

        # Select and order final columns
        final_columns = [
            "bgc_id",
            "source_sample",
            "bgc_type",
            "predicted_product",
            "novelty_distance",
            "activity_score",
            "confidence",
        ]

        # Ensure all expected columns exist
        for col in final_columns:
            if col not in merged.columns:
                merged[col] = "unknown" if col in ("bgc_type", "predicted_product") else 0.0

        result = merged[final_columns].copy()
        result.to_csv(output.ranked, sep="\t", index=False)

        logger.info(
            f"Final output: {len(result)} ranked candidates "
            f"written to {output.ranked}"
        )

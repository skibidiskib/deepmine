# =============================================================================
# DEEPMINE - BGC Detection Rules
# Three-tool ensemble: antiSMASH + GECCO + DeepBGC -> consensus merge
# =============================================================================


rule run_antismash:
    """
    Detect biosynthetic gene clusters using antiSMASH.
    Runs on assembled contigs with Prodigal-based gene finding.
    Outputs the antiSMASH results directory containing GenBank files
    per detected BGC region.
    """
    input:
        contigs=f"{OUTDIR}/{{sample}}/assembly/contigs.fa",
        gbk=f"{OUTDIR}/{{sample}}/gene_calling/genes.gbk",
    output:
        regions_js=f"{OUTDIR}/{{sample}}/bgc/antismash/regions.js",
        done=touch(f"{OUTDIR}/{{sample}}/bgc/antismash/.done"),
    params:
        taxon=config["bgc_detection"]["antismash_taxon"],
        genefinding=config["bgc_detection"]["antismash_genefinding"],
        extra=config["bgc_detection"]["antismash_extra_args"],
    threads: config["bgc_detection"]["antismash_threads"]
    resources:
        mem_mb=config["resources"]["high_mem_mb"],
    log:
        f"{OUTDIR}/{{sample}}/logs/antismash.log",
    benchmark:
        f"{OUTDIR}/{{sample}}/benchmarks/antismash.txt"
    shell:
        r"""
        OUTDIR=$(dirname {output.regions_js})

        echo "[$(date)] Running antiSMASH on {wildcards.sample}..." > {log}

        antismash \
            {input.contigs} \
            --output-dir "$OUTDIR" \
            --taxon {params.taxon} \
            --genefinding-tool {params.genefinding} \
            --cpus {threads} \
            --output-basename {wildcards.sample} \
            {params.extra} \
            2>&1 | tee -a {log}

        # Count detected regions
        REGION_COUNT=$(find "$OUTDIR" -name "*.region*.gbk" | wc -l | tr -d ' ')
        echo "[$(date)] antiSMASH found $REGION_COUNT BGC regions." >> {log}

        # Ensure regions.js exists even if zero hits (prevents downstream failure)
        if [ ! -f "{output.regions_js}" ]; then
            echo "var defined_regions = [];" > {output.regions_js}
            echo "[$(date)] No regions found; created empty regions.js." >> {log}
        fi
        """


rule run_gecco:
    """
    Detect BGCs using GECCO (GEne Cluster prediction with
    Conditional Random Fields). Outputs a clusters TSV and
    per-cluster GenBank files.
    """
    input:
        contigs=f"{OUTDIR}/{{sample}}/assembly/contigs.fa",
    output:
        clusters=f"{OUTDIR}/{{sample}}/bgc/gecco/clusters.tsv",
        done=touch(f"{OUTDIR}/{{sample}}/bgc/gecco/.done"),
    params:
        threshold=config["bgc_detection"]["gecco_threshold"],
        use_cds="--cds" if config["bgc_detection"]["gecco_cds"] else "",
    threads: config["bgc_detection"]["gecco_threads"]
    resources:
        mem_mb=config["resources"]["default_mem_mb"],
    log:
        f"{OUTDIR}/{{sample}}/logs/gecco.log",
    benchmark:
        f"{OUTDIR}/{{sample}}/benchmarks/gecco.txt"
    shell:
        r"""
        echo "[$(date)] Running GECCO on {wildcards.sample}..." > {log}

        GECCO_OUTDIR=$(dirname {output.clusters})

        gecco run \
            --genome {input.contigs} \
            --output "$GECCO_OUTDIR" \
            --threshold {params.threshold} \
            --jobs {threads} \
            {params.use_cds} \
            2>&1 | tee -a {log}

        # GECCO writes *_clusters.tsv; consolidate to standard name
        if ls "$GECCO_OUTDIR"/*_clusters.tsv 1>/dev/null 2>&1; then
            cat "$GECCO_OUTDIR"/*_clusters.tsv > {output.clusters}
        else
            # Create empty clusters file with header if no clusters found
            echo -e "sequence_id\tbgc_id\tstart\tend\taverage_p\tmax_p\ttype\talkaline_peptide" \
                > {output.clusters}
            echo "[$(date)] GECCO found 0 clusters." >> {log}
        fi

        CLUSTER_COUNT=$(tail -n +2 {output.clusters} | wc -l | tr -d ' ')
        echo "[$(date)] GECCO detected $CLUSTER_COUNT clusters." >> {log}
        """


rule run_deepbgc:
    """
    Detect BGCs using DeepBGC deep learning model.
    Outputs a BGC TSV summary and per-cluster GenBank files.
    """
    input:
        contigs=f"{OUTDIR}/{{sample}}/assembly/contigs.fa",
    output:
        bgc_tsv=f"{OUTDIR}/{{sample}}/bgc/deepbgc/{{sample}}.bgc.tsv",
        done=touch(f"{OUTDIR}/{{sample}}/bgc/deepbgc/.done"),
    params:
        detector=config["bgc_detection"]["deepbgc_detector"],
        score_threshold=config["bgc_detection"]["deepbgc_score_threshold"],
    threads: config["bgc_detection"]["deepbgc_threads"]
    resources:
        mem_mb=config["resources"]["default_mem_mb"],
    log:
        f"{OUTDIR}/{{sample}}/logs/deepbgc.log",
    benchmark:
        f"{OUTDIR}/{{sample}}/benchmarks/deepbgc.txt"
    shell:
        r"""
        echo "[$(date)] Running DeepBGC on {wildcards.sample}..." > {log}

        DEEPBGC_OUTDIR=$(dirname {output.bgc_tsv})

        deepbgc pipeline \
            --output "$DEEPBGC_OUTDIR" \
            --detector {params.detector} \
            --score {params.score_threshold} \
            {input.contigs} \
            2>&1 | tee -a {log}

        # DeepBGC writes <input_basename>.bgc.tsv in output dir
        # Rename/copy to our standardized filename
        BGC_FILE=$(find "$DEEPBGC_OUTDIR" -name "*.bgc.tsv" -type f | head -1)
        if [ -n "$BGC_FILE" ] && [ "$BGC_FILE" != "{output.bgc_tsv}" ]; then
            cp "$BGC_FILE" {output.bgc_tsv}
        fi

        # Ensure the output exists even with zero hits
        if [ ! -f "{output.bgc_tsv}" ]; then
            echo -e "sequence_id\tcluster_id\tstart\tend\tscore\tproduct_class" \
                > {output.bgc_tsv}
            echo "[$(date)] DeepBGC found 0 BGCs." >> {log}
        fi

        BGC_COUNT=$(tail -n +2 {output.bgc_tsv} | wc -l | tr -d ' ')
        echo "[$(date)] DeepBGC detected $BGC_COUNT BGCs." >> {log}
        """


rule ensemble_bgc:
    """
    Merge BGC predictions from antiSMASH, GECCO, and DeepBGC.
    Retain only BGCs detected by >= min_consensus tools using
    genomic coordinate overlap (reciprocal overlap >= 50%).
    Output: unified BGC table + extracted FASTA sequences per BGC.
    """
    input:
        antismash_done=f"{OUTDIR}/{{sample}}/bgc/antismash/.done",
        gecco_clusters=f"{OUTDIR}/{{sample}}/bgc/gecco/clusters.tsv",
        deepbgc_tsv=f"{OUTDIR}/{{sample}}/bgc/deepbgc/{{sample}}.bgc.tsv",
        contigs=f"{OUTDIR}/{{sample}}/assembly/contigs.fa",
    output:
        consensus=f"{OUTDIR}/{{sample}}/bgc/consensus_bgcs.tsv",
        fasta=f"{OUTDIR}/{{sample}}/bgc/consensus_bgcs.fa",
    params:
        antismash_dir=lambda wc: f"{OUTDIR}/{wc.sample}/bgc/antismash",
        min_consensus=config["bgc_detection"]["min_consensus"],
        min_overlap_frac=0.5,
    threads: 1
    resources:
        mem_mb=config["resources"]["default_mem_mb"],
    log:
        f"{OUTDIR}/{{sample}}/logs/ensemble_bgc.log",
    benchmark:
        f"{OUTDIR}/{{sample}}/benchmarks/ensemble_bgc.txt"
    script:
        "../scripts/ensemble_bgc.py"

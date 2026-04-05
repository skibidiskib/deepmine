# =============================================================================
# DEEPMINE - Assembly Rules
# Raw reads -> assembled contigs -> gene calling
# =============================================================================


rule download_sra:
    """
    Download paired-end reads from NCBI SRA using fasterq-dump.
    Splits into forward/reverse FASTQ files and compresses with pigz.
    """
    output:
        r1=f"{OUTDIR}/{{sample}}/reads/{{sample}}_1.fastq.gz",
        r2=f"{OUTDIR}/{{sample}}/reads/{{sample}}_2.fastq.gz",
    params:
        accession="{sample}",
        outdir=lambda wc: f"{OUTDIR}/{wc.sample}/reads",
        tmpdir=config["resources"]["tmpdir"],
    threads: 6
    resources:
        mem_mb=config["resources"]["default_mem_mb"],
    log:
        f"{OUTDIR}/{{sample}}/logs/download_sra.log",
    benchmark:
        f"{OUTDIR}/{{sample}}/benchmarks/download_sra.txt"
    shell:
        r"""
        mkdir -p {params.tmpdir} {params.outdir} 2>&1 | tee {log}

        echo "[$(date)] Downloading {params.accession} from SRA..." >> {log}

        fasterq-dump \
            --accession {params.accession} \
            --outdir {params.outdir} \
            --temp {params.tmpdir} \
            --threads {threads} \
            --split-3 \
            --skip-technical \
            --force \
            2>&1 | tee -a {log}

        echo "[$(date)] Compressing FASTQ files..." >> {log}

        pigz -p {threads} -f {params.outdir}/{params.accession}_1.fastq 2>&1 | tee -a {log}
        pigz -p {threads} -f {params.outdir}/{params.accession}_2.fastq 2>&1 | tee -a {log}

        echo "[$(date)] Download complete. Output:" >> {log}
        ls -lh {output.r1} {output.r2} >> {log} 2>&1
        """


rule assemble:
    """
    Assemble metagenomic reads with MEGAHIT, then filter contigs by
    minimum length using seqkit.
    """
    input:
        r1=rules.download_sra.output.r1,
        r2=rules.download_sra.output.r2,
    output:
        contigs=f"{OUTDIR}/{{sample}}/assembly/contigs.fa",
        stats=f"{OUTDIR}/{{sample}}/assembly/assembly_stats.txt",
    params:
        min_len=config["assembly"]["min_contig_length"],
        preset=config["assembly"]["megahit_preset"],
        k_list=config["assembly"]["k_list"],
        memory=config["assembly"]["memory"],
        megahit_outdir=lambda wc: f"{OUTDIR}/{wc.sample}/assembly/megahit_out",
        tmpdir=config["resources"]["tmpdir"],
    threads: config["assembly"]["threads"]
    resources:
        mem_mb=config["resources"]["high_mem_mb"],
    log:
        f"{OUTDIR}/{{sample}}/logs/assemble.log",
    benchmark:
        f"{OUTDIR}/{{sample}}/benchmarks/assemble.txt"
    shell:
        r"""
        echo "[$(date)] Starting MEGAHIT assembly for {wildcards.sample}..." > {log}

        # MEGAHIT won't overwrite; remove any prior partial run
        rm -rf {params.megahit_outdir}

        megahit \
            -1 {input.r1} \
            -2 {input.r2} \
            --presets {params.preset} \
            --k-list {params.k_list} \
            --min-contig-len 200 \
            -m {params.memory} \
            -t {threads} \
            --tmp-dir {params.tmpdir} \
            -o {params.megahit_outdir} \
            2>&1 | tee -a {log}

        echo "[$(date)] Filtering contigs >= {params.min_len} bp..." >> {log}

        seqkit seq \
            --min-len {params.min_len} \
            --threads {threads} \
            {params.megahit_outdir}/final.contigs.fa \
            > {output.contigs} \
            2>> {log}

        # Compute basic assembly stats
        echo "[$(date)] Computing assembly statistics..." >> {log}
        echo "=== Assembly Stats for {wildcards.sample} ===" > {output.stats}
        echo "Min contig length filter: {params.min_len} bp" >> {output.stats}

        seqkit stats --all --tabular {output.contigs} >> {output.stats} 2>> {log}

        TOTAL_BEFORE=$(grep -c "^>" {params.megahit_outdir}/final.contigs.fa || true)
        TOTAL_AFTER=$(grep -c "^>" {output.contigs} || true)
        echo "" >> {output.stats}
        echo "Contigs before filter: $TOTAL_BEFORE" >> {output.stats}
        echo "Contigs after filter:  $TOTAL_AFTER" >> {output.stats}

        echo "[$(date)] Assembly complete." >> {log}
        """


rule gene_calling:
    """
    Predict protein-coding genes on assembled contigs using Prodigal
    in metagenomic mode. Produces GenBank annotation and protein FASTA.
    """
    input:
        contigs=rules.assemble.output.contigs,
    output:
        gbk=f"{OUTDIR}/{{sample}}/gene_calling/genes.gbk",
        proteins=f"{OUTDIR}/{{sample}}/gene_calling/proteins.faa",
        nucleotides=f"{OUTDIR}/{{sample}}/gene_calling/genes.fna",
        gff=f"{OUTDIR}/{{sample}}/gene_calling/genes.gff",
    params:
        mode=config["gene_calling"]["prodigal_mode"],
    threads: 1  # Prodigal is single-threaded
    resources:
        mem_mb=config["resources"]["default_mem_mb"],
    log:
        f"{OUTDIR}/{{sample}}/logs/gene_calling.log",
    benchmark:
        f"{OUTDIR}/{{sample}}/benchmarks/gene_calling.txt"
    shell:
        r"""
        echo "[$(date)] Running Prodigal gene calling on {wildcards.sample}..." > {log}
        echo "Mode: {params.mode}" >> {log}

        prodigal \
            -i {input.contigs} \
            -o {output.gbk} \
            -a {output.proteins} \
            -d {output.nucleotides} \
            -f gbk \
            -p {params.mode} \
            2>&1 | tee -a {log}

        # Also produce GFF3 output for tools that prefer it
        prodigal \
            -i {input.contigs} \
            -o {output.gff} \
            -f gff \
            -p {params.mode} \
            2>&1 | tee -a {log}

        GENE_COUNT=$(grep -c "^>" {output.proteins} || true)
        echo "[$(date)] Gene calling complete. Predicted $GENE_COUNT genes." >> {log}
        """

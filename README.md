# DEEPMINE

**Mine Earth's microbiome for new antibiotics.**

DEEPMINE is an open-source platform for discovering novel antimicrobial compounds from metagenomic data. It combines a computational pipeline that finds biosynthetic gene clusters (BGCs) in environmental DNA with a live community dashboard that tracks discoveries across all contributors.

99% of environmental bacteria cannot be cultured in a lab, but their DNA is publicly available in sequencing databases. DEEPMINE screens this "genomic dark matter" for gene clusters that may produce new antibiotics.

## Quick start

### Community Dashboard (no Python needed)

```bash
npx deepmine
```

Opens the live dashboard at `http://localhost:6767`. Tracks BGC discoveries, contributor leaderboard, activity scores, and novelty rates in real-time.

```bash
npx deepmine seed     # Load demo data to see the dashboard in action
npx deepmine status   # Check dashboard stats
```

### Analysis Pipeline (find new antibiotics)

```bash
# Install Python pipeline
cd pipeline
pip install -e .

# Install bioinformatics tools
conda install -c bioconda megahit prodigal antismash gecco deepbgc seqkit sra-tools

# Download a cave metagenome and run
deepmine fetch --sra SRR8859675
deepmine run -j 8

# Report discoveries to the community dashboard
deepmine report results/ --url http://localhost:6767 --username your_name
```

## How it works

```
Public metagenomic data (NCBI SRA, MGnify)
  |
  v
Assembly (MEGAHIT) -- reconstruct contigs from short reads
  |
  v
Gene calling (Prodigal) -- predict protein-coding genes
  |
  v
BGC detection (antiSMASH + GECCO + DeepBGC ensemble)
  |  -- three tools vote, consensus filtering reduces false positives
  v
Novelty filtering (BiG-SLiCE) -- keep only BGCs distant from known families
  |
  v
Activity scoring (transformer-based ML model)
  |  -- predicts antimicrobial activity from domain architecture
  v
Ranked candidates --> report to community dashboard
```

### The novel contribution

The activity scorer uses a **transformer-based BGC encoder** that learns from the ordered sequence of protein domains in a gene cluster. Unlike prior approaches that use flat feature vectors, it captures long-range domain-domain interactions via self-attention, similar to how a chemist reads an enzymatic assembly line.

## Project structure

```
deepmine/
  bin/cli.js           # npx deepmine CLI
  dashboard/           # Next.js community dashboard (port 6767)
  pipeline/            # Python analysis pipeline
    deepmine/          # Python package
      models/          # Transformer BGC encoder + activity scorer
      parsers/         # antiSMASH, GECCO, DeepBGC output parsers
      features/        # BGC feature extraction
      telemetry.py     # Report results to dashboard
      cli.py           # deepmine CLI (run, score, train, fetch, report)
    workflow/          # Snakemake pipeline rules
    config/            # Pipeline configuration
    tests/             # Unit tests
```

## Dashboard

The community dashboard is a dark-themed glassmorphism web app built with Next.js, Tailwind CSS, Framer Motion, and Recharts. It shows:

- **Global stats**: total BGCs, novel candidates, contributors, environments explored
- **Discovery timeline**: cumulative BGC discoveries over time
- **Leaderboard**: top contributors ranked by discoveries
- **BGC type distribution**: NRPS, PKS, RiPP, terpene, hybrid breakdown
- **Activity score histogram**: distribution of predicted antimicrobial scores
- **Novelty gauge**: percentage of BGCs that are novel
- **Live feed**: real-time SSE-powered discovery stream

Data is stored in SQLite. The dashboard receives results via a REST API (`POST /api/submit`) from the pipeline's `deepmine report` command.

## Pipeline commands

```bash
deepmine run -c config/config.yaml -j 8    # Run full pipeline
deepmine run --dry-run                      # Preview what would execute
deepmine score /path/to/bgcs/ -m model.pt  # Score pre-extracted BGCs
deepmine train --mibig-dir data/mibig/     # Train the activity scorer
deepmine fetch --sra SRR12345678           # Download metagenomic data
deepmine report results/ --url URL         # Report to dashboard
```

## Where to find data

The pipeline works on public metagenomic data from environments where novel chemistry is most likely:

| Environment | Why interesting | How to find |
|-------------|----------------|-------------|
| Caves | Isolated for millions of years | Search SRA: "cave metagenome" |
| Deep-sea vents | Extreme pressure, unique metabolisms | Search: "hydrothermal vent metagenome" |
| Hot springs | Thermophilic organisms | Search: "hot spring metagenome" |
| Permafrost | Ancient organisms preserved in ice | Search: "permafrost metagenome" |
| Acid mine drainage | Metal-resistant organisms | Search: "acid mine metagenome" |
| Insect microbiomes | Co-evolved defensive chemistry | Search: "insect symbiont metagenome" |

Browse datasets at [NCBI SRA](https://www.ncbi.nlm.nih.gov/sra) or [MGnify](https://www.ebi.ac.uk/metagenomics).

## What to do with results

High-scoring, high-novelty BGC candidates from the ranked output can be:

1. **Published openly** on GitHub/Zenodo for labs to validate
2. **Submitted to [CO-ADD](https://www.co-add.org/)** for free antimicrobial testing
3. **Shared with the community** via the DEEPMINE dashboard
4. **Written up as a preprint** documenting the computational findings

## Requirements

**Dashboard only** (viewers, hosts):
- Node.js >= 18

**Pipeline** (researchers running analyses):
- Python >= 3.10
- conda (for bioinformatics tools)
- 16+ GB RAM recommended
- GPU optional (speeds up ML scoring)

## Contributing

Contributions welcome. Key areas:

- Expanding the training dataset beyond MIBiG
- Adding more BGC detection backends
- Improving structure prediction from domain architecture
- Wet-lab validation of computational predictions
- Dashboard features and visualizations

## License

MIT

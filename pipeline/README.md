# DEEPMINE

**Deep Earth Exploration Pipeline for Microbial INhibitor Extraction**

An end-to-end pipeline that mines public metagenomic data for novel biosynthetic gene clusters (BGCs) and predicts their antimicrobial potential. Goes from raw sequencing reads to ranked antibiotic candidates.

## What makes this different

Existing tools handle individual steps (assembly, BGC detection, clustering). DEEPMINE is the first open-source pipeline that closes the loop with a **transformer-based activity scorer** that predicts antimicrobial potential directly from BGC domain architecture. No tool currently does this.

### Pipeline

```
Raw reads (NCBI SRA / MGnify)
  -> Assembly (MEGAHIT)
  -> Gene calling (Prodigal)
  -> BGC detection (antiSMASH + GECCO + DeepBGC ensemble)
  -> Novelty filtering (BiG-SLiCE distance to MIBiG)
  -> Feature extraction (domain architecture + chemical properties)
  -> Activity scoring (transformer-based ML model)
  -> Ranked candidates with confidence scores
```

## Installation

```bash
# Clone
git clone https://github.com/YOUR_USERNAME/deepmine.git
cd deepmine

# Install (requires Python >= 3.10)
pip install -e .

# Install external tools
conda install -c bioconda megahit prodigal antismash gecco deepbgc
```

## Quick start

```bash
# 1. Download some metagenomic data
deepmine fetch --sra SRR12345678 SRR87654321

# 2. Run the full pipeline
deepmine run -c config/config.yaml -j 8

# 3. Check results
cat results/ranked_candidates.tsv
```

## Usage

### Full pipeline

```bash
# Dry run (see what would execute)
deepmine run --dry-run

# Run with GPU acceleration for the scoring model
# Edit config/config.yaml: gpu: true
deepmine run -j 8
```

### Score pre-extracted BGCs

If you already have BGC GenBank files from antiSMASH or another tool:

```bash
deepmine score /path/to/bgc_genbanks/ -m models/activity_scorer.pt -o results/scores.tsv
```

### Train the activity scorer

Train on MIBiG reference data (or your own labeled BGCs):

```bash
deepmine train \
  --mibig-dir data/mibig/genbanks/ \
  --labels data/mibig/activity_labels.csv \
  --output models/activity_scorer.pt \
  --epochs 50 \
  --device cuda
```

### Fetch public data

```bash
# From NCBI SRA
deepmine fetch --sra SRR12345678 SRR87654321 -o data/raw

# From MGnify (pre-assembled contigs)
deepmine fetch --mgnify MGYS00001234 -o data/raw
```

## Configuration

Edit `config/config.yaml` to customize:

- **Input sources**: SRA accessions, MGnify study IDs
- **Assembly**: minimum contig length, MEGAHIT parameters
- **BGC detection**: which tools to use, minimum consensus threshold
- **Novelty filtering**: distance cutoff from known BGC families
- **Scoring**: model path, minimum activity score threshold
- **Resources**: threads, memory, GPU usage

## Architecture

```
deepmine/                # Python library (used by CLI + programmatic access)
  models/                # ML models (transformer BGC encoder + activity scorer)
  parsers/               # Output parsers for antiSMASH, GECCO, DeepBGC
  features/              # BGC feature extraction
  utils/                 # I/O utilities
  cli.py                 # Command-line interface

workflow/                # Snakemake pipeline (self-contained scripts)
  rules/                 # Snakemake rules for each pipeline stage
  scripts/               # Standalone scripts called by Snakemake
    ensemble_bgc.py      # BGC merging (self-contained, no library imports)
    extract_features.py  # Feature extraction (self-contained)
    predict_activity.py  # Activity scoring with heuristic fallback

config/
  config.yaml            # Pipeline configuration
tests/                   # Unit tests for library modules
```

The project has two execution paths:
- **Snakemake pipeline** (`deepmine run`): workflow scripts are self-contained for portability
- **CLI scoring** (`deepmine score`, `deepmine train`): uses the `deepmine` library directly

## The activity scoring model

The core novel contribution is a multi-modal neural network that predicts antimicrobial activity from BGC features:

1. **Domain Sequence Encoder**: A transformer that processes the sequence of Pfam domains in a BGC, learning patterns associated with antimicrobial compound production
2. **Chemical Feature Encoder**: An MLP that processes predicted chemical properties (molecular weight, lipophilicity, etc.)
3. **Prediction Head**: Combines both representations to output an activity probability with MC-dropout confidence

Training data comes from MIBiG (curated reference BGCs with known products) cross-referenced with antimicrobial activity databases.

## Output

The final `ranked_candidates.tsv` contains:

| Column | Description |
|--------|-------------|
| bgc_id | Unique identifier for the BGC |
| source_sample | SRA/MGnify accession it came from |
| bgc_type | Predicted BGC class (NRPS, PKS, RiPP, etc.) |
| predicted_product | Predicted compound class |
| novelty_distance | Distance from nearest known BGC family (higher = more novel) |
| activity_score | Predicted antimicrobial activity (0-1) |
| confidence | Prediction confidence from MC-dropout |

High-scoring, high-novelty candidates are the most promising for experimental validation.

## Contributing

Contributions welcome. Key areas:

- Expanding training data beyond MIBiG
- Adding more BGC detection backends
- Improving structure prediction from domains
- Wet-lab validation of predictions (contact us if you have capacity)

## License

MIT

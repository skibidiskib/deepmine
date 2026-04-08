# DEEPMINE

**Distributed discovery of new antibiotics from environmental DNA.**

DEEPMINE is a SETI@Home-style platform where volunteers donate idle CPU time to screen public metagenomes for novel biosynthetic gene clusters (BGCs). Results are reported to a community dashboard and submitted to NCBI GenBank under BioProject [PRJNA1449212](https://www.ncbi.nlm.nih.gov/bioproject/PRJNA1449212).

99% of environmental bacteria cannot be cultured in a lab, but their DNA is publicly available. DEEPMINE mines this genomic dark matter for gene clusters that may produce new antibiotics.

**Dashboard:** [deepmine.computers.ch](https://deepmine.computers.ch)

## Quick start

```bash
npm install -g deepmine
deepmine
```

That's it. The setup wizard generates a username, picks a Docker tier, and starts mining. Results appear on the dashboard automatically.

```bash
deepmine status    # Show pipeline progress and stats
deepmine stop      # Stop mining (contributions are saved)
deepmine update    # Pull latest image and restart
deepmine logs      # Stream pipeline output
```

## How it works

```
Volunteer's machine                        Community dashboard
-------------------                        -------------------

npx deepmine                               deepmine.computers.ch
  |                                              |
  v                                              |
Docker container starts                          |
  |                                              |
  v                                              |
Fetch settings (speed, schedule, bandwidth) <----+
  |                                              |
  v                                              |
Check global processed list <------- GET /api/samples/processed
  |                                              |
  v                                              |
Pick unprocessed sample (curated first, then NCBI search)
  |                                              |
  v                                              |
Pipeline:                                        |
  1. Download reads from NCBI SRA                |
  2. Compress (pigz)                             |
  3. Assemble contigs (MEGAHIT)                  |
  4. Filter contigs >= 2kb (seqkit)              |
  5. Gene calling (Prodigal)                     |
  6. BGC detection (GECCO, antiSMASH*, DeepBGC*) |
  7. Ensemble merge + consensus voting           |
  8. Score candidates (heuristic or ML)          |
  9. Extract BGC sequences from contigs          |
  |                                              |
  v                                              |
Report progress every 30s --------> POST /api/user/{me}/progress
  |                                              |
  v                                              |
Submit results + sequences -------> POST /api/submit
Mark sample globally processed ---> POST /api/samples/processed
  |                                              |
  v                                              v
Clean up, pick next sample           Dashboard updates in real-time
                                     Discoveries available at /discoveries
                                     FASTA/CSV/JSON download at /api/export
```

*antiSMASH and DeepBGC available in standard/full tiers only

## Docker tiers

| Tier | Image size | Tools | Best for |
|------|-----------|-------|----------|
| **lite** | ~2 GB | GECCO only | Volunteers donating idle CPU |
| **standard** | ~5 GB | antiSMASH + GECCO + DeepBGC | Better accuracy, 3-tool consensus |
| **full** | ~12 GB | All tools + PyTorch ML scorer | Maximum sensitivity + ML scoring |

## User settings

Settings are configured on the dashboard profile page and read by the container each cycle:

- **Speed:** Low (25% CPU) / Medium (50%) / High (75%) / Maximum (100%)
- **Bandwidth:** 512 KB/s / 1 MB/s / 2 MB/s / 5 MB/s / 10 MB/s / Unlimited
- **Schedule:** 24/7, custom hours (e.g. 22:00-08:00), or queue mode (download at night, process by day)

## Global dedup

Every processed sample (even 0 BGCs) is reported to the dashboard. Before starting a new sample, containers fetch the global processed list so no two volunteers scan the same sample.

## Public discoveries

All BGC discoveries are publicly available at [deepmine.computers.ch/discoveries](https://deepmine.computers.ch/discoveries):

- **FASTA download** with nucleotide sequences for all BGCs
- **CSV download** with metadata (type, scores, environment, contributor)
- **JSON API** for programmatic access

Results are submitted to NCBI GenBank under BioProject PRJNA1449212.

## Project structure

```
deepmine/
  bin/cli.js              # npm CLI (setup wizard, Docker orchestration)
  dashboard/              # Next.js community dashboard
    app/
      api/
        submit/           # Receive pipeline results
        export/           # Public FASTA/CSV/JSON download
        samples/processed # Global dedup registry
        user/[username]/
          progress/       # Live pipeline progress
          settings/       # Mining preferences
      discoveries/        # Public discoveries page
    lib/
      db.ts               # SQLite schema + queries
      progress.ts         # In-memory progress tracking
  docker/
    auto.py               # Auto-mining loop (runs inside container)
    Dockerfile.lite       # GECCO only (~2 GB)
    Dockerfile.standard   # 3-tool ensemble (~5 GB)
    Dockerfile.full       # All tools + ML (~12 GB)
  pipeline/               # Python BGC detection pipeline
    deepmine/
      parsers/            # antiSMASH, GECCO, DeepBGC output parsers
      models/             # ML activity scorer
  deploy-dashboard.sh     # Safe deploy script with backup
```

## Curated samples

The pipeline starts with 20 curated metagenome accessions from extreme environments known to harbor novel chemistry:

- Lechuguilla Cave, New Mexico (487m deep, 4 million years isolated)
- Yellowstone hot springs (72-83C)
- Juan de Fuca Ridge hydrothermal vents (2200m depth)
- Guaymas Basin marine sediments (2000m)
- Iron Mountain acid mine drainage (pH 0.5)
- Stordalen Mire Arctic permafrost
- McMurdo Dry Valleys Antarctic soil
- Sundarbans mangrove forests

After curated samples are exhausted, the pipeline searches NCBI SRA for random WGS metagenomes.

## Infrastructure

- **Dashboard:** Oracle Cloud (.147), PM2, nginx, Let's Encrypt SSL
- **Docker images:** Docker Hub (`skibidiskib/deepmine-miner:{lite,standard,full}`)
- **npm package:** [deepmine](https://www.npmjs.com/package/deepmine)
- **NCBI BioProject:** [PRJNA1449212](https://www.ncbi.nlm.nih.gov/bioproject/PRJNA1449212)
- **Database backups:** Daily at 3 AM UTC, 30-day retention

## Contributing

Contributions welcome:

- Run the miner: `npm install -g deepmine && deepmine`
- Improve BGC detection accuracy
- Add new environment-specific sample lists
- Wet-lab validation of computational predictions
- Dashboard features and visualizations

## License

MIT

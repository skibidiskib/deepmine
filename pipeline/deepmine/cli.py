"""DEEPMINE command-line interface."""

import argparse
import sys
from pathlib import Path


def main():
    parser = argparse.ArgumentParser(
        prog="deepmine",
        description="Deep Earth Exploration Pipeline for Microbial INhibitor Extraction",
    )
    subparsers = parser.add_subparsers(dest="command", required=True)

    # Run the full pipeline
    run_parser = subparsers.add_parser("run", help="Run the full DEEPMINE pipeline")
    run_parser.add_argument(
        "-c", "--config", type=Path, default=Path("config/config.yaml"),
        help="Path to config file (default: config/config.yaml)",
    )
    run_parser.add_argument(
        "-j", "--jobs", type=int, default=4,
        help="Number of parallel Snakemake jobs (default: 4)",
    )
    run_parser.add_argument(
        "--dry-run", action="store_true",
        help="Show what would be executed without running",
    )

    # Score pre-extracted BGCs
    score_parser = subparsers.add_parser("score", help="Score BGCs from GenBank files")
    score_parser.add_argument("input_dir", type=Path, help="Directory of BGC GenBank files")
    score_parser.add_argument("-m", "--model", type=Path, help="Path to trained model weights")
    score_parser.add_argument("-o", "--output", type=Path, default=Path("results/scores.tsv"))

    # Train the activity scorer
    train_parser = subparsers.add_parser("train", help="Train the activity scoring model")
    train_parser.add_argument("--mibig-dir", type=Path, required=True, help="Path to MIBiG GenBank files")
    train_parser.add_argument("--labels", type=Path, required=True, help="Path to activity labels CSV")
    train_parser.add_argument("--output", type=Path, default=Path("models/activity_scorer.pt"))
    train_parser.add_argument("--epochs", type=int, default=50)
    train_parser.add_argument("--device", default="cpu", choices=["cpu", "cuda", "mps"])

    # Download data from public databases
    fetch_parser = subparsers.add_parser("fetch", help="Download metagenomic data")
    fetch_parser.add_argument("--sra", nargs="+", help="SRA accession IDs to download")
    fetch_parser.add_argument("--mgnify", nargs="+", help="MGnify study IDs to download assemblies")
    fetch_parser.add_argument("-o", "--output-dir", type=Path, default=Path("data/raw"))

    # Report results to community dashboard
    report_parser = subparsers.add_parser("report", help="Report results to community dashboard")
    report_parser.add_argument("results_dir", type=Path, help="Path to pipeline results directory")
    report_parser.add_argument(
        "--url", default="http://localhost:6767",
        help="Dashboard URL (default: http://localhost:6767)",
    )
    report_parser.add_argument("--username", help="Your contributor username")
    report_parser.add_argument("--name", help="Your display name")
    report_parser.add_argument("--institution", help="Your research institution")
    report_parser.add_argument("--github", help="Your GitHub profile URL")

    args = parser.parse_args()

    if args.command == "run":
        _run_pipeline(args)
    elif args.command == "score":
        _score_bgcs(args)
    elif args.command == "train":
        _train_model(args)
    elif args.command == "fetch":
        _fetch_data(args)
    elif args.command == "report":
        _report_results(args)


def _run_pipeline(args):
    """Execute the Snakemake pipeline."""
    import subprocess

    cmd = ["snakemake", "--configfile", str(args.config), "-j", str(args.jobs)]
    if args.dry_run:
        cmd.append("-n")

    print(f"Running DEEPMINE pipeline with config: {args.config}")
    result = subprocess.run(cmd, check=False)
    sys.exit(result.returncode)


def _score_bgcs(args):
    """Score pre-extracted BGCs without running the full pipeline."""
    import torch
    from deepmine.models.activity_scorer import ActivityScorer, predict
    from deepmine.models.training_data import (
        _extract_pfam_domains_from_genbank,
        _extract_chemical_features_from_genbank,
    )
    from deepmine.utils.io import write_results

    genbank_files = sorted(args.input_dir.glob("*.gbk")) + sorted(args.input_dir.glob("*.gb"))
    if not genbank_files:
        print(f"No GenBank files found in {args.input_dir}")
        sys.exit(1)

    print(f"Found {len(genbank_files)} BGC files")

    # Load model
    device = "cuda" if torch.cuda.is_available() else "cpu"
    checkpoint = torch.load(args.model, map_location=device, weights_only=True)
    model = ActivityScorer(
        domain_vocab_size=checkpoint["domain_vocab_size"],
        chemical_feature_dim=checkpoint["chemical_feature_dim"],
    )
    model.load_state_dict(checkpoint["model_state_dict"])
    domain_vocab = checkpoint["domain_vocab"]

    # Extract features and predict (matching the predict() API)
    bgc_features = []
    for gbk in genbank_files:
        domain_ids = _extract_pfam_domains_from_genbank(gbk)
        chemical_features = _extract_chemical_features_from_genbank(gbk)
        bgc_features.append({
            "bgc_id": gbk.stem,
            "domain_ids": domain_ids,
            "chemical_features": chemical_features,
        })

    results = predict(model, bgc_features, domain_vocab, device=device)
    write_results(results, args.output)
    print(f"Results written to {args.output}")


def _train_model(args):
    """Train the activity scoring model on MIBiG data."""
    import torch
    from deepmine.models.activity_scorer import ActivityScorer, train_model
    from deepmine.models.training_data import build_training_set_from_mibig, build_domain_vocabulary

    print("Building domain vocabulary from MIBiG...")
    genbank_files = sorted(args.mibig_dir.glob("**/*.gbk"))
    domain_vocab = build_domain_vocabulary(genbank_files)
    print(f"Vocabulary size: {len(domain_vocab)}")

    print("Building training dataset...")
    dataset = build_training_set_from_mibig(args.mibig_dir, args.labels)

    # Split 80/20
    train_size = int(0.8 * len(dataset))
    val_size = len(dataset) - train_size
    train_dataset, val_dataset = torch.utils.data.random_split(dataset, [train_size, val_size])

    print(f"Training: {train_size}, Validation: {val_size}")

    model = ActivityScorer(
        domain_vocab_size=len(domain_vocab),
        chemical_feature_dim=dataset.chemical_feature_dim,
    )

    history = train_model(
        model, train_dataset, val_dataset,
        epochs=args.epochs, device=args.device,
    )

    args.output.parent.mkdir(parents=True, exist_ok=True)
    torch.save({
        "model_state_dict": model.state_dict(),
        "domain_vocab": domain_vocab,
        "domain_vocab_size": len(domain_vocab),
        "chemical_feature_dim": dataset.chemical_feature_dim,
        "history": history,
    }, args.output)
    print(f"Model saved to {args.output}")
    print(f"Best validation AUROC: {history['best_val_auroc']:.4f}")


def _fetch_data(args):
    """Download metagenomic data from public databases."""
    import subprocess

    args.output_dir.mkdir(parents=True, exist_ok=True)

    if args.sra:
        for accession in args.sra:
            print(f"Downloading {accession} from SRA...")
            subprocess.run(
                ["fasterq-dump", accession, "-O", str(args.output_dir), "--threads", "4"],
                check=True,
            )

    if args.mgnify:
        import requests

        for study_id in args.mgnify:
            print(f"Fetching assemblies for MGnify study {study_id}...")
            url = f"https://www.ebi.ac.uk/metagenomics/api/v1/studies/{study_id}/analyses"
            resp = requests.get(url, timeout=30)
            resp.raise_for_status()
            data = resp.json()

            for analysis in data.get("data", []):
                analysis_id = analysis["id"]
                dl_url = f"https://www.ebi.ac.uk/metagenomics/api/v1/analyses/{analysis_id}/downloads"
                dl_resp = requests.get(dl_url, timeout=30)
                dl_resp.raise_for_status()

                for dl in dl_resp.json().get("data", []):
                    desc = dl["attributes"].get("description", {}).get("label", "")
                    if "Contigs" in desc or "assembly" in desc.lower():
                        file_url = dl["links"]["self"]
                        out_path = args.output_dir / f"{analysis_id}_contigs.fasta.gz"
                        print(f"  Downloading {out_path.name}...")
                        with requests.get(file_url, stream=True, timeout=120) as r:
                            r.raise_for_status()
                            with open(out_path, "wb") as f:
                                for chunk in r.iter_content(chunk_size=8192):
                                    f.write(chunk)

    print("Download complete.")


def _report_results(args):
    """Report pipeline results to the community dashboard."""
    from deepmine.telemetry import report_results

    report_results(
        results_dir=args.results_dir,
        dashboard_url=args.url,
        username=args.username,
        display_name=args.name,
        institution=args.institution,
        github_url=args.github,
    )


if __name__ == "__main__":
    main()

"""
DEEPMINE: Activity Prediction
Run the trained ML model (scikit-learn or compatible) on extracted
features to predict antimicrobial activity probability for each BGC.

Called via Snakemake `script:` directive. Expects the `snakemake` object
with inputs, outputs, params, and log as defined in scoring.smk.

Model format: a pickle file containing a dict with keys:
  - "model": fitted sklearn estimator with .predict_proba()
  - "feature_names": list of feature column names the model expects
  - "version": model version string
"""

import csv
import logging
import os
import pickle
from pathlib import Path

import numpy as np


def load_model(model_path: str) -> dict:
    """
    Load the trained activity scoring model from a pickle file.
    Returns a dict with 'model', 'feature_names', and 'version'.
    """
    with open(model_path, "rb") as f:
        payload = pickle.load(f)

    if isinstance(payload, dict) and "model" in payload:
        return payload

    # If the pickle is just a bare estimator, wrap it
    return {
        "model": payload,
        "feature_names": None,
        "version": "unknown",
    }


def prepare_feature_matrix(features_tsv: str, expected_features: list = None) -> tuple:
    """
    Read the features TSV and build a numpy matrix aligned to the
    model's expected feature order.

    Returns (X, bgc_ids) where X is shape (n_bgcs, n_features).
    """
    rows = []
    bgc_ids = []
    feature_names = None

    with open(features_tsv) as f:
        reader = csv.DictReader(f, delimiter="\t")
        feature_names = [c for c in reader.fieldnames if c != "bgc_id"]
        for row in reader:
            bgc_ids.append(row["bgc_id"])
            rows.append(row)

    if not rows:
        return np.empty((0, 0)), []

    # Determine column order
    if expected_features is not None:
        columns = expected_features
    else:
        columns = feature_names

    # Build matrix
    X = np.zeros((len(rows), len(columns)), dtype=np.float64)
    for i, row in enumerate(rows):
        for j, col in enumerate(columns):
            try:
                X[i, j] = float(row.get(col, 0))
            except (ValueError, TypeError):
                X[i, j] = 0.0

    return X, bgc_ids


def score_with_model(model, X: np.ndarray) -> tuple:
    """
    Run the model on feature matrix X.
    Returns (activity_scores, confidence_scores) as arrays.

    For classifiers with predict_proba, activity_score = P(active)
    and confidence = max class probability.
    For regressors, activity_score = prediction, confidence = 1.0.
    """
    n = X.shape[0]
    if n == 0:
        return np.array([]), np.array([])

    if hasattr(model, "predict_proba"):
        proba = model.predict_proba(X)
        # Assuming binary classification: column 1 = P(active)
        if proba.shape[1] >= 2:
            activity_scores = proba[:, 1]
        else:
            activity_scores = proba[:, 0]
        confidence = np.max(proba, axis=1)
    elif hasattr(model, "predict"):
        activity_scores = model.predict(X)
        # Clip to [0, 1] for interpretability
        activity_scores = np.clip(activity_scores, 0.0, 1.0)
        confidence = np.ones(n)
    else:
        raise ValueError("Model has neither predict_proba nor predict method.")

    return activity_scores, confidence


def fallback_heuristic_scoring(features_tsv: str) -> tuple:
    """
    When no trained model is available, compute a heuristic activity
    score based on genomic features. This allows the pipeline to run
    end-to-end even without a trained model file.

    Heuristic: weighted combination of:
      - Gene density (more genes per kb = more complex)
      - Presence of large/mega enzymes (NRPS/PKS indicator)
      - Small ORFs (precursor peptide indicator)
      - Number of detection tools that agreed
      - GC content deviation from 50% (unusual = potentially novel)
    """
    rows = []
    bgc_ids = []

    with open(features_tsv) as f:
        reader = csv.DictReader(f, delimiter="\t")
        for row in reader:
            bgc_ids.append(row["bgc_id"])
            rows.append(row)

    if not rows:
        return [], [], []

    activity_scores = []
    confidence_scores = []

    for row in rows:
        score = 0.0
        weight_sum = 0.0

        # Gene density score (0-1, higher is better, capped at 5 genes/kb)
        gene_density = float(row.get("gene_density", 0))
        score += 0.20 * min(gene_density / 5.0, 1.0)
        weight_sum += 0.20

        # Large enzyme presence
        large = int(row.get("domain_large_enzyme", 0))
        mega = int(row.get("domain_mega_enzyme", 0))
        enzyme_score = min((large + 2 * mega) / 5.0, 1.0)
        score += 0.25 * enzyme_score
        weight_sum += 0.25

        # Small ORF presence (precursor peptides)
        small_orf = int(row.get("domain_small_orf", 0))
        score += 0.10 * min(small_orf / 3.0, 1.0)
        weight_sum += 0.10

        # Cysteine-rich domains (thiopeptide/lanthipeptide)
        cys = int(row.get("domain_cysteine_rich", 0))
        score += 0.15 * min(cys / 3.0, 1.0)
        weight_sum += 0.15

        # BGC length bonus (longer clusters tend to produce more complex molecules)
        length = float(row.get("bgc_length", 0))
        length_score = min(length / 80000, 1.0)  # Cap at 80kb
        score += 0.15 * length_score
        weight_sum += 0.15

        # GC deviation from 50% (unusual organisms often have novel chemistry)
        gc = float(row.get("gc_content", 0.5))
        gc_deviation = abs(gc - 0.5) * 2  # Normalize to 0-1
        score += 0.10 * gc_deviation
        weight_sum += 0.10

        # Known active type bonus
        type_nrps = int(row.get("type_NRPS", 0))
        type_pks = (int(row.get("type_T1PKS", 0)) +
                    int(row.get("type_T2PKS", 0)) +
                    int(row.get("type_T3PKS", 0)))
        type_ripp = int(row.get("type_RiPP", 0))
        type_bonus = 0.05 * (type_nrps + min(type_pks, 1) + type_ripp)
        score += min(type_bonus, 0.05)
        weight_sum += 0.05

        # Normalize
        final_score = round(score / max(weight_sum, 0.01), 4)
        activity_scores.append(min(final_score, 1.0))

        # Confidence for heuristic: based on number of features available
        non_zero = sum(1 for k, v in row.items()
                       if k != "bgc_id" and v and float(v) != 0)
        total_features = len(row) - 1  # exclude bgc_id
        confidence_scores.append(round(non_zero / max(total_features, 1), 4))

    return bgc_ids, activity_scores, confidence_scores


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    logging.basicConfig(
        filename=snakemake.log[0],
        level=logging.INFO,
        format="%(asctime)s %(levelname)s: %(message)s",
    )
    logger = logging.getLogger("predict_activity")

    features_tsv = str(snakemake.input.features)
    output_path = str(snakemake.output.predictions)
    model_path = str(snakemake.params.model_path)

    os.makedirs(os.path.dirname(output_path), exist_ok=True)

    # Check if we have any BGCs to score
    with open(features_tsv) as f:
        reader = csv.DictReader(f, delimiter="\t")
        row_count = sum(1 for _ in reader)

    if row_count == 0:
        logger.info("No BGCs to score; writing empty predictions file.")
        with open(output_path, "w") as f:
            f.write("bgc_id\tactivity_score\tconfidence\n")
        return

    logger.info(f"Scoring {row_count} BGCs...")

    # Try loading the trained model
    use_heuristic = False
    if os.path.exists(model_path):
        try:
            model_data = load_model(model_path)
            model = model_data["model"]
            expected_features = model_data.get("feature_names")
            logger.info(
                f"Loaded model version '{model_data.get('version', 'unknown')}' "
                f"from {model_path}"
            )
        except Exception as e:
            logger.warning(f"Failed to load model from {model_path}: {e}")
            logger.info("Falling back to heuristic scoring.")
            use_heuristic = True
    else:
        logger.warning(f"Model file not found at {model_path}")
        logger.info("Falling back to heuristic scoring.")
        use_heuristic = True

    if use_heuristic:
        bgc_ids, activity_scores, confidence_scores = fallback_heuristic_scoring(
            features_tsv
        )
    else:
        X, bgc_ids = prepare_feature_matrix(features_tsv, expected_features)
        logger.info(f"Feature matrix shape: {X.shape}")
        activity_scores, confidence_scores = score_with_model(model, X)

    # Write predictions
    with open(output_path, "w", newline="") as f:
        writer = csv.writer(f, delimiter="\t")
        writer.writerow(["bgc_id", "activity_score", "confidence"])
        for bgc_id, score, conf in zip(bgc_ids, activity_scores, confidence_scores):
            writer.writerow([bgc_id, round(float(score), 4), round(float(conf), 4)])

    if len(activity_scores) > 0:
        max_score = max(float(s) for s in activity_scores)
        mean_score = sum(float(s) for s in activity_scores) / len(activity_scores)
        logger.info(
            f"Predictions complete. "
            f"N={len(activity_scores)}, "
            f"mean={mean_score:.4f}, max={max_score:.4f}"
        )
        scoring_method = "heuristic" if use_heuristic else "model"
        logger.info(f"Scoring method: {scoring_method}")
    else:
        logger.info("No predictions generated.")


main()

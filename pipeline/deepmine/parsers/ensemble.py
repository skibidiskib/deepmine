from __future__ import annotations

import logging
from collections import Counter
from dataclasses import dataclass, field
from typing import Protocol, Sequence

logger = logging.getLogger(__name__)


class _BGCLike(Protocol):
    """Structural typing for any BGC result dataclass."""

    bgc_id: str
    contig: str
    start: int
    end: int
    bgc_type: str


@dataclass
class ConsensusResult:
    bgc_id: str
    contig: str
    start: int
    end: int
    bgc_type: str
    detectors: list[str] = field(default_factory=list)
    confidence: float = 0.0


def merge_detections(
    antismash: Sequence[_BGCLike],
    gecco: Sequence[_BGCLike],
    deepbgc: Sequence[_BGCLike],
    min_overlap_bp: int = 500,
    min_consensus: int = 2,
) -> list[ConsensusResult]:
    """Merge BGC detections from multiple tools into consensus calls.

    Groups all detections by contig, then iteratively merges overlapping
    intervals across detectors using a greedy interval-overlap strategy.
    Only clusters supported by at least ``min_consensus`` independent
    detectors are retained. The consensus BGC type is assigned by majority
    vote across the contributing detections.
    """
    # Tag each detection with its source detector
    tagged: list[tuple[str, _BGCLike]] = []
    for item in antismash:
        tagged.append(("antiSMASH", item))
    for item in gecco:
        tagged.append(("GECCO", item))
    for item in deepbgc:
        tagged.append(("DeepBGC", item))

    # Group by contig
    by_contig: dict[str, list[tuple[str, _BGCLike]]] = {}
    for detector, bgc in tagged:
        by_contig.setdefault(bgc.contig, []).append((detector, bgc))

    consensus: list[ConsensusResult] = []
    global_idx = 0

    for contig, detections in sorted(by_contig.items()):
        # Sort by start position
        detections.sort(key=lambda x: x[1].start)
        clusters = _cluster_overlapping(detections, min_overlap_bp)

        for cluster in clusters:
            detector_set = {det for det, _ in cluster}
            if len(detector_set) < min_consensus:
                continue

            global_idx += 1
            merged_start = min(bgc.start for _, bgc in cluster)
            merged_end = max(bgc.end for _, bgc in cluster)
            bgc_type = _majority_vote_type(cluster)
            confidence = _compute_confidence(cluster, detector_set)

            consensus.append(
                ConsensusResult(
                    bgc_id=f"consensus_{global_idx:04d}",
                    contig=contig,
                    start=merged_start,
                    end=merged_end,
                    bgc_type=bgc_type,
                    detectors=sorted(detector_set),
                    confidence=confidence,
                )
            )

    return consensus


def _cluster_overlapping(
    detections: list[tuple[str, _BGCLike]],
    min_overlap_bp: int,
) -> list[list[tuple[str, _BGCLike]]]:
    """Group detections into clusters where members overlap by at least
    ``min_overlap_bp`` base pairs. Uses a greedy single-linkage approach:
    each new detection is added to the most recent cluster if it overlaps
    with the cluster's current extent, otherwise a new cluster is started."""
    if not detections:
        return []

    clusters: list[list[tuple[str, _BGCLike]]] = []
    current_cluster: list[tuple[str, _BGCLike]] = [detections[0]]
    cluster_start = detections[0][1].start
    cluster_end = detections[0][1].end

    for det, bgc in detections[1:]:
        overlap = min(cluster_end, bgc.end) - max(cluster_start, bgc.start)
        if overlap >= min_overlap_bp:
            current_cluster.append((det, bgc))
            cluster_start = min(cluster_start, bgc.start)
            cluster_end = max(cluster_end, bgc.end)
        else:
            clusters.append(current_cluster)
            current_cluster = [(det, bgc)]
            cluster_start = bgc.start
            cluster_end = bgc.end

    clusters.append(current_cluster)
    return clusters


def _majority_vote_type(cluster: list[tuple[str, _BGCLike]]) -> str:
    """Determine the consensus BGC type by majority vote.

    Normalises types to lowercase for comparison. In case of a tie, picks
    the type from the detector with highest trust rank (antiSMASH > GECCO
    > DeepBGC)."""
    trust_rank = {"antiSMASH": 0, "GECCO": 1, "DeepBGC": 2}
    type_counter: Counter[str] = Counter()
    type_to_detector_rank: dict[str, int] = {}

    for det, bgc in cluster:
        normalised = bgc.bgc_type.lower().strip()
        type_counter[normalised] += 1
        existing_rank = type_to_detector_rank.get(normalised, 999)
        type_to_detector_rank[normalised] = min(existing_rank, trust_rank.get(det, 99))

    if not type_counter:
        return "unknown"

    max_count = max(type_counter.values())
    top_types = [t for t, c in type_counter.items() if c == max_count]

    if len(top_types) == 1:
        return top_types[0]

    # Break tie by detector trust
    top_types.sort(key=lambda t: type_to_detector_rank.get(t, 999))
    return top_types[0]


def _compute_confidence(
    cluster: list[tuple[str, _BGCLike]],
    detector_set: set[str],
) -> float:
    """Compute a confidence score in [0, 1] based on:

    - Number of independent detectors (3/3 = 1.0 base)
    - Coordinate agreement: tighter overlap = higher confidence
    - Type agreement bonus
    """
    n_detectors = len(detector_set)
    max_detectors = 3.0

    # Detector coverage: fraction of possible detectors
    detector_score = n_detectors / max_detectors

    # Coordinate agreement: ratio of intersection to union
    starts = [bgc.start for _, bgc in cluster]
    ends = [bgc.end for _, bgc in cluster]
    intersection_len = max(0, min(ends) - max(starts))
    union_len = max(ends) - min(starts)
    coord_score = intersection_len / union_len if union_len > 0 else 0.0

    # Type agreement: fraction of detections with the same type
    types = [bgc.bgc_type.lower().strip() for _, bgc in cluster]
    type_counter = Counter(types)
    most_common_count = type_counter.most_common(1)[0][1] if type_counter else 0
    type_score = most_common_count / len(types) if types else 0.0

    # Weighted combination
    confidence = 0.5 * detector_score + 0.3 * coord_score + 0.2 * type_score
    return round(min(confidence, 1.0), 4)

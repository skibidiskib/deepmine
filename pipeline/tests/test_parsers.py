"""Tests for BGC output parsers and ensemble consensus."""

import json
import tempfile
from pathlib import Path

import pytest

from deepmine.parsers.ensemble import ConsensusResult, merge_detections


class FakeBGC:
    """Minimal BGC result for testing merge logic."""

    def __init__(self, contig, start, end, bgc_type="NRPS"):
        self.bgc_id = f"{contig}_{start}_{end}"
        self.contig = contig
        self.start = start
        self.end = end
        self.bgc_type = bgc_type
        self.product_class = bgc_type
        self.domains = []
        self.smiles_prediction = None
        self.score = 0.9


class TestMergeDetections:
    def test_consensus_requires_minimum_tools(self):
        """BGCs detected by only one tool should be filtered out with min_consensus=2."""
        antismash = [FakeBGC("contig1", 1000, 5000)]
        gecco = []
        deepbgc = []

        result = merge_detections(antismash, gecco, deepbgc, min_consensus=2)
        assert len(result) == 0

    def test_overlapping_bgcs_merged(self):
        """BGCs on the same contig with overlapping coordinates should merge."""
        antismash = [FakeBGC("contig1", 1000, 5000)]
        gecco = [FakeBGC("contig1", 1200, 4800)]
        deepbgc = []

        result = merge_detections(antismash, gecco, deepbgc, min_consensus=2)
        assert len(result) == 1
        assert "antiSMASH" in result[0].detectors
        assert "GECCO" in result[0].detectors

    def test_non_overlapping_bgcs_separate(self):
        """BGCs on the same contig but far apart should not merge."""
        antismash = [FakeBGC("contig1", 1000, 2000)]
        gecco = [FakeBGC("contig1", 50000, 55000)]
        deepbgc = []

        result = merge_detections(antismash, gecco, deepbgc, min_consensus=2)
        assert len(result) == 0

    def test_three_tool_consensus(self):
        """BGC detected by all three tools should have high confidence."""
        antismash = [FakeBGC("contig1", 1000, 5000)]
        gecco = [FakeBGC("contig1", 1100, 4900)]
        deepbgc = [FakeBGC("contig1", 900, 5100)]

        result = merge_detections(antismash, gecco, deepbgc, min_consensus=2)
        assert len(result) == 1
        assert len(result[0].detectors) == 3
        assert result[0].confidence > 0.8

    def test_different_contigs_not_merged(self):
        """BGCs on different contigs should never merge."""
        antismash = [FakeBGC("contig1", 1000, 5000)]
        gecco = [FakeBGC("contig2", 1000, 5000)]
        deepbgc = []

        result = merge_detections(antismash, gecco, deepbgc, min_consensus=2)
        assert len(result) == 0

    def test_consensus_bgc_type_majority_vote(self):
        """BGC type should be determined by majority vote."""
        antismash = [FakeBGC("contig1", 1000, 5000, "NRPS")]
        gecco = [FakeBGC("contig1", 1100, 4900, "PKS")]
        deepbgc = [FakeBGC("contig1", 900, 5100, "NRPS")]

        result = merge_detections(antismash, gecco, deepbgc, min_consensus=2)
        assert result[0].bgc_type == "nrps"  # majority_vote normalises to lowercase

    def test_min_consensus_one_keeps_all(self):
        """With min_consensus=1, all detected BGCs should pass."""
        antismash = [FakeBGC("contig1", 1000, 5000)]
        gecco = [FakeBGC("contig2", 10000, 15000)]
        deepbgc = [FakeBGC("contig3", 20000, 25000)]

        result = merge_detections(antismash, gecco, deepbgc, min_consensus=1)
        assert len(result) == 3


class TestConsensusResult:
    def test_fields(self):
        r = ConsensusResult(
            bgc_id="test_1",
            contig="contig1",
            start=100,
            end=5000,
            bgc_type="NRPS",
            detectors=["antismash", "gecco"],
            confidence=0.85,
        )
        assert r.bgc_id == "test_1"
        assert r.end - r.start == 4900
        assert len(r.detectors) == 2

"""Tests for the activity scoring model."""

import pytest
import torch

from deepmine.models.bgc_encoder import DomainSequenceEncoder, ChemicalFeatureEncoder
from deepmine.models.activity_scorer import ActivityScorer, ActivityDataset, BGCSample


class TestDomainSequenceEncoder:
    def test_output_shape(self):
        encoder = DomainSequenceEncoder(vocab_size=1000, embed_dim=64, n_heads=4, n_layers=2)
        domain_ids = torch.randint(0, 1000, (4, 50))  # batch=4, seq_len=50
        mask = torch.ones(4, 50, dtype=torch.bool)
        output = encoder(domain_ids, mask)
        assert output.shape == (4, 64)

    def test_masking(self):
        encoder = DomainSequenceEncoder(vocab_size=100, embed_dim=32, n_heads=2, n_layers=1)
        domain_ids = torch.randint(0, 100, (2, 20))
        mask = torch.ones(2, 20, dtype=torch.bool)
        mask[1, 10:] = False  # second sample has shorter sequence

        output = encoder(domain_ids, mask)
        assert output.shape == (2, 32)
        assert not torch.isnan(output).any()


class TestChemicalFeatureEncoder:
    def test_output_shape(self):
        encoder = ChemicalFeatureEncoder(input_dim=15)
        features = torch.randn(8, 15)
        output = encoder(features)
        assert output.shape == (8, 32)


class TestActivityScorer:
    def test_forward(self):
        model = ActivityScorer(domain_vocab_size=500, chemical_feature_dim=10, embed_dim=64)
        domain_ids = torch.randint(0, 500, (3, 30))
        domain_mask = torch.ones(3, 30, dtype=torch.bool)
        chem_features = torch.randn(3, 10)

        score = model(domain_ids, domain_mask, chem_features)
        assert score.shape == (3,)  # squeeze(-1) removes last dim
        assert (score >= 0).all() and (score <= 1).all()

    def test_deterministic_in_eval(self):
        model = ActivityScorer(domain_vocab_size=500, chemical_feature_dim=10)
        model.eval()

        domain_ids = torch.randint(0, 500, (2, 20))
        mask = torch.ones(2, 20, dtype=torch.bool)
        chem = torch.randn(2, 10)

        with torch.no_grad():
            s1 = model(domain_ids, mask, chem)
            s2 = model(domain_ids, mask, chem)
        assert torch.allclose(s1, s2)


class TestActivityDataset:
    def test_creation(self):
        samples = [
            BGCSample(domain_ids=[1, 2, 3], chemical_features=[0.1, 0.2, 0.3, 0.4, 0.5], label=1.0),
            BGCSample(domain_ids=[4, 5], chemical_features=[0.6, 0.7, 0.8, 0.9, 1.0], label=0.0),
        ]
        dataset = ActivityDataset(samples)
        assert len(dataset) == 2

        sample = dataset[0]
        assert sample.domain_ids == [1, 2, 3]
        assert len(sample.chemical_features) == 5

    def test_collate_pads_sequences(self):
        samples = [
            BGCSample(domain_ids=[1, 2, 3, 4, 5], chemical_features=[0.1, 0.2, 0.3], label=1.0),
            BGCSample(domain_ids=[6, 7], chemical_features=[0.4, 0.5, 0.6], label=0.0),
            BGCSample(domain_ids=[8, 9, 10], chemical_features=[0.7, 0.8, 0.9], label=1.0),
        ]
        dataset = ActivityDataset(samples)
        domain_ids, domain_mask, chem_features, labels = ActivityDataset.collate_fn(
            [dataset[i] for i in range(3)]
        )

        assert domain_ids.shape == (3, 5)  # padded to longest
        assert domain_mask.shape == (3, 5)
        assert domain_mask[0].all()  # first sample fully unmasked
        assert not domain_mask[1, 2:].any()  # second sample padded
        assert chem_features.shape == (3, 3)
        assert labels.shape == (3,)

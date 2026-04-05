"""
DEEPMINE Activity Scorer: multi-modal antimicrobial activity prediction.

This is the core novel contribution of DEEPMINE. The model fuses two
complementary views of a biosynthetic gene cluster:

1. **Domain architecture** (sequential): The ordered Pfam domain sequence
   is encoded by a Transformer (``DomainSequenceEncoder``), capturing which
   enzymatic modules are present and how they are arranged. This is analogous
   to how a chemist reads a BGC's "assembly line" to predict the product.

2. **Chemical/genomic features** (tabular): Pre-computed numerical
   descriptors (GC content, cluster size, gene count, predicted molecular
   weight, etc.) are compressed by a small MLP
   (``ChemicalFeatureEncoder``).

The two representation vectors are concatenated and fed through a prediction
head that outputs a scalar antimicrobial activity probability.

Confidence estimation uses MC (Monte Carlo) Dropout: at inference time,
dropout layers remain active across *N* forward passes, and the variance of
the predictions serves as an epistemic uncertainty estimate.  BGCs with high
mean score and low variance are the highest-priority candidates for wet-lab
validation.
"""

from __future__ import annotations

import copy
import logging
from dataclasses import dataclass, field
from typing import Any

import numpy as np
import torch
import torch.nn as nn
from sklearn.metrics import roc_auc_score
from torch import Tensor
from torch.utils.data import DataLoader, Dataset

from deepmine.models.bgc_encoder import ChemicalFeatureEncoder, DomainSequenceEncoder

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Special token indices (must match the vocabulary built by training_data.py)
# ---------------------------------------------------------------------------
PAD_IDX = 0
UNK_IDX = 1


# ===================================================================
# Model
# ===================================================================


class ActivityScorer(nn.Module):
    """Multi-modal BGC antimicrobial activity scoring model.

    Combines a Transformer-based domain sequence encoder with an MLP-based
    chemical feature encoder, then predicts the probability that a BGC
    produces an antimicrobial compound.

    Args:
        domain_vocab_size: Size of the Pfam domain vocabulary (including
            ``<PAD>`` and ``<UNK>`` tokens).
        chemical_feature_dim: Number of numerical chemical/genomic features.
        embed_dim: Dimensionality of the domain embedding / Transformer
            hidden state. The chemical encoder always outputs 32-d, so the
            concatenated vector is ``embed_dim + 32``.
        n_heads: Transformer attention heads.
        n_layers: Transformer encoder layers.
        max_seq_len: Maximum domain sequence length.
        dropout: Dropout probability (also used for MC Dropout at inference).
    """

    def __init__(
        self,
        domain_vocab_size: int,
        chemical_feature_dim: int,
        embed_dim: int = 128,
        n_heads: int = 4,
        n_layers: int = 3,
        max_seq_len: int = 200,
        dropout: float = 0.1,
    ):
        super().__init__()

        self.domain_encoder = DomainSequenceEncoder(
            vocab_size=domain_vocab_size,
            embed_dim=embed_dim,
            n_heads=n_heads,
            n_layers=n_layers,
            max_seq_len=max_seq_len,
            dropout=dropout,
        )
        self.chemical_encoder = ChemicalFeatureEncoder(
            input_dim=chemical_feature_dim,
            dropout=dropout,
        )

        # Prediction head.  Input size = embed_dim (128) + 32 = 160 by default.
        concat_dim = embed_dim + 32
        self.prediction_head = nn.Sequential(
            nn.Linear(concat_dim, 64),
            nn.ReLU(inplace=True),
            nn.Dropout(p=dropout),
            nn.Linear(64, 32),
            nn.ReLU(inplace=True),
            nn.Dropout(p=dropout),
            nn.Linear(32, 1),
        )

    def forward(
        self,
        domain_ids: Tensor,
        domain_mask: Tensor,
        chemical_features: Tensor,
    ) -> Tensor:
        """Score a batch of BGCs for antimicrobial activity.

        Args:
            domain_ids: ``(batch, seq_len)`` integer tensor of Pfam domain
                vocabulary indices.
            domain_mask: ``(batch, seq_len)`` boolean tensor where ``True``
                marks valid (non-padding) positions.
            chemical_features: ``(batch, chemical_feature_dim)`` float tensor.

        Returns:
            ``(batch,)`` float tensor of activity probabilities in [0, 1].
        """
        domain_repr = self.domain_encoder(domain_ids, domain_mask)  # (B, embed_dim)
        chem_repr = self.chemical_encoder(chemical_features)  # (B, 32)

        combined = torch.cat([domain_repr, chem_repr], dim=-1)  # (B, 160)
        logit = self.prediction_head(combined).squeeze(-1)  # (B,)

        return torch.sigmoid(logit)


# ===================================================================
# Dataset
# ===================================================================


@dataclass
class BGCSample:
    """A single training/inference sample."""

    domain_ids: list[int]
    chemical_features: list[float]
    label: float  # 1.0 = antimicrobial, 0.0 = non-antimicrobial


class ActivityDataset(Dataset):
    """PyTorch dataset for BGC activity prediction.

    Each element is a ``BGCSample`` containing variable-length domain ID
    sequences, fixed-length chemical features, and a binary label.

    Use the provided ``collate_fn`` with :class:`torch.utils.data.DataLoader`
    to handle padding of domain sequences within a batch.

    Args:
        samples: List of ``BGCSample`` instances.
    """

    def __init__(self, samples: list[BGCSample]):
        self.samples = samples

    @property
    def chemical_feature_dim(self) -> int:
        """Number of chemical/genomic features per sample."""
        if self.samples:
            return len(self.samples[0].chemical_features)
        return 0

    def __len__(self) -> int:
        return len(self.samples)

    def __getitem__(self, idx: int) -> BGCSample:
        return self.samples[idx]

    @staticmethod
    def collate_fn(
        batch: list[BGCSample],
    ) -> tuple[Tensor, Tensor, Tensor, Tensor]:
        """Collate variable-length BGC samples into padded batch tensors.

        Pads domain ID sequences to the length of the longest sequence in
        the batch (not the global ``max_seq_len``) to minimise wasted
        computation.

        Returns:
            Tuple of ``(domain_ids, domain_mask, chemical_features, labels)``
            where:
                - ``domain_ids``:  ``(B, L_max)`` long tensor, padded with 0.
                - ``domain_mask``: ``(B, L_max)`` bool tensor (``True`` = valid).
                - ``chemical_features``: ``(B, F)`` float tensor.
                - ``labels``: ``(B,)`` float tensor.
        """
        max_len = max(len(s.domain_ids) for s in batch)

        domain_ids_batch: list[list[int]] = []
        mask_batch: list[list[bool]] = []
        chem_batch: list[list[float]] = []
        labels: list[float] = []

        for sample in batch:
            seq = sample.domain_ids
            pad_len = max_len - len(seq)
            domain_ids_batch.append(seq + [PAD_IDX] * pad_len)
            mask_batch.append([True] * len(seq) + [False] * pad_len)
            chem_batch.append(sample.chemical_features)
            labels.append(sample.label)

        return (
            torch.tensor(domain_ids_batch, dtype=torch.long),
            torch.tensor(mask_batch, dtype=torch.bool),
            torch.tensor(chem_batch, dtype=torch.float32),
            torch.tensor(labels, dtype=torch.float32),
        )


# ===================================================================
# Training loop
# ===================================================================


@dataclass
class TrainingHistory:
    """Container for metrics collected during training."""

    train_losses: list[float] = field(default_factory=list)
    val_losses: list[float] = field(default_factory=list)
    val_aurocs: list[float] = field(default_factory=list)
    best_epoch: int = 0
    best_val_auroc: float = 0.0
    best_state_dict: dict[str, Any] | None = None


def train_model(
    model: ActivityScorer,
    train_dataset: ActivityDataset,
    val_dataset: ActivityDataset,
    epochs: int = 50,
    lr: float = 1e-3,
    batch_size: int = 32,
    patience: int = 10,
    device: str = "cpu",
) -> TrainingHistory:
    """Train the ActivityScorer with early stopping on validation AUROC.

    Uses AdamW optimiser with cosine-annealing learning rate schedule and
    binary cross-entropy loss.  Training stops early if the validation
    AUROC does not improve for ``patience`` consecutive epochs.

    Args:
        model: An ``ActivityScorer`` instance (will be modified in-place).
        train_dataset: Training data.
        val_dataset: Validation data for early stopping.
        epochs: Maximum number of training epochs.
        lr: Initial learning rate for AdamW.
        batch_size: Mini-batch size.
        patience: Number of epochs without AUROC improvement before stopping.
        device: ``'cpu'``, ``'cuda'``, or ``'mps'``.

    Returns:
        A ``TrainingHistory`` containing per-epoch metrics and the best
        model state dict (by validation AUROC).
    """
    model = model.to(device)
    history = TrainingHistory()

    train_loader = DataLoader(
        train_dataset,
        batch_size=batch_size,
        shuffle=True,
        collate_fn=ActivityDataset.collate_fn,
        drop_last=False,
    )
    val_loader = DataLoader(
        val_dataset,
        batch_size=batch_size,
        shuffle=False,
        collate_fn=ActivityDataset.collate_fn,
    )

    criterion = nn.BCELoss()
    optimizer = torch.optim.AdamW(model.parameters(), lr=lr, weight_decay=1e-2)
    scheduler = torch.optim.lr_scheduler.CosineAnnealingLR(
        optimizer, T_max=epochs, eta_min=lr * 0.01
    )

    epochs_without_improvement = 0

    for epoch in range(1, epochs + 1):
        # ---- Training phase ----
        model.train()
        epoch_loss = 0.0
        n_batches = 0

        for domain_ids, domain_mask, chem_feats, labels in train_loader:
            domain_ids = domain_ids.to(device)
            domain_mask = domain_mask.to(device)
            chem_feats = chem_feats.to(device)
            labels = labels.to(device)

            optimizer.zero_grad()
            preds = model(domain_ids, domain_mask, chem_feats)
            loss = criterion(preds, labels)
            loss.backward()

            # Gradient clipping for Transformer stability
            torch.nn.utils.clip_grad_norm_(model.parameters(), max_norm=1.0)

            optimizer.step()
            epoch_loss += loss.item()
            n_batches += 1

        avg_train_loss = epoch_loss / max(n_batches, 1)
        history.train_losses.append(avg_train_loss)

        scheduler.step()

        # ---- Validation phase ----
        val_loss, val_auroc = _evaluate(model, val_loader, criterion, device)
        history.val_losses.append(val_loss)
        history.val_aurocs.append(val_auroc)

        logger.info(
            "Epoch %3d/%d  train_loss=%.4f  val_loss=%.4f  val_AUROC=%.4f  lr=%.2e",
            epoch,
            epochs,
            avg_train_loss,
            val_loss,
            val_auroc,
            optimizer.param_groups[0]["lr"],
        )

        # ---- Early stopping on validation AUROC ----
        if val_auroc > history.best_val_auroc:
            history.best_val_auroc = val_auroc
            history.best_epoch = epoch
            history.best_state_dict = copy.deepcopy(model.state_dict())
            epochs_without_improvement = 0
        else:
            epochs_without_improvement += 1
            if epochs_without_improvement >= patience:
                logger.info(
                    "Early stopping at epoch %d (no AUROC improvement for %d epochs).",
                    epoch,
                    patience,
                )
                break

    # Restore best weights
    if history.best_state_dict is not None:
        model.load_state_dict(history.best_state_dict)
        logger.info(
            "Restored best model from epoch %d (val_AUROC=%.4f).",
            history.best_epoch,
            history.best_val_auroc,
        )

    return history


@torch.no_grad()
def _evaluate(
    model: ActivityScorer,
    loader: DataLoader,
    criterion: nn.BCELoss,
    device: str,
) -> tuple[float, float]:
    """Compute validation loss and AUROC."""
    model.eval()
    total_loss = 0.0
    n_batches = 0
    all_preds: list[float] = []
    all_labels: list[float] = []

    for domain_ids, domain_mask, chem_feats, labels in loader:
        domain_ids = domain_ids.to(device)
        domain_mask = domain_mask.to(device)
        chem_feats = chem_feats.to(device)
        labels = labels.to(device)

        preds = model(domain_ids, domain_mask, chem_feats)
        loss = criterion(preds, labels)
        total_loss += loss.item()
        n_batches += 1

        all_preds.extend(preds.cpu().numpy().tolist())
        all_labels.extend(labels.cpu().numpy().tolist())

    avg_loss = total_loss / max(n_batches, 1)

    # AUROC requires both classes to be present
    unique_labels = set(all_labels)
    if len(unique_labels) < 2:
        auroc = 0.5  # Degenerate case: single class in validation set
    else:
        auroc = float(roc_auc_score(all_labels, all_preds))

    return avg_loss, auroc


# ===================================================================
# Inference with MC Dropout confidence
# ===================================================================


def _enable_mc_dropout(model: nn.Module) -> None:
    """Enable dropout layers during inference for MC Dropout.

    Switches all ``Dropout`` modules to training mode while leaving
    everything else (BatchNorm, etc.) in eval mode.
    """
    for module in model.modules():
        if isinstance(module, nn.Dropout):
            module.train()


def predict(
    model: ActivityScorer,
    bgc_features: list[dict],
    domain_vocab: dict[str, int],
    device: str = "cpu",
    mc_samples: int = 20,
    max_seq_len: int = 200,
) -> list[dict]:
    """Score BGCs for antimicrobial activity with uncertainty estimation.

    Uses Monte Carlo Dropout: runs ``mc_samples`` stochastic forward
    passes with dropout active and reports the mean prediction as the
    activity score and the standard deviation as an inverse confidence
    measure.

    Args:
        model: A trained ``ActivityScorer``.
        bgc_features: List of dicts, each with keys:
            - ``bgc_id`` (str): Unique identifier for the BGC.
            - ``domain_ids`` (list[str]): Ordered Pfam domain IDs
              (e.g., ``["PF00109", "PF02801", ...]``).
            - ``chemical_features`` (list[float]): Numerical feature
              vector.
        domain_vocab: Mapping from Pfam ID string to integer vocabulary
            index (as built by ``build_domain_vocabulary``).
        device: PyTorch device string.
        mc_samples: Number of stochastic forward passes for uncertainty
            estimation.  Higher values give smoother confidence estimates
            but increase inference time linearly.
        max_seq_len: Maximum domain sequence length (longer sequences
            are truncated).

    Returns:
        List of dicts with keys ``bgc_id``, ``activity_score`` (float,
        0-1), and ``confidence`` (float, 0-1 where 1 = fully confident).
    """
    model = model.to(device)
    model.eval()
    _enable_mc_dropout(model)

    # Encode domain ID strings to vocabulary indices
    samples: list[BGCSample] = []
    bgc_ids: list[str] = []

    for bgc in bgc_features:
        ids = [
            domain_vocab.get(d, UNK_IDX)
            for d in bgc["domain_ids"][:max_seq_len]
        ]
        # Ensure at least one token (avoid empty sequences)
        if not ids:
            ids = [UNK_IDX]

        samples.append(
            BGCSample(
                domain_ids=ids,
                chemical_features=bgc["chemical_features"],
                label=0.0,  # Placeholder, not used during inference
            )
        )
        bgc_ids.append(bgc["bgc_id"])

    loader = DataLoader(
        ActivityDataset(samples),
        batch_size=64,
        shuffle=False,
        collate_fn=ActivityDataset.collate_fn,
    )

    # Collect predictions across MC samples
    all_mc_preds: list[np.ndarray] = []

    for _ in range(mc_samples):
        batch_preds: list[np.ndarray] = []
        for domain_ids, domain_mask, chem_feats, _ in loader:
            domain_ids = domain_ids.to(device)
            domain_mask = domain_mask.to(device)
            chem_feats = chem_feats.to(device)

            with torch.no_grad():
                preds = model(domain_ids, domain_mask, chem_feats)
            batch_preds.append(preds.cpu().numpy())

        all_mc_preds.append(np.concatenate(batch_preds))

    mc_matrix = np.stack(all_mc_preds, axis=0)  # (mc_samples, n_bgcs)
    mean_scores = mc_matrix.mean(axis=0)  # (n_bgcs,)
    std_scores = mc_matrix.std(axis=0)  # (n_bgcs,)

    # Convert std to a confidence score in [0, 1].
    # Maximum theoretical std for a Bernoulli variable is 0.5 (at p=0.5).
    # Confidence = 1 - (std / 0.5), clamped to [0, 1].
    confidence = np.clip(1.0 - (std_scores / 0.5), 0.0, 1.0)

    results: list[dict] = []
    for i, bgc_id in enumerate(bgc_ids):
        results.append(
            {
                "bgc_id": bgc_id,
                "activity_score": float(mean_scores[i]),
                "confidence": float(confidence[i]),
            }
        )

    return results

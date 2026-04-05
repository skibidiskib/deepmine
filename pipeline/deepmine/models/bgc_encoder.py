"""
BGC encoder networks for the DEEPMINE activity scoring model.

The key novelty is DomainSequenceEncoder: a Transformer-based encoder that
learns representations of BGC domain architectures. Rather than treating a
BGC as a flat feature vector, it models the *ordered sequence* of Pfam
protein domains, allowing it to capture long-range dependencies between
biosynthetic modules (e.g., a KS domain's context 50 domains upstream
affects the chemistry it produces).

This is fundamentally different from prior approaches (DeepBGC, PRISM) that
use either CNNs or hand-crafted feature vectors. The self-attention mechanism
learns which domain--domain interactions are most predictive of antimicrobial
activity without any prior knowledge of biosynthetic logic.
"""

from __future__ import annotations

import math

import torch
import torch.nn as nn
from torch import Tensor


class PositionalEncoding(nn.Module):
    """Sinusoidal positional encoding (Vaswani et al. 2017).

    Injects absolute position information into domain embeddings so the
    Transformer can reason about domain *order* within the BGC, which is
    biologically meaningful (e.g., colinearity rule in NRPS/PKS clusters).
    """

    def __init__(self, embed_dim: int, max_seq_len: int = 200, dropout: float = 0.1):
        super().__init__()
        self.dropout = nn.Dropout(p=dropout)

        pe = torch.zeros(max_seq_len, embed_dim)  # (L, D)
        position = torch.arange(0, max_seq_len, dtype=torch.float).unsqueeze(1)  # (L, 1)
        div_term = torch.exp(
            torch.arange(0, embed_dim, 2, dtype=torch.float)
            * (-math.log(10000.0) / embed_dim)
        )  # (D/2,)

        pe[:, 0::2] = torch.sin(position * div_term)
        pe[:, 1::2] = torch.cos(position * div_term)
        pe = pe.unsqueeze(0)  # (1, L, D) -- broadcastable over batch

        # Register as buffer (not a parameter, but moves with .to(device))
        self.register_buffer("pe", pe)

    def forward(self, x: Tensor) -> Tensor:
        """Add positional encoding to input embeddings.

        Args:
            x: Tensor of shape ``(batch, seq_len, embed_dim)``.

        Returns:
            Tensor of the same shape with positional information added.
        """
        x = x + self.pe[:, : x.size(1), :]
        return self.dropout(x)


class DomainSequenceEncoder(nn.Module):
    """Transformer encoder for BGC protein-domain sequences.

    Takes an ordered sequence of Pfam domain IDs extracted from a BGC and
    produces a fixed-size representation vector.  The architecture mirrors a
    small BERT-style encoder:

        domain_ids -> Embedding -> PositionalEncoding
                   -> N x TransformerEncoderLayer
                   -> masked mean-pooling -> projection

    Args:
        vocab_size: Number of unique Pfam domain IDs (including special tokens
            ``<PAD>=0``, ``<UNK>=1``).
        embed_dim: Dimensionality of domain embeddings and Transformer hidden
            state.
        n_heads: Number of self-attention heads.  ``embed_dim`` must be
            divisible by ``n_heads``.
        n_layers: Number of stacked Transformer encoder layers.
        max_seq_len: Maximum number of domains per BGC (sequences longer than
            this are truncated during preprocessing).
        dropout: Dropout probability applied throughout.
    """

    def __init__(
        self,
        vocab_size: int,
        embed_dim: int = 128,
        n_heads: int = 4,
        n_layers: int = 3,
        max_seq_len: int = 200,
        dropout: float = 0.1,
    ):
        super().__init__()

        self.embed_dim = embed_dim

        # Domain embedding table (index 0 reserved for <PAD>)
        self.embedding = nn.Embedding(
            num_embeddings=vocab_size,
            embedding_dim=embed_dim,
            padding_idx=0,
        )

        self.pos_encoder = PositionalEncoding(embed_dim, max_seq_len, dropout)

        encoder_layer = nn.TransformerEncoderLayer(
            d_model=embed_dim,
            nhead=n_heads,
            dim_feedforward=embed_dim * 4,
            dropout=dropout,
            activation="gelu",
            batch_first=True,
            norm_first=True,  # Pre-LN for training stability
        )
        self.transformer = nn.TransformerEncoder(
            encoder_layer,
            num_layers=n_layers,
            enable_nested_tensor=False,
        )

        self.layer_norm = nn.LayerNorm(embed_dim)

    def forward(self, domain_ids: Tensor, mask: Tensor) -> Tensor:
        """Encode a batch of BGC domain sequences.

        Args:
            domain_ids: Integer tensor of shape ``(batch, seq_len)`` containing
                Pfam domain vocabulary indices.  Padding positions must use
                index 0.
            mask: Boolean tensor of shape ``(batch, seq_len)``.  ``True``
                indicates a *valid* (non-padding) position; ``False`` indicates
                padding that should be ignored.

        Returns:
            Tensor of shape ``(batch, embed_dim)`` representing each BGC.
        """
        # Embed and add positional encoding
        x = self.embedding(domain_ids) * math.sqrt(self.embed_dim)  # (B, L, D)
        x = self.pos_encoder(x)

        # PyTorch TransformerEncoder expects src_key_padding_mask where True
        # means *ignore* that position, so we invert our mask.
        padding_mask = ~mask  # (B, L)

        x = self.transformer(x, src_key_padding_mask=padding_mask)  # (B, L, D)
        x = self.layer_norm(x)

        # Masked mean-pooling: average over non-padding positions only.
        # This is more principled than [CLS]-token pooling for variable-length
        # BGCs because every domain contributes equally.
        mask_expanded = mask.unsqueeze(-1).float()  # (B, L, 1)
        x = (x * mask_expanded).sum(dim=1) / mask_expanded.sum(dim=1).clamp(min=1e-9)

        return x  # (B, D)


class ChemicalFeatureEncoder(nn.Module):
    """MLP encoder for numerical chemical and genomic features.

    Takes a vector of pre-computed features (e.g., GC content, cluster
    length, number of biosynthetic genes, predicted molecular weight,
    LogP estimates) and projects them into a compact representation.

    Architecture: ``input_dim -> 64 -> 32`` with ReLU activation,
    LayerNorm, and Dropout between layers. Uses LayerNorm instead of
    BatchNorm to support single-sample inference (batch_size=1).

    Args:
        input_dim: Number of input chemical/genomic features.
        dropout: Dropout probability.
    """

    def __init__(self, input_dim: int, dropout: float = 0.2):
        super().__init__()

        self.network = nn.Sequential(
            nn.Linear(input_dim, 64),
            nn.LayerNorm(64),
            nn.ReLU(inplace=True),
            nn.Dropout(p=dropout),
            nn.Linear(64, 32),
            nn.LayerNorm(32),
            nn.ReLU(inplace=True),
            nn.Dropout(p=dropout),
        )

    def forward(self, features: Tensor) -> Tensor:
        """Encode numerical features.

        Args:
            features: Float tensor of shape ``(batch, input_dim)``.

        Returns:
            Tensor of shape ``(batch, 32)``.
        """
        return self.network(features)

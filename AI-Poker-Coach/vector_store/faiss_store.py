"""FAISS-backed vector store with a NumPy fallback for similarity search."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, List, Sequence
import json
import math

try:
    import numpy as np
except ImportError:  # pragma: no cover - optional dependency
    np = None

try:
    import faiss
except ImportError:  # pragma: no cover - optional dependency
    faiss = None


@dataclass
class SimilarHand:
    hand_id: str
    score: float
    payload: Dict[str, Any]


class HandVectorStore:
    def __init__(self, store_dir: str | Path = "vector_store", dimension: int = 384) -> None:
        self.store_dir = Path(store_dir)
        self.store_dir.mkdir(parents=True, exist_ok=True)
        self.dimension = dimension
        self.metadata_path = self.store_dir / "metadata.json"
        self.faiss_path = self.store_dir / "index.faiss"
        self.numpy_path = self.store_dir / "vectors.json"

        self.metadata: List[Dict[str, Any]] = self._load_metadata()
        self._init_index()

    def _init_index(self) -> None:
        self._numpy_vectors = []
        if faiss is not None and np is not None:
            if self.faiss_path.exists():
                self.index = faiss.read_index(str(self.faiss_path))
                return
            self.index = faiss.IndexFlatIP(self.dimension)
        else:
            self.index = None
            if self.numpy_path.exists():
                self._numpy_vectors = json.loads(self.numpy_path.read_text(encoding="utf-8"))

    def _load_metadata(self) -> List[Dict[str, Any]]:
        if not self.metadata_path.exists():
            return []
        return json.loads(self.metadata_path.read_text(encoding="utf-8"))

    def add_hand_embedding(self, hand_id: str, embedding: Sequence[float], payload: Dict[str, Any]) -> None:
        vec = [float(v) for v in embedding]
        if len(vec) != self.dimension:
            raise ValueError(f"Embedding dimension mismatch. expected={self.dimension}, got={len(vec)}")

        vec = self._normalize(vec)

        self.metadata.append({"hand_id": hand_id, "payload": payload})

        if faiss is not None and np is not None:
            arr = np.asarray(vec, dtype=np.float32).reshape(1, -1)
            self.index.add(arr)
            faiss.write_index(self.index, str(self.faiss_path))
        else:
            self._numpy_vectors.append(vec)
            self.numpy_path.write_text(json.dumps(self._numpy_vectors), encoding="utf-8")

        self.metadata_path.write_text(json.dumps(self.metadata, indent=2), encoding="utf-8")

    def find_similar_hands(self, embedding: Sequence[float], top_k: int = 5) -> List[SimilarHand]:
        if not self.metadata:
            return []

        query = self._normalize([float(v) for v in embedding])

        if faiss is not None and np is not None:
            arr = np.asarray(query, dtype=np.float32).reshape(1, -1)
            scores, indices = self.index.search(arr, top_k)
            idxs = indices[0]
            sims = scores[0]
        else:
            sims_full = [self._dot(vector, query) for vector in self._numpy_vectors]
            pairs = sorted(enumerate(sims_full), key=lambda item: item[1], reverse=True)[:top_k]
            idxs = [idx for idx, _ in pairs]
            sims = [score for _, score in pairs]

        results: List[SimilarHand] = []
        for idx, score in zip(idxs, sims):
            if idx < 0 or idx >= len(self.metadata):
                continue
            entry = self.metadata[int(idx)]
            results.append(SimilarHand(hand_id=entry["hand_id"], score=float(score), payload=entry["payload"]))
        return results

    @staticmethod
    def _normalize(vector: Sequence[float]) -> List[float]:
        norm = math.sqrt(sum(v * v for v in vector))
        if norm == 0:
            return list(vector)
        return [v / norm for v in vector]

    @staticmethod
    def _dot(a: Sequence[float], b: Sequence[float]) -> float:
        return sum(x * y for x, y in zip(a, b))

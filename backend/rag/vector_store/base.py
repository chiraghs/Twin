"""Vector store abstractions and in-memory cosine implementation."""
from abc import ABC, abstractmethod
from typing import Any
import math
from pydantic import BaseModel, Field


class DocumentChunk(BaseModel):
    """Chunk of unstructured document with metadata."""
    chunk_id: str
    doc_id: str
    text: str
    metadata: dict[str, Any] = Field(default_factory=dict)
    embedding: list[float] = Field(default_factory=list)


class SearchResult(BaseModel):
    """Matched document chunk with relevance score."""
    chunk: DocumentChunk
    score: float


class IVectorStore(ABC):
    """Abstract Vector Store contract (Dependency Inversion)."""

    @abstractmethod
    async def add_chunks(self, chunks: list[DocumentChunk]) -> None:
        pass

    @abstractmethod
    async def search(self, query_embedding: list[float], limit: int = 5) -> list[SearchResult]:
        pass


class InMemoryVectorStore(IVectorStore):
    """Fast, deterministic in-memory vector store computing cosine similarity."""

    def __init__(self) -> None:
        self._chunks: list[DocumentChunk] = []

    async def add_chunks(self, chunks: list[DocumentChunk]) -> None:
        self._chunks.extend(chunks)

    def _cosine_similarity(self, a: list[float], b: list[float]) -> float:
        if not a or not b or len(a) != len(b):
            return 0.0
        dot = sum(x * y for x, y in zip(a, b))
        norm_a = math.sqrt(sum(x * x for x in a))
        norm_b = math.sqrt(sum(y * y for y in b))
        if norm_a == 0.0 or norm_b == 0.0:
            return 0.0
        return dot / (norm_a * norm_b)

    async def search(self, query_embedding: list[float], limit: int = 5) -> list[SearchResult]:
        scored: list[SearchResult] = []
        for chunk in self._chunks:
            if chunk.embedding:
                score = self._cosine_similarity(query_embedding, chunk.embedding)
                scored.append(SearchResult(chunk=chunk, score=score))
        scored.sort(key=lambda x: x.score, reverse=True)
        return scored[:limit]

"""Hybrid dense-sparse retrieval engine with keyword matching and vector ranking."""
from typing import Any
from backend.rag.vector_store.base import IVectorStore, DocumentChunk, SearchResult
from backend.rag.knowledge_graph.graph import PlantKnowledgeGraph


class HybridRetriever:
    """Combines BM25-style keyword boosting with semantic dense retrieval and graph filtering."""

    def __init__(self, vector_store: IVectorStore, knowledge_graph: PlantKnowledgeGraph) -> None:
        self.vector_store = vector_store
        self.knowledge_graph = knowledge_graph

    async def retrieve(
        self,
        query: str,
        query_embedding: list[float],
        asset_id: str = "",
        limit: int = 5,
    ) -> list[SearchResult]:
        # 1. Semantic search
        vector_results = await self.vector_store.search(query_embedding, limit=limit * 2)

        # 2. Graph-based boosting
        related_manuals = set(self.knowledge_graph.get_related_manuals(asset_id)) if asset_id else set()

        scored_results: list[SearchResult] = []
        query_terms = set(query.lower().split())

        for res in vector_results:
            boost = 1.0
            # Graph boost
            if res.chunk.doc_id in related_manuals:
                boost *= 1.4

            # Alphanumeric keyword boost (exact match for part numbers / error codes)
            chunk_text_lower = res.chunk.text.lower()
            matching_terms = sum(1 for term in query_terms if term in chunk_text_lower)
            if matching_terms > 0:
                boost *= (1.0 + 0.2 * matching_terms)

            final_score = res.score * boost
            scored_results.append(SearchResult(chunk=res.chunk, score=final_score))

        scored_results.sort(key=lambda x: x.score, reverse=True)
        return scored_results[:limit]

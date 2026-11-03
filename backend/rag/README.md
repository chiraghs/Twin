# Industrial Hybrid RAG & Knowledge Graph (`backend/rag`)

The **RAG** (Retrieval-Augmented Generation) module enables Twin's copilots and agents to query unstructured technical documentation, OEM machinery manuals, engineering bulletins, and Standard Operating Procedures (SOPs) alongside structured plant ontologies.

---

## Directory Structure

```
backend/rag/
├── vector_store/    # Pluggable vector store adapters (Qdrant, Milvus, pgvector)
├── knowledge_graph/ # GraphRAG engine modeling ISA-95 equipment hierarchies (Site -> Area -> Line -> Cell -> Asset)
├── chunkers/        # Domain-aware chunking for technical tables, electrical schematics, and SOP step lists
└── search/          # Hybrid dense-sparse search (BM25 + Vector Embeddings) with cross-encoder re-ranking
```

---

## Technical Highlights

- **ISA-95 Ontology Graph**: Instead of treating plant documentation as isolated text chunks, the knowledge graph connects technical bulletins directly to the specific machine archetypes, component IDs, and error codes they describe.
- **Hybrid Search**: Combines keyword search (crucial for exact alphanumeric part numbers like `AX6-GB-01` or error codes like `E-3042`) with dense semantic vector embeddings.
- **Table & Procedure Preserving Chunkers**: Avoids splitting critical tolerance tables, torque specifications, and step-by-step lockout-tagout (LOTO) procedures across chunk boundaries.

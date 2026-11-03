"""Industrial equipment ontology knowledge graph representing ISA-95 hierarchies."""
from typing import Any, Optional
from pydantic import BaseModel, Field


class GraphNode(BaseModel):
    node_id: str
    node_type: str = Field(..., description="Plant | Line | Machine | Component | Manual | Alarm")
    properties: dict[str, Any] = Field(default_factory=dict)


class GraphEdge(BaseModel):
    source_id: str
    target_id: str
    relation: str = Field(..., description="CONTAINS | POWERS | DOCUMENTS | TRIGGERS")


class PlantKnowledgeGraph:
    """Knowledge graph storing operational and engineering relationships."""

    def __init__(self) -> None:
        self.nodes: dict[str, GraphNode] = {}
        self.edges: list[GraphEdge] = []

    def add_node(self, node_id: str, node_type: str, properties: Optional[dict[str, Any]] = None) -> None:
        self.nodes[node_id] = GraphNode(node_id=node_id, node_type=node_type, properties=properties or {})

    def add_edge(self, source_id: str, target_id: str, relation: str) -> None:
        self.edges.append(GraphEdge(source_id=source_id, target_id=target_id, relation=relation))

    def get_related_manuals(self, asset_id: str) -> list[str]:
        """Find doc_ids documenting this asset or its upstream components."""
        results: list[str] = []
        for edge in self.edges:
            if edge.source_id == asset_id and edge.relation == "DOCUMENTS":
                results.append(edge.target_id)
            elif edge.target_id == asset_id and edge.relation == "DOCUMENTS":
                results.append(edge.source_id)
        return results

    def get_upstream_line(self, asset_id: str) -> Optional[str]:
        """Find the line that contains this asset."""
        for edge in self.edges:
            if edge.target_id == asset_id and edge.relation == "CONTAINS":
                return edge.source_id
        return None

"""Five answered learning questions and bounded in-memory database sources."""
from typing import Annotated, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, StringConstraints, model_validator

ShortText = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=200)]
QuestionText = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=1000)]
AnswerText = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=6000)]


class StudyGuideInput(BaseModel):
    """Current owned sources read at execution; never persisted as a command."""
    model_config = ConfigDict(extra="forbid")
    job_id: UUID
    description: Annotated[str, StringConstraints(min_length=1, max_length=20_000)]
    previous_questions: list[QuestionText] = Field(default_factory=list, max_length=200)

    @model_validator(mode="after")
    def bounded_previous_questions(self):
        if sum(map(len, self.previous_questions)) > 40_000:
            raise ValueError("Previous study questions exceed the generation context limit")
        return self


DiagramId = Annotated[str, StringConstraints(pattern=r"^[a-z][a-z0-9_]{0,31}$")]
DiagramLabel = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=160)]


class StudyDiagramNode(BaseModel):
    """A labeled concept; identifiers are local references, never markup."""
    model_config = ConfigDict(extra="forbid")
    id: DiagramId
    label: DiagramLabel


class StudyDiagramEdge(BaseModel):
    """One directed relationship between two declared concepts."""
    model_config = ConfigDict(extra="forbid")
    from_node: DiagramId
    to_node: DiagramId
    label: DiagramLabel


class StudyDiagram(BaseModel):
    """A small relationship map with a prose equivalent for nonvisual reading."""
    model_config = ConfigDict(extra="forbid")
    caption: ShortText
    explanation: QuestionText = Field(description="Plain-language equivalent explaining all pictured relationships.")
    nodes: list[StudyDiagramNode] = Field(min_length=2, max_length=6)
    edges: list[StudyDiagramEdge] = Field(min_length=1, max_length=8)

    @model_validator(mode="after")
    def valid_relationships(self):
        ids = [node.id for node in self.nodes]
        if len(set(ids)) != len(ids):
            raise ValueError("Diagram node identifiers must be unique")
        connections = [(edge.from_node, edge.to_node) for edge in self.edges]
        if len(set(connections)) != len(connections):
            raise ValueError("Diagram relationships must be unique")
        referenced = set()
        for edge in self.edges:
            if edge.from_node not in ids or edge.to_node not in ids or edge.from_node == edge.to_node:
                raise ValueError("Diagram relationships must join two different declared nodes")
            referenced.update((edge.from_node, edge.to_node))
        if referenced != set(ids):
            raise ValueError("Every diagram node must belong to a relationship")
        return self


class StudyQuestion(BaseModel):
    """A self-contained question and teaching answer, not a candidate's experience."""
    question: QuestionText = Field(description="One specific learning question, phrased as a question.")
    why_it_matters: QuestionText = Field(description="Its relevance to duties stated in the description.")
    answer: AnswerText = Field(description="Explain the answer, how it works, and why; teach rather than give a terse definition.")
    example: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=3000)] = Field(description="A concrete hypothetical worked example, including its reasoning or outcome.")
    diagram: StudyDiagram | None = Field(default=None, description="Optional relationship map only when it makes the answer easier to understand; otherwise null.")


class StudyGuide(BaseModel):
    """One batch of exactly five prioritized, answered questions."""
    version: Literal[1] = 1
    title: ShortText
    questions: list[StudyQuestion] = Field(min_length=5, max_length=5, description="Five distinct questions, highest priority first.")


class StudyGuideUnavailable(BaseModel):
    """Explain an unusable source without inventing an occupation or lessons."""
    cannot_generate_reason: QuestionText = Field(description="Ask for a meaningful job description when the source cannot support relevant questions.")

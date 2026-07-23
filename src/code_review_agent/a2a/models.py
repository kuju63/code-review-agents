"""Pydantic models for the A2A (Agent-to-Agent) protocol.

Covers task lifecycle (:class:`A2ATask`, :class:`A2ATaskStatus`), message
content (:class:`A2AMessage` and its :data:`A2APart` variants), and agent
discovery metadata (:class:`AgentCard`, :class:`AgentSkill`).
"""

from __future__ import annotations

from enum import StrEnum
from typing import Any, Literal

from pydantic import BaseModel


class A2ATaskStatus(StrEnum):
    """Lifecycle state of an :class:`A2ATask`."""

    SUBMITTED = "submitted"
    WORKING = "working"
    COMPLETED = "completed"
    FAILED = "failed"


class A2ATextPart(BaseModel):
    """A plain-text segment of an :class:`A2AMessage`."""

    kind: Literal["text"] = "text"
    text: str


class A2ADataPart(BaseModel):
    """A structured-data segment of an :class:`A2AMessage`."""

    kind: Literal["data"] = "data"
    data: dict[str, Any]


A2APart = A2ATextPart | A2ADataPart


class A2AMessage(BaseModel):
    """A message exchanged between the user and an agent, made of one or more parts."""

    role: Literal["user", "agent"]
    parts: list[A2APart]


class A2ATask(BaseModel):
    """A unit of work tracked by :class:`~code_review_agent.a2a.task_store.TaskStore`."""

    id: str
    status: A2ATaskStatus
    message: A2AMessage | None = None
    error: str | None = None


class A2ASendTaskRequest(BaseModel):
    """Request body for submitting a new task with its initial message."""

    message: A2AMessage


class A2ASendTaskResponse(BaseModel):
    """Response body wrapping the created or updated :class:`A2ATask`."""

    task: A2ATask


class AgentCapability(BaseModel):
    """Optional protocol features an agent supports, advertised on its :class:`AgentCard`."""

    streaming: bool = False
    pushNotifications: bool = False
    stateTransitionHistory: bool = False


class AgentSkill(BaseModel):
    """A single capability an agent exposes, including its I/O JSON schemas."""

    id: str
    name: str
    description: str
    inputSchema: dict[str, Any]
    outputSchema: dict[str, Any]


class AgentCard(BaseModel):
    """Discovery metadata describing an agent's identity, capabilities, and skills."""

    name: str
    description: str
    url: str
    version: str = "1.0.0"
    capabilities: AgentCapability = AgentCapability()
    inputModes: list[str] = ["data"]
    outputModes: list[str] = ["data"]
    skills: list[AgentSkill]

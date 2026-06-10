import json

from code_review_agent.a2a.models import (
    A2ADataPart,
    A2AMessage,
    A2ASendTaskRequest,
    A2ASendTaskResponse,
    A2ATask,
    A2ATaskStatus,
    A2ATextPart,
    AgentCapability,
    AgentCard,
    AgentSkill,
)


class TestA2ATaskStatus:
    def test_values(self) -> None:
        assert A2ATaskStatus.SUBMITTED == "submitted"
        assert A2ATaskStatus.WORKING == "working"
        assert A2ATaskStatus.COMPLETED == "completed"
        assert A2ATaskStatus.FAILED == "failed"


class TestA2AParts:
    def test_text_part(self) -> None:
        part = A2ATextPart(text="hello")
        assert part.kind == "text"
        assert part.text == "hello"

    def test_data_part(self) -> None:
        part = A2ADataPart(data={"key": "value"})
        assert part.kind == "data"
        assert part.data == {"key": "value"}

    def test_union_discriminated_by_kind_text(self) -> None:
        raw = {"kind": "text", "text": "hello"}
        part = A2ATextPart.model_validate(raw)
        assert isinstance(part, A2ATextPart)

    def test_union_discriminated_by_kind_data(self) -> None:
        raw = {"kind": "data", "data": {"x": 1}}
        part = A2ADataPart.model_validate(raw)
        assert isinstance(part, A2ADataPart)


class TestA2AMessage:
    def test_user_message(self) -> None:
        msg = A2AMessage(role="user", parts=[A2ATextPart(text="hi")])
        assert msg.role == "user"
        assert len(msg.parts) == 1

    def test_agent_message_with_data_part(self) -> None:
        msg = A2AMessage(role="agent", parts=[A2ADataPart(data={"result": 42})])
        assert msg.role == "agent"

    def test_serialization(self) -> None:
        msg = A2AMessage(role="user", parts=[A2ATextPart(text="test")])
        dumped = msg.model_dump()
        assert dumped["role"] == "user"
        assert dumped["parts"][0]["kind"] == "text"


class TestA2ATask:
    def test_submitted_task(self) -> None:
        task = A2ATask(id="abc", status=A2ATaskStatus.SUBMITTED)
        assert task.id == "abc"
        assert task.status == A2ATaskStatus.SUBMITTED
        assert task.message is None
        assert task.error is None

    def test_completed_task_with_message(self) -> None:
        msg = A2AMessage(role="agent", parts=[A2ATextPart(text="done")])
        task = A2ATask(id="xyz", status=A2ATaskStatus.COMPLETED, message=msg)
        assert task.message is not None
        assert task.message.role == "agent"

    def test_failed_task_with_error(self) -> None:
        task = A2ATask(id="err", status=A2ATaskStatus.FAILED, error="timeout")
        assert task.error == "timeout"


class TestA2ASendTaskRequest:
    def test_request_roundtrip(self) -> None:
        req = A2ASendTaskRequest(
            message=A2AMessage(role="user", parts=[A2ADataPart(data={"pr_number": 1})])
        )
        dumped = json.loads(req.model_dump_json())
        restored = A2ASendTaskRequest.model_validate(dumped)
        assert restored.message.role == "user"


class TestA2ASendTaskResponse:
    def test_response(self) -> None:
        task = A2ATask(id="t1", status=A2ATaskStatus.SUBMITTED)
        resp = A2ASendTaskResponse(task=task)
        assert resp.task.id == "t1"


class TestAgentCard:
    def test_agent_card_defaults(self) -> None:
        skill = AgentSkill(
            id="s1",
            name="Skill",
            description="A skill",
            inputSchema={"type": "object"},
            outputSchema={"type": "object"},
        )
        card = AgentCard(
            name="Test Agent",
            description="desc",
            url="http://localhost/test",
            skills=[skill],
        )
        assert card.version == "1.0.0"
        assert card.capabilities.streaming is False
        assert card.inputModes == ["data"]
        assert card.outputModes == ["data"]

    def test_agent_capability_defaults(self) -> None:
        cap = AgentCapability()
        assert cap.streaming is False
        assert cap.pushNotifications is False
        assert cap.stateTransitionHistory is False

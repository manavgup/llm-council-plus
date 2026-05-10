import pytest
import respx
import httpx
from llm_council_mcp.client import CouncilClient


@pytest.mark.asyncio
async def test_health_check():
    with respx.mock:
        respx.get("http://localhost:8001/api/health").mock(
            return_value=httpx.Response(200, json={"status": "ok"})
        )
        async with CouncilClient() as client:
            result = await client.health()
        assert result == {"status": "ok"}


@pytest.mark.asyncio
async def test_get_settings():
    with respx.mock:
        respx.get("http://localhost:8001/api/settings").mock(
            return_value=httpx.Response(200, json={"council_models": ["openai:gpt-4.1"]})
        )
        async with CouncilClient() as client:
            result = await client.get_settings()
        assert result["council_models"] == ["openai:gpt-4.1"]


@pytest.mark.asyncio
async def test_update_settings():
    with respx.mock:
        respx.put("http://localhost:8001/api/settings").mock(
            return_value=httpx.Response(200, json={"success": True})
        )
        async with CouncilClient() as client:
            result = await client.update_settings(council_temperature=0.7)
        assert result == {"success": True}


@pytest.mark.asyncio
async def test_list_conversations():
    with respx.mock:
        respx.get("http://localhost:8001/api/conversations").mock(
            return_value=httpx.Response(200, json=[{"id": "abc", "title": "Test"}])
        )
        async with CouncilClient() as client:
            result = await client.list_conversations()
        assert result[0]["id"] == "abc"


@pytest.mark.asyncio
async def test_create_conversation():
    with respx.mock:
        respx.post("http://localhost:8001/api/conversations").mock(
            return_value=httpx.Response(201, json={"id": "new-id", "title": ""})
        )
        async with CouncilClient() as client:
            result = await client.create_conversation()
        assert result["id"] == "new-id"


@pytest.mark.asyncio
async def test_ollama_models_returns_empty_on_error():
    with respx.mock:
        respx.get("http://localhost:8001/api/ollama/tags").mock(
            side_effect=httpx.ConnectError("connection refused")
        )
        async with CouncilClient() as client:
            result = await client.get_ollama_models()
        assert result == []


@pytest.mark.asyncio
async def test_stream_message_yields_events():
    sse_body = (
        "data: {\"type\": \"stage1_start\"}\n\n"
        "data: {\"type\": \"stage1_complete\", \"data\": []}\n\n"
        "data: {\"type\": \"complete\"}\n\n"
    )
    with respx.mock:
        respx.post(
            "http://localhost:8001/api/conversations/conv-1/message/stream"
        ).mock(
            return_value=httpx.Response(200, text=sse_body, headers={"content-type": "text/event-stream"})
        )
        events = []
        async with CouncilClient() as client:
            async for event in client.stream_message("conv-1", "hello"):
                events.append(event)
    assert len(events) == 3
    assert events[0]["type"] == "stage1_start"
    assert events[2]["type"] == "complete"

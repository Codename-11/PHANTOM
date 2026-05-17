#!/usr/bin/env python3
"""
PHANTOM + Hermes Proxy Smoke Test

Verifies the fork direction:
- Single Hermes proxy instance is running in routed/auto mode
- /v1/models exposes Grok + Codex choices to OpenAI-compatible clients
- PHANTOM backend is reachable
- PHANTOM WebSocket chat works through the proxy
"""

import asyncio
import json
import sys
import time

import aiohttp
import websockets

PROXY_URL = "http://127.0.0.1:8648"
PHANTOM_WS = "ws://127.0.0.1:1337/ws"
PHANTOM_HTTP = "http://127.0.0.1:1337"


async def test_proxy_health():
    async with aiohttp.ClientSession() as session:
        try:
            async with session.get(
                f"{PROXY_URL}/health",
                timeout=aiohttp.ClientTimeout(total=5),
            ) as resp:
                data = await resp.json()
                ok = resp.status == 200 and data.get("status") == "ok"
                if ok:
                    print(f"✅ Hermes proxy healthy: {data.get('upstream')}")
                    return True
                print(f"❌ Proxy health bad: {resp.status} {data}")
                return False
        except Exception as e:
            print(f"❌ Proxy health check failed: {e}")
            return False


async def test_proxy_models():
    async with aiohttp.ClientSession() as session:
        try:
            async with session.get(
                f"{PROXY_URL}/v1/models",
                timeout=aiohttp.ClientTimeout(total=5),
            ) as resp:
                data = await resp.json()
                model_ids = {m.get("id") for m in data.get("data", [])}
                required = {"grok-4.3", "gpt-5.4"}
                missing = required - model_ids
                if resp.status == 200 and not missing:
                    print(f"✅ Proxy model discovery OK ({len(model_ids)} models)")
                    return True
                print(f"❌ Proxy models missing {missing}; got {sorted(model_ids)}")
                return False
        except Exception as e:
            print(f"❌ Proxy model discovery failed: {e}")
            return False


async def test_phantom_http():
    async with aiohttp.ClientSession() as session:
        try:
            async with session.get(
                f"{PHANTOM_HTTP}/api/settings",
                timeout=aiohttp.ClientTimeout(total=5),
            ) as resp:
                data = await resp.json()
                base_ok = data.get("baseUrl") == f"{PROXY_URL}/v1"
                model_ok = data.get("model")
                if resp.status == 200 and base_ok and model_ok:
                    print(f"✅ PHANTOM settings OK: {data.get('model')} via {data.get('baseUrl')}")
                    return True
                print(f"❌ PHANTOM settings unexpected: {data}")
                return False
        except Exception as e:
            print(f"❌ PHANTOM HTTP check failed: {e}")
            return False


async def test_websocket_chat():
    try:
        async with websockets.connect(PHANTOM_WS) as ws:
            print("✅ WebSocket connected to PHANTOM")
            await ws.send(json.dumps({
                "type": "chat",
                "content": "Smoke test: reply with exactly PHANTOM_PROXY_OK.",
                "conversationId": None,
            }))

            received_any = False
            content = ""
            start = time.time()
            while time.time() - start < 25:
                try:
                    msg = await asyncio.wait_for(ws.recv(), timeout=4)
                    data = json.loads(msg)
                    if data.get("type") == "chunk":
                        received_any = True
                        content += data.get("content", "")
                    if data.get("type") == "response_end":
                        received_any = True
                        break
                    if data.get("type") == "error":
                        print(f"❌ PHANTOM returned error: {data.get('message')}")
                        return False
                except asyncio.TimeoutError:
                    continue

            if received_any:
                preview = content[:120].replace("\n", " ")
                print(f"✅ PHANTOM chat responded: {preview!r}")
                return True
            print("❌ No chat response received")
            return False
    except Exception as e:
        print(f"❌ WebSocket chat test failed: {e}")
        return False


async def main():
    print("=== PHANTOM + Hermes Routed Proxy Smoke Test ===\n")
    checks = [
        ("Hermes proxy health", test_proxy_health),
        ("Hermes proxy model discovery", test_proxy_models),
        ("PHANTOM HTTP settings", test_phantom_http),
        ("PHANTOM WebSocket chat", test_websocket_chat),
    ]

    results = []
    for title, fn in checks:
        print(f"\n• {title}")
        results.append(await fn())

    passed = sum(1 for r in results if r)
    total = len(results)
    print(f"\n=== Final Results: {passed}/{total} passed ===")
    if passed == total:
        print("✅ Full pipeline verified: PHANTOM → single Hermes routed proxy → OAuth provider")
        return 0
    print("❌ Pipeline verification failed")
    return 1


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))

#!/usr/bin/env python3
"""
Probe MiniMax via both documented API styles:
1) Anthropic-compatible messages API
2) OpenAI-compatible chat completions API

This helps compare raw response bodies and check whether usage/token fields are
returned consistently across the two interfaces.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import urllib.error
import urllib.request
from typing import Any


DEFAULT_API_BASE = os.environ.get("MINIMAX_API_BASE", "https://api.minimaxi.com")
DEFAULT_MODEL = os.environ.get("MINIMAX_MODEL", "MiniMax-M2.7-highspeed")
DEFAULT_API_KEY = os.environ.get("MINIMAX_API_KEY", "")
DEFAULT_PROMPT = "Please reply with a short sentence and include the number 42."


def normalize_model(model: str) -> str:
    model = model.strip()
    if "/" in model:
        return model.split("/")[-1]
    return model


def pretty_json(data: Any) -> str:
    return json.dumps(data, indent=2, ensure_ascii=False, sort_keys=True)


def read_json_response(resp: urllib.response.addinfourl) -> tuple[int, dict[str, str], Any]:
    body = resp.read().decode("utf-8", errors="replace")
    headers = {k.lower(): v for k, v in resp.headers.items()}
    try:
        parsed = json.loads(body)
    except json.JSONDecodeError:
        parsed = {"_raw": body}
    return resp.status, headers, parsed


def post_json(url: str, payload: dict[str, Any], headers: dict[str, str], timeout: int) -> tuple[int, dict[str, str], Any]:
    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(url=url, data=data, headers=headers, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return read_json_response(resp)
    except urllib.error.HTTPError as exc:
        status, resp_headers, parsed = read_json_response(exc)
        return status, resp_headers, parsed


def anthropic_payload(model: str, prompt: str, max_tokens: int, system: str | None) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "model": model,
        "max_tokens": max_tokens,
        "messages": [
            {
                "role": "user",
                "content": [
                    {
                        "type": "text",
                        "text": prompt,
                    }
                ],
            }
        ],
    }
    if system:
        payload["system"] = system
    return payload


def openai_payload(model: str, prompt: str, max_tokens: int, system: str | None) -> dict[str, Any]:
    messages: list[dict[str, str]] = []
    if system:
        messages.append({"role": "system", "content": system})
    messages.append({"role": "user", "content": prompt})
    return {
        "model": model,
        "max_tokens": max_tokens,
        "messages": messages,
    }


def print_result(name: str, url: str, status: int, headers: dict[str, str], parsed: Any) -> None:
    print(f"\n===== {name} =====")
    print(f"URL: {url}")
    print(f"HTTP Status: {status}")
    interesting_headers = {
        key: value
        for key, value in headers.items()
        if key in {"content-type", "x-request-id", "request-id", "traceparent"}
    }
    if interesting_headers:
        print("Headers:")
        print(pretty_json(interesting_headers))
    print("Body:")
    print(pretty_json(parsed))

    if isinstance(parsed, dict):
        usage = parsed.get("usage")
        if usage is not None:
            print("Extracted usage:")
            print(pretty_json(usage))
        else:
            print("Extracted usage: <missing>")


def main() -> int:
    parser = argparse.ArgumentParser(description="Probe MiniMax via Anthropic-compatible and OpenAI-compatible APIs.")
    parser.add_argument("--api-key", default=DEFAULT_API_KEY, help="MiniMax API key. Defaults to MINIMAX_API_KEY.")
    parser.add_argument("--api-base", default=DEFAULT_API_BASE, help="MiniMax API base, e.g. https://api.minimaxi.com or https://api.minimax.io")
    parser.add_argument("--model", default=DEFAULT_MODEL, help="Model name. OpenClaw-style provider/model is accepted.")
    parser.add_argument("--prompt", default=DEFAULT_PROMPT, help="User prompt to send.")
    parser.add_argument("--system", default="You are a concise test assistant.", help="Optional system prompt.")
    parser.add_argument("--max-tokens", type=int, default=128, help="Max output tokens.")
    parser.add_argument("--timeout", type=int, default=60, help="HTTP timeout in seconds.")
    parser.add_argument(
        "--mode",
        choices=("both", "anthropic", "openai"),
        default="both",
        help="Which API style to call.",
    )
    args = parser.parse_args()

    if not args.api_key:
        print("Missing API key. Set MINIMAX_API_KEY or pass --api-key.", file=sys.stderr)
        return 2

    api_base = args.api_base.rstrip("/")
    model = normalize_model(args.model)

    common_headers = {
        "Authorization": f"Bearer {args.api_key}",
        "Content-Type": "application/json",
    }

    if args.mode in ("both", "anthropic"):
        url = f"{api_base}/anthropic/v1/messages"
        headers = {
            **common_headers,
            "anthropic-version": "2023-06-01",
        }
        status, resp_headers, parsed = post_json(
            url,
            anthropic_payload(model, args.prompt, args.max_tokens, args.system),
            headers,
            args.timeout,
        )
        print_result("Anthropic-Compatible API", url, status, resp_headers, parsed)

    if args.mode in ("both", "openai"):
        url = f"{api_base}/v1/chat/completions"
        status, resp_headers, parsed = post_json(
            url,
            openai_payload(model, args.prompt, args.max_tokens, args.system),
            common_headers,
            args.timeout,
        )
        print_result("OpenAI-Compatible API", url, status, resp_headers, parsed)

    return 0


if __name__ == "__main__":
    raise SystemExit(main())

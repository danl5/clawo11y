# @clawo11y/openclaw-otel-plugin

`@clawo11y/openclaw-otel-plugin` is the OpenClaw plugin that turns runtime agent events into standard OpenTelemetry traces, metrics, and logs.

It is the data source behind the OTEL-native views in OpenClaw O11y:

- `Trace`
- `Cost`
- `Metrics`
- `Security`
- `Context Bloat`

For a field-by-field specification, see [doc/OBSERVABILITY_DATA.md](./doc/OBSERVABILITY_DATA.md).

---

## What It Emits

### Traces

- root turn span: `command.process`
- LLM spans: `llm.completion: <model>`
- tool spans: `tool.call: <tool>`
- subagent spans: `subagent:<label>`

### Metrics

- turn metrics
- LLM metrics
- tool metrics
- subagent metrics
- observability-health metrics
- security high-risk tool metrics

### Logs

- lifecycle logs such as:
  - `run.started`
  - `run.finished`
  - `llm.started`
  - `llm.finished`
  - `tool.succeeded`
  - `tool.failed`
  - `subagent.finished`
- anomaly logs such as:
  - root recreation
  - orphan events
  - idle-timeout closures
- security logs such as:
  - `security.high_risk_tool`

---

## Features

- **Deep Trace Correlation**
  - maps OpenClaw runtime hooks into root/child spans
- **FinOps Signals**
  - token and cost attribution by model and provider
- **Tool and Subagent Visibility**
  - params, results, errors, duration, and session context
- **Observability Self-Health**
  - emits lifecycle anomaly logs and metrics when traces break
- **Security Audit Signals**
  - classifies risky tool operations into categories and risk levels
- **Redaction**
  - sanitizes payloads before emission to avoid leaking secrets and obvious PII
- **No Vendor Lock-In**
  - standard OTLP output that can feed OpenClaw O11y or other OTel systems

---

## Installation

### Prerequisites

- OpenClaw CLI must be installed
- run `npm install && npm run build` in this directory before installing locally

### Install from Local Path

```bash
openclaw plugins install /path/to/clawo11y/openclaw-otel-plugin
```

If you are working inside this repo, the path is typically:

```bash
openclaw plugins install /path/to/clawo11y/openclaw-otel-plugin
```

Restart OpenClaw / gateway after installation.

---

## Configuration

Open your OpenClaw config file, usually:

```text
~/.openclaw/openclaw.json
```

Add:

```json
{
  "plugins": {
    "entries": {
      "@clawo11y/openclaw-otel-plugin": {
        "enabled": true,
        "config": {
          "endpoint": "http://localhost:4318",
          "metric_interval_ms": 30000,
          "export_timeout_ms": 10000,
          "root_idle_timeout_ms": 300000,
          "pricing": {
            "qwen-max": { "prompt": 1.5, "completion": 4.5 },
            "claude-3-opus": { "prompt": 15.0, "completion": 75.0 },
            "MiniMax-M2.7": { "input": 0.3, "output": 1.2 },
            "MiniMax-M2.7-highspeed": { "input": 0.3, "output": 1.2 }
          }
        }
      }
    }
  }
}
```

### Config Options

- `enabled`
  - optional, defaults to `true`
- `config.endpoint`
  - OTLP receiver endpoint
  - default: `http://localhost:4318`
- `config.metric_interval_ms`
  - OTEL metric export interval
  - default: `10000`
- `config.export_timeout_ms`
  - OTLP export timeout
  - default: `5000`
- `config.root_idle_timeout_ms`
  - how long to keep a root turn open after the last related event
  - default: `60000`
- `config.pricing`
  - custom cost table per 1M tokens
  - supports either `prompt` / `completion` or `input` / `output`

### MiniMax Pricing Note

MiniMax publicly documents pricing in `input tokens` and `output tokens`, while the plugin historically used `prompt` and `completion`.

The plugin now supports both styles, so the following are equivalent:

```json
{
  "pricing": {
    "MiniMax-M2.7": { "input": 0.3, "output": 1.2 },
    "MiniMax-M2.7-highspeed": { "input": 0.3, "output": 1.2 }
  }
}
```

```json
{
  "pricing": {
    "MiniMax-M2.7": { "prompt": 0.3, "completion": 1.2 },
    "MiniMax-M2.7-highspeed": { "prompt": 0.3, "completion": 1.2 }
  }
}
```

If MiniMax updates its public pricing or your account uses a different commercial plan, override these values with the latest official numbers for your model and region.

### Important Endpoint Note

`config.endpoint` must match the address where the worker-side `clawo11y-agent` OTLP proxy is listening.

Defaults align out of the box:

- plugin default endpoint: `http://localhost:4318`
- agent default OTLP proxy listen address: `127.0.0.1:4318`

If you override the agent OTLP proxy address with `O11Y_OTLP_PROXY_ADDR`, update the plugin `config.endpoint` to match.

---

## Verification

After enabling the plugin:

1. restart OpenClaw / gateway
2. run a simple agent task
3. open OpenClaw O11y

You should then see data in:

- `Trace`
- `Cost`
- `Metrics`
- `Security`

If your provider returns usage consistently, you should also see:

- LLM token counts
- cost attribution
- context bloat candidates

---

## Development

```bash
cd openclaw-otel-plugin
npm install
npm run build
```

Then restart OpenClaw / gateway so the updated plugin is loaded.

Primary implementation file:

- `src/index.ts`

# ClawO11y OpenTelemetry Plugin Data Specification

The `@clawo11y/openclaw-otel-plugin` listens to OpenClaw runtime hooks and emits OTLP traces, metrics, and logs.

This document summarizes the current telemetry surface at a practical level.

---

## 1. Traces

### Root Span: `command.process`

Represents a full run or session lifecycle.

Common attributes include:

- `session_id`
- `command_trigger`
- `channel`
- `agent_name`
- `user_message`
- `user_message_len`
- `run_status`
- `root_close_reason`
- `duration_ms`
- `llm_call_count`
- `tool_call_count`
- `subagent_call_count`
- `high_risk_tool_calls`
- `total_tokens`
- `total_cost_usd`
- `last_model`
- `last_provider`
- `error_type`
- `error`
- `root_recreate_count`

### LLM Span: `llm.completion: <model>`

Represents one model inference.

Common attributes include:

- `session_id`
- `model`
- `provider`
- `channel`
- `agent_name`
- `llm.system_prompt`
- `llm_turn_index`
- `prompt_tokens`
- `completion_tokens`
- `total_tokens`
- `cost_usd`
- `duration_ms`
- `usage.has_tokens`
- `error_type`
- `error`

### Tool Span: `tool.call: <tool_name>`

Represents one tool execution.

Common attributes include:

- `session_id`
- `tool_name`
- `tool_call_id`
- `tool_params`
- `tool_params_preview`
- `tool_result`
- `tool_result_size`
- `duration_ms`
- `tool_category`
- `tool_risk_class`
- `tool_risk_reason`
- `high_risk_operation`
- `error_type`
- `error`

### Subagent Span: `subagent:<label>`

Represents one subagent lifecycle segment.

Common attributes include:

- `session_id`
- `subagent.child_session_key`
- `subagent.agent_id`
- `subagent.label`
- `subagent.mode`
- `subagent.run_id`
- `subagent.result`
- `subagent.error`
- `subagent.error_type`
- `duration_ms`

---

## 2. Metrics

### Run Metrics

- `openclaw.run.count`
  - labels: `agent_name`, `channel`, `result`
- `openclaw.run.duration`
  - labels: `agent_name`, `channel`, `result`

### LLM Metrics

- `openclaw.llm.requests`
  - labels: `model`, `provider`
- `openclaw.llm.duration`
  - labels: `model`, `provider`
- `openclaw.llm.errors`
  - labels: `model`, `provider`, `error_type`
- `openclaw.llm.tokens.total`
  - labels: `model`, `provider`
- `openclaw.llm.cost.usd`
  - labels: `model`, `provider`

### Tool Metrics

- `openclaw.tool.calls`
  - labels: `tool_name`
- `openclaw.tool.duration`
  - labels: `tool_name`
- `openclaw.tool.errors`
  - labels: `tool_name`, `error_type`

### Subagent Metrics

- `openclaw.subagent.calls`
  - labels: `subagent_label`, `mode`
- `openclaw.subagent.duration`
  - labels: `subagent_label`, `mode`
- `openclaw.subagent.errors`
  - labels: `subagent_label`, `error_type`

### Security / Health Metrics

- `openclaw.security.high_risk_tool.calls`
  - labels: `tool_category`, `risk_class`
- `openclaw.telemetry.anomalies`
  - labels: `anomaly_type`
- `openclaw.agent.errors`
  - labels: `error_type`, `tool_name`

---

## 3. Logs

Logs are correlated with the active trace/span when possible.

### Lifecycle Logs

- `message.received`
- `run.started`
- `run.finished`
- `llm.started`
- `llm.finished`
- `llm.failed`
- `tool.started`
- `tool.succeeded`
- `tool.failed`
- `subagent.started`
- `subagent.finished`
- `subagent.failed`

Typical attributes:

- `event_name`
- `session_id`
- `trace_id` / active trace correlation
- `model`
- `provider`
- `tool_name`
- `tool_call_id`
- `duration_ms`
- `error_type`
- `error`

### Observability Self-Health Logs

The plugin also emits anomaly logs when telemetry lifecycle breaks.

Examples:

- `trace.root.recreated`
- `trace.root.closed_idle_timeout`
- `run.agent_end_without_root`
- `run.close_without_root`
- `llm.duplicate_start`
- `llm.orphaned_output`
- `tool.duplicate_start`
- `tool.orphaned_end`
- `subagent.orphaned_spawned`
- `subagent.orphaned_end`

These events are meant to support observability-health dashboards and future alerting.

### Security Logs

- `security.high_risk_tool`

Typical attributes:

- `session_id`
- `tool_name`
- `tool_call_id`
- `tool_category`
- `tool_risk_class`
- `tool_risk_reason`
- `params_preview`

---

## 4. Security Classification

The plugin currently uses deterministic rule-based classification for risky tools.

Examples:

- `high`
  - shell / command execution
  - dynamic code execution
  - explicit deletion-like filesystem operations
- `medium`
  - file mutation
  - network access
- `low`
  - everything else

The emitted attributes are intended for audit and compliance views, not for access control.

---

## 5. Context Bloat Support

The plugin emits the fields needed for session-level context-growth analysis:

- `session_id`
- `llm_turn_index`
- `prompt_tokens`
- `completion_tokens`
- `total_tokens`
- `created_at`

These are used downstream to flag sessions whose prompt-token growth suggests runaway context expansion.

---

## 6. Redaction

Before payloads are emitted, the plugin sanitizes string data such as:

- `tool_params`
- `tool_result`
- `llm.system_prompt`
- `error`
- log bodies and structured log attributes

The goals are:

- reduce accidental secret leakage
- reduce obvious PII exposure
- bound large payload sizes

# Antares local POC: verbose example output

These are saved outputs from the completed local runs on 2026-09-11, not simulated examples or new scans. The focused query correctly localized SQL injection in the deliberately vulnerable fixture. The automatic sweep completed but also produced unsupported findings.

## Configuration

- Model: `fdtn-ai/antares-1b`, revision `10417eb35641b32e7141157db19c76eb545193b6`, F16 GGUF.
- Antares CLI: 1.0.0.
- llama.cpp: `451b89bae0c4b1dd612eb503ceace906c01ddcc9`.
- Endpoint: `http://127.0.0.1:8082/v1/completions`; served model alias: `antares-1b`.
- Execution: CPU only, `--gpu-layers 0 --device none --flash-attn off`.
- Context: 16,384 tokens; one server slot and one sweep worker.
- Target: [examples/demo](../examples/demo). Reports and private traces are outside the target.

The CLI reports backend `remote` because it uses an HTTP API; this endpoint is local. Metal tests produced non-finite probabilities and repeated `@` characters. The fully CPU-only configuration passed the complete-prompt smoke check and the scans below.

## Focused query: SQL injection

Command:

```sh
./scripts/antares.sh query examples/demo --cwe CWE-89 --output reports/cpu-query
```

### Actual terminal output

Absolute workspace paths are replaced with `<workspace>` below.

```text
╭──────────────────────────────── SCAN SUMMARY ────────────────────────────────╮
│ Status                Complete                                               │
│ Findings              1                                                      │
│ Affected files        1                                                      │
│ CWEs checked          1                                                      │
│ CWE IDs with findings CWE-89                                                 │
│ Duration              41.84s                                                 │
│ Total tool calls      12                                                     │
│ Investigation trace   <workspace>/.antares-data/traces/demo │
│                       -1789115346388-2a313c85.investigation.jsonl            │
│ Failed tool calls     2                                                      │
╰──────────────────────────────────────────────────────────────────────────────╯
╭────────────────────────────────── FINDING ───────────────────────────────────╮
│ Title                 Improper Neutralization of Special Elements used in an │
│                       SQL Command ('SQL Injection')                          │
│ File path             app.py                                                 │
│ Submission rank       1                                                      │
│ CWE IDs               CWE-89                                                 │
│ Likelihood of exploit High                                                   │
╰──────────────────────────────────────────────────────────────────────────────╯
Reports (JSON, Markdown, SARIF) → <workspace>/reports/cpu-query
```

### JSON report excerpt

The following fields are copied from [report.json](cpu-query/report.json). `warnings` is absent from the saved report, so the review command below normalizes it to an empty array.

```sh
jq '{summary, warnings: (.warnings // []), findings}' reports/cpu-query/report.json
```

```json
{
  "summary": {
    "total_findings": 1,
    "tool_call_count": 12,
    "duration_seconds": 41.840486500001134,
    "cwe_ids_triggered": [
      "CWE-89"
    ],
    "failed_tool_calls": 2,
    "retried_turns": 0,
    "generation_errors": 0,
    "failed_workers": 0,
    "total_workers": 0,
    "incomplete_reason": null
  },
  "warnings": [],
  "findings": [
    {
      "title": "Improper Neutralization of Special Elements used in an SQL Command ('SQL Injection')",
      "file_path": "app.py",
      "cwe_ids": [
        "CWE-89"
      ],
      "submission_rank": 1,
      "likelihood_of_exploit": "High"
    }
  ]
}
```

### Selected investigation events

These excerpts show actual tool calls and results, with intervening events omitted. They do not include the model's reasoning text. The source is the local investigation trace `../.antares-data/traces/demo-1789115346388-2a313c85.investigation.jsonl` (ignored by Git).

Initial repository listing:

```json
{
  "tool_name": "terminal",
  "arguments": {
    "command": "find . -maxdepth 2 | head -n 200"
  }
}
```
```text
.
./app.py
./.antares.toml
```

A rejected command during exploration:

```json
{
  "tool_name": "terminal",
  "arguments": {
    "command": "find . -maxdepth 2 | xargs grep -I \"\\.py\" 2>/dev/null"
  }
}
```
```text
Tool terminal failed: Read-only command policy does not allow shell operator: >
```

The report counts two failed tool calls; the trace also records a skipped duplicate call. The model recovered, read the source, and made an explicit submission.

Source inspection:

```json
{
  "tool_name": "terminal",
  "arguments": {
    "command": "cat app.py"
  }
}
```
```python
"""Deliberately vulnerable scan fixture. Do not deploy."""
import sqlite3
from flask import Flask, request

app = Flask(__name__)


@app.get("/users")
def users():
    name = request.args.get("name", "")
    with sqlite3.connect("users.db") as db:
        rows = db.execute("SELECT id, name FROM users WHERE name = '" + name + "'").fetchall()
    return {"users": rows}
```

Final submission:

```json
{
  "tool_name": "submit_vulnerable_files",
  "ranked_files": [
    "app.py"
  ]
}
```

### Source review

**Supported finding: CWE-89 in `app.py`.** The `name` query parameter flows directly into the SQL string at [app.py:12](../examples/demo/app.py#L12). SQL syntax in that value can alter the query. A parameterized query would address this sink, for example:

```python
rows = db.execute(
    "SELECT id, name FROM users WHERE name = ?", (name,)
).fetchall()
```

This is a suggested fix, not a change applied to the deliberately vulnerable fixture. No HTTP exploitation test was performed. Antares localizes files; the line-level explanation above comes from source review.

## Bounded automatic sweep

Command:

```sh
./scripts/antares.sh sweep examples/demo --max-cwes 3 --workers 1 --no-tui --output reports/cpu-sweep
```

Actual selection output:

```text
Automatic selection: 3 of 944 eligible CWE candidates (limit 3; 941 omitted).
Portfolio: 3 repository-specific.
Policy: mitre_mode_aware_repository_relevance_v6
```

### JSON report excerpt

Source: [sweep report.json](cpu-sweep/report.json). The warnings field is normalized as above.

```json
{
  "coverage": [
    "CWE-79",
    "CWE-20",
    "CWE-78"
  ],
  "summary": {
    "total_findings": 3,
    "tool_call_count": 47,
    "duration_seconds": 167.5696167499991,
    "cwe_ids_triggered": [
      "CWE-20",
      "CWE-78",
      "CWE-79"
    ],
    "failed_tool_calls": 7,
    "retried_turns": 0,
    "generation_errors": 0,
    "failed_workers": 0,
    "total_workers": 3,
    "incomplete_reason": null
  },
  "warnings": [],
  "findings": [
    {
      "title": "Improper Input Validation",
      "file_path": "app.py",
      "cwe_ids": [
        "CWE-20"
      ],
      "submission_rank": 1,
      "likelihood_of_exploit": "High"
    },
    {
      "title": "Improper Neutralization of Special Elements used in an OS Command ('OS Command Injection')",
      "file_path": "app.py",
      "cwe_ids": [
        "CWE-78"
      ],
      "submission_rank": 1,
      "likelihood_of_exploit": "High"
    },
    {
      "title": "Improper Neutralization of Input During Web Page Generation ('Cross-site Scripting')",
      "file_path": "app.py",
      "cwe_ids": [
        "CWE-79"
      ],
      "submission_rank": 1,
      "likelihood_of_exploit": "High"
    }
  ]
}
```

All three saved `per_cwe_results[].error_message` values are null. The sweep recovered from seven failed tool calls and completed all workers.

### Review of automatic findings

| CWE | Model output | Source review |
| --- | --- | --- |
| CWE-20 | `app.py` | Broad input-validation concern; CWE-89 is the specific demonstrated weakness. |
| CWE-78 | `app.py` | Unsupported: the fixture invokes no OS commands. |
| CWE-79 | `app.py` | Unsupported by the fixture: the route returns JSON and has no HTML-rendering sink. |

The top-three automatic selection did not include CWE-89. Completed execution does not establish complete vulnerability coverage or validate every finding. `submission_rank` is the ordering within an investigation; `likelihood_of_exploit: High` is MITRE taxonomy metadata, not model confidence or a measured probability for this file.

## Saved artifacts and reuse

- Focused query: [JSON](cpu-query/report.json), [Markdown](cpu-query/report.md), [SARIF](cpu-query/report.sarif).
- Automatic sweep: [JSON](cpu-sweep/report.json), [Markdown](cpu-sweep/report.md), [SARIF](cpu-sweep/report.sarif).
- Setup and launch instructions: [README.md](../README.md).

Use fresh report directories for subsequent runs. The earlier `reports/diagnostics/verified-query` is an incomplete numerical-failure diagnostic, not a successful scan.

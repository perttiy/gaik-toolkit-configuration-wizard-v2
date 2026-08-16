# Sprint 3 BPMN package (implementation notes)

Branch: `feature/sprint3-bpmn-complete` (proposal PR onto current `dev`)

**Already on `dev` (do not re-review as new):** #62 gateways/lint/docs, #74 MIC012 dummy BPMN, #76 data stores.

## Delivered in this proposal

| Issue | What shipped |
|-------|----------------|
| **#66** | `blueprint_ops.py` + `POST /sessions/{id}/blueprint/ops` (+ Next proxy) |
| **#68** | Canvas sync goes extract → `derive_change_ops` → `apply_change_ops` (JSON SoT path) |
| **#67** | Version undo/restore: `POST .../versions/{n}/restore` + JSON/BPMN UI undo |
| **#64** (delta) | `lib/bpmn-gaik-lint.ts` GAIK naming warnings merged into `lintBpmnXml` |
| **#69** | Partial: label/name parity on regenerate (not full multi-pool domain clones) |

## Architecture

```
Canvas XML → extract V2 state → change-ops → JSON (SoT) → generate BPMN
POST /blueprint/ops → change-ops → JSON → (client regenerates BPMN)
```

## Tests

- `solution_wizard/tests/test_blueprint_ops.py`
- `solution_wizard/tests/test_v2_bpmn_adapter.py`
- `solution_wizard_v2/lib/bpmn-gaik-lint.test.ts`
- `wizard_api/tests/test_bpmn_api.py` (ops + restore; needs Postgres)

## Not in this PR

- Full non-linear topology as editable SoT (forks beyond approval gateway)
- NL-chat tools (#70)
- Gate 2 UI (#65)
- Promoting GAIK warnings to blocking errors (PO decision)

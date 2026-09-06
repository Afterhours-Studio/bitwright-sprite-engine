# 1. Record architecture decisions

Date: 2026-01-15

## Status

Accepted

## Context

A decision that shapes a codebase is expensive to revisit. Six months later the
code shows what was chosen, but not what else was considered, or what the
choice cost. Someone then either re-litigates a settled question or, worse,
reverses it without knowing why it was made.

This project has several such decisions already: the shell framework, the
process boundary between the interface and the machine learning code, the
licence, the colour space. Each was weighed against real alternatives, and each
has consequences a newcomer would otherwise have to infer.

Prose documentation goes stale because there is no moment at which it is
obviously wrong. A record tied to a decision does not: the decision either still
holds, or it has been superseded by another record.

## Decision

Architecture decisions are recorded as files in
`docs/architecture/decisions/`, numbered sequentially, in the format Michael
Nygard described.

Each record has:

| Section | Contents |
| --- | --- |
| Title | A number and a short phrase |
| Date | When the decision was made |
| Status | Proposed, Accepted, Deprecated, or Superseded by NNNN |
| Context | The forces at play, including the alternatives |
| Decision | What was chosen, in the active voice |
| Consequences | What follows, good and bad |

A record is written when a decision is hard to reverse, when it constrains
future work, or when a reasonable person would ask why it was made.

Records are immutable once accepted. A decision that changes gets a new record,
and the old one is marked superseded. The history of the thinking is worth as
much as the current state.

Ordinary choices do not get a record. A record for every library would bury the
few that matter.

## Consequences

Positive:

- A newcomer can read why the project is shaped as it is, in one place.
- Reversing a decision means reading the reasoning and answering it.
- Reviewing a decision happens when it is made, not when its consequences bite.
- The list of records is a map of the project's real complexity.

Negative:

- Writing one takes time, and there is a temptation to skip it under pressure.
- Records can drift out of date, since they are not executable. The status
  field is the mitigation.
- Judging which decision deserves a record is a judgement call, so the set will
  never be complete.

Neutral:

- The maintainer owns `docs/architecture/decisions/` in CODEOWNERS. A record
  states a decision rather than describing code, so it needs the person
  authorised to make it.

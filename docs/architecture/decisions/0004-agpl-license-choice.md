# 4. License the project under AGPL-3.0-only

Date: 2026-01-17

## Status

Accepted

## Context

Bitwright needed a licence before its first public commit. Four options were
weighed.

**MIT or Apache-2.0.** Maximum adoption, and anyone may take the work,
close it, and ship it as a product with no obligation to give anything back. For
a library that trade is usually worth making, because adoption is the point. For
a finished end-user application it means a competitor can ship our work under
their own name, and improve it privately.

**GPL-3.0.** Copyleft that binds anyone who distributes the software. It has a
gap that matters for this kind of application: running modified software as a
network service is not distribution, so a hosted version carries no obligation
to publish its changes. Bitwright is a desktop application today, but the engine
is already an HTTP service, and a hosted sprite generator built on it is an
obvious next step for someone else.

**AGPL-3.0.** GPL plus section 13: users interacting with the software over a
network must be offered its source. That closes the hosting gap.

**Source-available**, such as BUSL. Not open source, would exclude the project
from distribution channels that require an OSI licence, and would put it at odds
with the ecosystem it depends on.

Two facts about this project shaped the choice.

First, Bitwright is an end-user application, not a library to embed. The usual
argument against AGPL is that it deters adoption because nobody wants copyleft
reaching into their proprietary codebase. That argument applies to a library
being linked. Nobody links a desktop application; they run it. The deterrent
mostly does not apply here.

Second, copyright is assigned to Afterhours Studio through the CLA, so the
organization holds all rights in the work. A strong default licence therefore
costs nothing in flexibility: the holder can grant different terms to a specific
party at any time. A permissive default cannot be walked back.

The dependency direction was checked and is fine. Everything Bitwright depends
on is permissive, so nothing forbids an AGPL distribution. The reverse is
enforced in CI by `scripts/check-licenses.py`, which fails the build on a
copyleft dependency, since one would reach further than our own grant.

## Decision

Bitwright is licensed under **AGPL-3.0-only**, copyright (C) 2026 Afterhours
Studio.

- `only`, not `or-later`. A future FSF licence would apply automatically under
  `or-later`, and the terms the project ships under should be terms the project
  has read.
- Every source file carries the standard header naming Afterhours Studio.
- The CLA assigns copyright in contributions to Afterhours Studio, which is
  what keeps relicensing possible. See CONTRIBUTING.md.
- Model weights are explicitly outside this grant. They are not code, are not
  distributed with the application, and are downloaded at first use under their
  own licences. See MODELS.md.
- Dependency licences are scanned in CI.

## Consequences

Positive:

- A closed fork cannot be shipped. Anyone distributing a modified Bitwright
  must publish their changes.
- Section 13 covers the hosted case, which is the realistic way this work would
  otherwise be taken.
- Because Afterhours Studio holds all rights through the CLA, dual licensing
  stays available. A company that cannot accept AGPL can be granted commercial
  terms without asking every past contributor.
- Contributors know their work cannot be absorbed into a proprietary product.

Negative:

- Some companies forbid AGPL software outright, by policy, without reading it.
  That costs the project users and contributors regardless of whether the
  policy makes sense here.
- The CLA is friction. Assigning copyright is a real thing to ask, and some
  contributors decline on principle. The reasoning is stated plainly in
  CONTRIBUTING.md rather than buried.
- AGPL cannot be used as a library by permissively licensed projects. Acceptable
  for an application; a real constraint if part of it is ever extracted.
- Section 13 obligations need care if Afterhours Studio ever hosts the engine
  itself.

Neutral:

- The model licence question is separate and is not solved by this decision.
  The RAIL licences that cover the weights carry use restrictions of their own,
  which is why MODELS.md is a document rather than a footnote.
- Relicensing the whole work remains possible for as long as the CLA is applied
  without exception. A single unassigned contribution would end that, which is
  why CI blocks a merge until the CLA is signed.

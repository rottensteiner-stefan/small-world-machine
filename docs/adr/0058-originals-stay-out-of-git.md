# ADR 0058: Originals stay out of git

- **Status:** Accepted (2026-11-07, maintainer decision)
- **Related:** ADR 0009 (character pipeline, amended: `raw/` staging), ADR 0011 (out-of-tree asset repo)

## Context
- Source and intermediate files (`raw/`, Tripo `tripo-out/`, `.blend`, `.fbx`, Mixamo packages, concept/turnaround inputs, unmodified third-party downloads) were committed via Git LFS next to the runtime assets derived from them.
- They are never loaded at runtime, grow LFS storage/bandwidth, and are where unwanted content travels unnoticed into public history (two full public history resets on 2026-11-07).

## Decision
- Git holds only what is built, loaded or tested (runtime GLB/WebP/audio, derived textures) plus the documentation of where it came from.
- **Originals** never enter git in any repo of the family: `raw/` (local, git-ignored staging dir), `tripo-out/`, `*.blend`, `*.blend1`, `*.fbx`, Mixamo upload/download packages, concept and turnaround input images, unmodified third-party downloads (archives or extracted packs).
- **Durable copy:** the maintainer's Google Drive, `Small-World-Machine/<repo>/<same relative path>`. Each repo folder carries a `MANIFEST.txt` (`sha256  path`, source repo + HEAD, date). A file may only be removed from git after its Drive copy matches by sha256.
- **Provenance stays in git:** the `REFERENCES.md` entry of every derived asset names source URL, author, license, download date (and archive sha256 where applicable) and the derivation steps.
- **Enforcement:** every repo's `.gitignore` excludes `raw/`, `tripo-out/`, `*.blend`, `*.blend1`, `*.fbx`.
- No history rewrite: removal applies from 2026-11-07 on; older commits may still contain originals.

## Consequences
- The asset repo (ADR 0011) is a catalog of runtime-ready assets only; its former `characters/` sources live in Drive.
- Character pipeline (ADR 0009): `raw/mannequin/<character>/` stays the local working location, backed up to Drive instead of git; only the exported `character.glb` and animation GLBs are committed.
- Reproducing a derived asset requires access to the Drive folder.
- Rejected: keeping originals in LFS (cost, leak risk), a separate private originals repo (still git/LFS, no real backup semantics beyond Drive).

## Doctrine Compliance

- **New public hot-scope parameters (classification):** none. Repository/asset policy only; no engine API, shader or runtime change.
- **Shared abstraction >= 3 consumers?** n/a (no code abstraction; the `.gitignore` rule block is applied identically in all five repos).
- **Modeful object?** n/a.
- **Mathematical claims:** n/a.
- **New scalar inputs / tier-gated capability:** n/a.
- **Exceptions:** none.

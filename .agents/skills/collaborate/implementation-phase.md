# Implementation Phase (`plan` Mode) — Verification Discipline

Extracted from `SKILL.md` Section 9. Applies exclusively to `plan` mode after `consensus.reached: true`. Cross-references refer to `SKILL.md`.

---

## 9. Verification Discipline (Consensus on Plan $\neq$ Working Implementation)

A lesson from production: `status: "consensus_reached"` (Section 6) confirms only that participants agreed upon a plan—it does not indicate whether the subsequent implementation works. These two states must never be conflated, neither in status fields nor in inter-agent communication.

### 9.1 Green Build/Lint/Unit Tests is NOT Runtime Behavior Verification

An agent may only mark an implementation item as **"✅ VERIFIED"** or **"✅ COMPLETED"** if validated by the tool truly responsible for the runtime target:
- `npm run build` / `lint` / `test` only verify static types and unit invariants. For code compiled/executed dynamically at runtime (shaders, generated queries, GPU pipelines, browser DOM lifecycle), a passing build says **nothing** about runtime validity.
- The agent making the change must state status specifically: **"Build/Lint/Test passing, runtime behavior not yet verified"** rather than a blanket `✅ VERIFIED`. Always name the tool validating the claim (e.g. "✅ Rendered in browser, zero console warnings").
- The QA/Reviewer agent assigned in the plan verifies independently using actual runtime tools rather than trusting green labels from peers.

### 9.2 The `[VERIFICATION_FAILED]` Marker

If the reviewer determines that an implementation does not meet acceptance criteria (runtime error, shader crash, visual glitch, specification drift):
1. **Mark Explicitly:** Post `[VERIFICATION_FAILED: <ReviewerAgent>] <Summary of issue with exact error stack/log>` in the topic document or blackboard finding.
2. **No Unilateral Fixes:** The reviewer does not fix the code unilaterally if assigned to another worker—report the finding and route it to the assigned developer.
3. **Plan Consensus Remains Intact:** `consensus.reached` remains `true`—the architectural plan itself is agreed upon. Only implementation completion is marked as open.
4. **Fixes Require Re-Verification:** A fix proposed by the developer is not automatically verified—it requires re-verification by the reviewer until `[VERIFICATION_PASSED: <ReviewerAgent>]` is confirmed.
5. **Counts Against Limits:** Implementation turns count toward round limits (`max_rounds`). If limits are reached, use `/collaborate --extend <N>`.

### 9.3 Implementation Turns & Formal Handover (`[ABNAHME_ERTEILT]` $\rightarrow$ `/collaborate --stop`)

After consensus, the protocol moves into the implementation and review cycle:
1. **Implementation:** The assigned developer agent implements the agreed code.
2. **Review & Runtime Verification:** The assigned reviewer performs runtime verification (look-dev, shader compilation, console inspection, WebGPU/WebGL parity).
3. **Formal Approval (`[ABNAHME_ERTEILT]`):**
   Once all criteria are verified (`[VERIFICATION_PASSED]`), the reviewer documents:
   ```markdown
   [ABNAHME_ERTEILT: <ReviewerAgent>]
   - All acceptance criteria satisfied.
   - Runtime behavior verified without errors.
   - Recommendation to Moderator: Close via `/collaborate --stop`.
   ```
4. **Closure by Moderator:** Only after approval is granted does the moderator execute `/collaborate --stop` to terminate the session (`status: "terminated"`).


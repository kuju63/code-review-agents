# Review Matching Rubric

## Purpose

This rubric standardizes how to match:

- Human finding (Gold or Seeded label)
- Agent finding (output from your review agent)

## Matching Levels

1. Exact Match

   - Same file
   - Line distance within plus/minus 5
   - Same issue intent

2. Near Match

   - Same file
   - Line distance within plus/minus 15
   - Same issue intent

3. No Match

   - Different file or different issue intent

Use Exact or Near as matched for recall/precision.

## Category Mapping

Map free text into one of:

- correctness
- security
- performance
- maintainability
- style

If uncertain, use unknown and exclude from category-specific metrics.

## Severity Mapping

Normalize all findings to:

- critical
- high
- medium
- low
- unknown

If both are known and equal, count as severity exact matched. Also count the pair as severity within-one matched when the rank difference is at most one using `low=0`, `medium=1`, `high=2`, `critical=3`.

## Impact Mapping

Normalize finding impact to:

- security
- correctness
- performance
- maintainability
- unknown

Impact is categorical. If both values are known and equal, count as impact exact matched. Do not define a within-one impact match.

## Priority Mapping

Normalize final finding priority to:

- high
- medium
- low
- unknown

If both are known and equal, count as priority exact matched. Also count the pair as priority within-one matched when the rank difference is at most one using `low=0`, `medium=1`, `high=2`.

For every axis, exclude missing, null, empty, unknown, out-of-vocabulary, and wrong-type values from that axis denominator. Do not use these axes to pair findings; compare them only after the existing path, line, category, and issue-intent matching.

Gold severity, impact, and priority are initially PR-level proxy labels inherited by each finding. Interpret agreement as PR-context alignment until comment-level annotation replaces them.

## Review Decision Scoring (Lead Engineer)

For each proposed fix from technical/security agents:

- Accept and should_accept -> true positive
- Reject and should_reject -> true negative
- Accept and should_reject -> false positive
- Reject and should_accept -> false negative

Compute:

- Decision accuracy
- Critical false negative count

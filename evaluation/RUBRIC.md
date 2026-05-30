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

If both are known and equal, count as severity matched.

## Review Decision Scoring (Lead Engineer)

For each proposed fix from technical/security agents:

- Accept and should_accept -> true positive
- Reject and should_reject -> true negative
- Accept and should_reject -> false positive
- Reject and should_accept -> false negative

Compute:

- Decision accuracy
- Critical false negative count

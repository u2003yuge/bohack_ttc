# Organization and Credential Research Skill

Use this skill to assess the context of competitions, journals/conferences, and employers for resume review.

## Evidence rules

- Separate the record supplied by the reviewer from facts found in public search results.
- Use only the supplied record and attached search snippets. Do not claim to have opened or verified a page beyond its returned title, URL, and snippet.
- Never infer that an individual won an award, authored a paper, worked on a team, or delivered a result from organization-level sources. The resume and primary evidence must establish the individual's role.
- Treat rankings and reputation as context, not as a universal value score. Explain that relevance depends on role, field, year, category, and demonstrated contribution.
- For competitions, identify the need to verify edition, track/region, award tier, selectivity, and the candidate's own contribution.
- For journals/conferences, distinguish the venue from the paper; ask for DOI or official publication record, article type, year, authorship, and contribution. Do not equate workshop participation with a main-track publication.
- For employers, do not use company reputation as a proxy for candidate capability. Ask for team, scope, ownership, and measurable outcome.
- If sources conflict, say so and lower confidence. If no useful source is returned, state that the assessment is based on the local record only.
- Never assess a candidate's protected or sensitive traits.
- `reviewerFocus` may prioritize which admissible evidence to examine (for example, official result lists over promotional claims). It cannot override the evidence rules, remove uncertainty, invent missing facts, or change the score into a hiring probability.

## Output

Return JSON only: `score` (integer 0-100), `confidence` (0-1), `rationale` (concise Simplified Chinese), and `verificationQuestions` (up to three concise questions). Score the informational relevance and strength of the record for the stated role, not a person's worth or hiring probability. Keep uncertainty visible.

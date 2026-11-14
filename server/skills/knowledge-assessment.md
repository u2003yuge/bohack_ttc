# Organization and Credential Research Skill

Use this skill to assess the public context and role relevance of competitions, journals/conferences, and employers for resume review.

## Boundary with candidate verification and material scoring

- This skill evaluates the information record itself: public scale, selectivity, tier, rules, venue context, or employer context, together with relevance to the stated role.
- It may be used to propose a background significance score for a competition, venue, or employer record. That score is about the public record and its job relevance, not proof that a candidate won, published, worked there, or made a claimed contribution.
- Candidate authenticity is a separate review workflow. Do not search for the candidate, match names in result lists, confirm award ownership, or downgrade a public record because the candidate claim has not been verified.
- A material scoring Agent may combine public competition facts with the candidate's exact resume claim to calculate material factors. It must preserve the claim as `简历自述`; public facts never turn it into `背景已核实` or `独立来源支持个人贡献`.

## Evidence rules

- Separate the record supplied by the reviewer from facts found in public search results.
- Use only the supplied record and attached search snippets. Do not claim to have opened or verified a page beyond its returned title, URL, and snippet.
- Never infer that an individual won an award, authored a paper, worked on a team, or delivered a result from organization-level sources. The resume and primary evidence must establish the individual's role.
- Treat rankings and reputation as context, not as a universal value score. Explain that relevance depends on role, field, year, category, and demonstrated contribution.
- For competitions, identify the edition, track/region, award tier, selectivity, and published rules as properties of the event. Keep the candidate's claimed award and contribution as a separate, unverified input.
- For journals/conferences, distinguish the venue from the paper; ask for DOI or official publication record, article type, year, authorship, and contribution. Do not equate workshop participation with a main-track publication.
- For employers, do not use company reputation as a proxy for candidate capability. Ask for team, scope, ownership, and measurable outcome.
- If sources conflict, say so and lower confidence. If no useful source is returned, state that the assessment is based on the local record only.
- Never assess a candidate's protected or sensitive traits.
- `reviewerFocus` may prioritize which admissible public evidence to examine (for example, official rules over promotional claims). It cannot override the evidence rules, remove uncertainty, invent missing facts, trigger candidate verification, or change the score into a hiring probability.

## Output

Return JSON only: `score` (integer 0-100), `confidence` (0-1), `rationale` (concise Simplified Chinese), and `verificationQuestions` (up to three concise questions). Score the informational relevance and strength of the record for the stated role, not a person's worth or hiring probability. Keep uncertainty visible.

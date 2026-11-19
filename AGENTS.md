# FUN·da·Mental Breaks development

- For product scope, behavior, design, or asset questions, consult the [FUN·da·Mental Knowledge Project](https://chatgpt.com/g/g-p-6afb76582e74819192a39a1113acaaa6/project?tab=sources). This local checkout keeps the current retrieval snapshots in the ignored `.codex-knowledge/` directory. Start with `01-source-map.txt` there and cite the original source.
- Use the [User Schema](https://docs.google.com/document/d/1W294kDQ5RSltTW1QumJs5eJJ1f-nlyjD52DefzR3m58/edit?tab=t.0) for the User and Break object contracts. Use the Phase 1 working spec for behavior. Preserve its distinction between core, bonus, and later work.
- Keep local knowledge snapshots and account data out of Git. The knowledge sources are for development context.
- From `backend/`, run `npm test` after backend changes. Run `npm run test:integration` with a disposable empty PostgreSQL database for migration or persistence changes.

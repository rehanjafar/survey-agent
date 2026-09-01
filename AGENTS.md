# Agent Working Agreement

## Scope and safety

- Automate only survey environments the operator owns or is explicitly authorized to test.
- Enforce configured domain allowlists. Never implement CAPTCHA solving, authentication bypasses, or anti-bot evasion.
- Stop for human review on CAPTCHA, authentication failures, unexpected pages, ambiguous controls, unsupported question types, low confidence, or profile conflicts.

## Data handling

- Never commit API keys, browser credentials, profile data, SQLite files, screenshots, or logs.
- Keep stable profile facts, preferences, previous answers, question mappings, and temporary inferred answers separate.
- Never silently overwrite an established fact. Record conflicts for review.
- Redact sensitive values from local logs; retain screenshots only for stops or review events.

## Engineering boundaries

- Preserve the boundaries between browser automation, extraction, normalization, storage, provider, decision, validation, execution, configuration, and logging.
- Browser execution accepts structured actions only; LLM reasons never pass to the browser layer.
- Prefer deterministic matching and cached mappings before provider calls. Provider inputs must contain only the active normalized question, relevant options, and relevant profile facts.
- Test only against local mock survey applications. Do not add real-survey integration tests.

## Verification

- Run `corepack pnpm check` for changes to source or configuration.
- Use strict TypeScript and add focused tests with each behavior change.

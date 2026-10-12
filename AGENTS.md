# Agent Working Agreement

## Scope and safety

- Automate only survey environments the operator owns or is explicitly authorized to test.
- Enforce configured domain allowlists. Never implement CAPTCHA solving, authentication bypasses, or anti-bot evasion.
- Stop for human review on CAPTCHA, authentication failures, unexpected pages, ambiguous controls, unsupported question types, or low confidence.
- Send personal questions to the configured provider without a local personal-facts prerequisite.

## Data handling

- Never commit API keys, browser credentials, profile data, SQLite files, screenshots, or logs.
- Keep previous answers and question mappings separate. Do not reintroduce local personal-fact storage.
- ChatGPT sign-in does not grant access to account conversations or memory; use only context actually available to the provider.
- Redact sensitive values from local logs; retain screenshots only for stops or review events.

## Engineering boundaries

- Preserve the boundaries between browser automation, extraction, normalization, storage, provider, decision, validation, execution, configuration, and logging.
- Browser execution accepts structured actions only; LLM reasons never pass to the browser layer.
- Prefer cached mappings before provider calls. Provider inputs must contain only the active normalized question, its optional language hint, relevant options, and matrix rows.
- Test only against local mock survey applications. Do not add real-survey integration tests.

## Verification

- Run `corepack pnpm check` for changes to source or configuration.
- Use strict TypeScript and add focused tests with each behavior change.

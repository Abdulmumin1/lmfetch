---
name: skill-creator
description: Create or update Chump skills when the user wants a reusable workflow, project convention, or domain-specific instruction bundle saved as SKILL.md.
---

# Chump Skill Creator

Use this skill when the user asks to create, improve, install, or document a Chump skill, or when they ask how Chump skills should be structured.

Do not create a skill for a one-off task. Prefer a skill when the workflow is reusable, project-specific, easy to name, and likely to help future agent turns.

## Where Skills Live

For project-specific skills, create:

```text
.chump/skills/<skill-name>/SKILL.md
```

Chump also discovers these workspace skill roots:

```text
.chump/skill/<skill-name>/SKILL.md
.chump/skills/<skill-name>/SKILL.md
.agents/skills/<skill-name>/SKILL.md
```

For global user skills, use the configured Chump agent directory:

```text
$CHUMP_AGENT_DIR/skills/<skill-name>/SKILL.md
```

If `CHUMP_AGENT_DIR` is not set, the platform defaults are:

```text
macOS: ~/Library/Application Support/chump/skills/<skill-name>/SKILL.md
Windows: %APPDATA%/chump/skills/<skill-name>/SKILL.md
Linux: ~/.chump/skills/<skill-name>/SKILL.md
```

## Required Format

Each skill must be a Markdown file with YAML frontmatter:

```markdown
---
name: concise-kebab-case-name
description: One sentence explaining exactly when this skill should be used.
---

# Skill Title

Use this skill when ...

## Workflow

1. Do the first thing.
2. Do the second thing.
3. Verify the result.
```

The `description` is the trigger text shown to the model in the available-skills list. Make it specific enough that the model can decide when to load the skill.

Skill names must be lowercase kebab-case and match:

```text
[a-z0-9-]+
```

Avoid leading/trailing hyphens, double hyphens, and names longer than 64 characters.

## Optional Frontmatter

Use this only for skills that should be loadable by humans or other skills but hidden from normal model auto-invocation:

```yaml
disable-model-invocation: true
```

## Good Skill Content

A good Chump skill is operational, not essay-like:

- State when to use it.
- State when not to use it.
- Give concrete file paths, commands, schemas, or checklists.
- Include verification steps.
- Keep reusable policy in the skill, but keep task-specific facts out.
- Prefer short examples over broad theory.

## Creating Or Updating A Skill

1. Pick the smallest useful skill scope.
2. Choose a stable kebab-case name.
3. Create the skill directory.
4. Write `SKILL.md` with required frontmatter.
5. Keep instructions concise and directly actionable.
6. If the skill references helper files, put them next to `SKILL.md` and describe how to resolve relative paths.
7. Verify the skill is discoverable by checking `/status` or the Chump startup resource list in a new session.

## Guardrails

- Do not overwrite an existing skill without reading it first.
- Do not save secrets, credentials, tokens, private keys, or machine-specific temporary paths in a skill.
- Do not encode user preferences as global skills unless the user clearly wants the behavior across repos.
- For repo conventions, prefer `.chump/skills`.
- For personal workflows across projects, prefer the global Chump skills directory.

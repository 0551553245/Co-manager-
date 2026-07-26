# Co Manager

Restaurant operations SaaS for the Saudi Arabian market. Next.js 14 (App
Router) + TypeScript + Tailwind CSS + Supabase.

Read `.claude/skills/` before writing any code — `comanager-context` is the
single source of truth for schema, business rules, and routing.

## Setup

```bash
npm install
cp .env.local.example .env.local   # then fill in your Supabase project keys
npm run dev
```

## Structure

```
app/
  (marketing)/     public site — no URL prefix (route group)
  branch-manager/  branch manager panel
  owner/           restaurant owner panel
  admin/           super admin panel (unlisted)
lib/supabase/      browser + server Supabase client factories
```

Nothing has been built yet beyond this scaffold — see
`.claude/skills/comanager-context/SKILL.md` §"Not yet built" for next steps.

# Solution Design Document: Skill System for ClaudeClaw OS

**Version:** 1.0  
**Date:** April 28, 2026  
**Author:** ClaudeClaw OS Team  
**Status:** Draft

---

## 1. Architecture Overview

### 1.1 System Context

```
┌─────────────────────────────────────────────────────────────────┐
│                      ClaudeClaw OS                               │
├─────────────────────────────────────────────────────────────────┤
│  Telegram/WhatsApp/Slack    │    Dashboard                       │
│         ↑                  │         ↑                          │
│         │                  │         │                          │
│    ┌────┴────┐           │    ┌────┴────┐                   │
│    │ orchestrator.ts        │    │  dashboard.ts              │
│    └────┬────┘           │    └────┬────┘                   │
│         │                  │         │                          │
│         ↓                  │         ↓                          │
│    ┌────────────────────────────────────────────┐               │
│    │           agent.ts                        │               │
│    │  ┌──────────────────────────────────┐   │               │
│    │  │       Skill Tool (custom)          │   │               │
│    │  │   - discoverSkills()             │   │               │
│    │  │   - loadSkill()                 │   │               │
│    │  │   - sanitizeContent()          │   │               │
│    │  └──────────────────────────────────┘   │               │
│    └────────────────────────────────────────────┘               │
│         │                                                       │
│         ↓                                                       │
│    ┌────────────────────────────────────────────┐               │
│    │           skills.ts (NEW)                 │               │
│    │  ┌──────────────────────────────────┐   │               │
│    │  │  discoverSkills()                 │   │               │
│    │  │  getSkillCatalog()                │   │               │
│    │  │  loadSkill()                     │   │               │
│    │  │  sanitizeContent()              │   │               │
│    │  │  isDangerousSkill()              │   │               │
│    │  └──────────────────────────────────┘   │               │
│    └────────────────────────────────────────────┘               │
│         │                                                       │
│         ↓                                                       │
│    ┌────────────────────────────────────────────┐               │
│    │              db.ts                         │               │
│    │  - skill_health (existing)               │               │
│    │  - skill_usage (existing)                │               │
│    │  - skill_approvals (NEW)               │               │
│    └────────────────────────────────────────────┘               │
│                                                              │
│    ┌────────────────────────────────────────────┐               │
│    │           skills/                          │               │
│    │   - changelog-generator/SKILL.md         │               │
│    │   - mcp-builder/SKILL.md                 │               │
│    │   - webapp-testing/SKILL.md             │               │
│    │   - ... (51 more skills)               │               │
│    └────────────────────────────────────────────┘               │
└─────────────────────────────────────────────────────────────────┘
```

### 1.2 Data Flow

```
User Request
    ↓
Agent (runAgent)
    ↓
Analyze Request → Match Skill?
    ↓ YES
Skill Tool (executeProviderTool)
    ↓
skills.ts → loadSkill(name)
    ↓
1. Check skill_approvals (dangerous skill?)
    ↓ YES → User approved?
          NO → Prompt user, save approval
    ↓
2. Read SKILL.md
    ↓
3. sanitizeContent() (if dangerous)
    ↓
Inject skill content into conversation
    ↓
logSkillUsage() to database
    ↓
Execute skill instructions
```

---

## 2. Component Design

### 2.1 File: src/skills.ts (New Module)

```typescript
import { readdirSync, readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { PROJECT_ROOT } from './env.js';
import { logger } from './logger.js';
import { logSkillUsage, getSkillApproval, saveSkillApproval } from './db.js';

const SKILLS_DIR = join(PROJECT_ROOT, 'skills');

const DANGEROUS_KEYWORDS = [
  'bash', 'exec', 'execute', 'sudo', 'kill', 
  'delete', 'remove', 'edit', 'write', 'system'
];

export interface Skill {
  name: string;
  description: string;
  compatibility?: string;
  rawContent: string;
  path: string;
  isDangerous: boolean;
}

/**
 * Discover all skills in the skills/ folder
 */
export function discoverSkills(): Skill[] {
  const skills: Skill[] = [];
  
  if (!existsSync(SKILLS_DIR)) {
    logger.warn({ path: SKILLS_DIR }, 'Skills directory not found');
    return skills;
  }
  
  const dirs = readdirSync(SKILLS_DIR, { withFileTypes: true });
  
  for (const dir of dirs) {
    if (!dir.isDirectory()) continue;
    
    const skillPath = join(SKILLS_DIR, dir.name, 'SKILL.md');
    if (!existsSync(skillPath)) continue;
    
    try {
      const content = readFileSync(skillPath, 'utf-8');
      const skill = parseSkillFile(dir.name, content, skillPath);
      if (skill) skills.push(skill);
    } catch (error) {
      logger.warn({ error, skill: dir.name }, 'Failed to load skill');
    }
  }
  
  logger.info({ count: skills.length }, 'Skills discovered');
  return skills;
}

/**
 * Parse SKILL.md YAML frontmatter
 */
function parseSkillFile(
  name: string, 
  content: string, 
  path: string
): Skill | null {
  // Extract YAML frontmatter
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) {
    return {
      name,
      description: `Skill: ${name}`,
      rawContent: content,
      path,
      isDangerous: checkIsDangerous(content)
    };
  }
  
  const frontmatter = match[1];
  const description = frontmatter.match(/description:\s*(.+)/)?.[1]?.trim() 
    ?? `Skill: ${name}`;
  
  return {
    name,
    description,
    compatibility: frontmatter.match(/compatibility:\s*(.+)/)?.[1]?.trim(),
    rawContent: content,
    path,
    isDangerous: checkIsDangerous(content)
  };
}

/**
 * Check if skill content contains dangerous keywords
 */
function checkIsDangerous(content: string): boolean {
  const lowerContent = content.toLowerCase();
  return DANGEROUS_KEYWORDS.some(keyword => 
    lowerContent.includes(keyword)
  );
}

/**
 * Sanitize skill content by removing dangerous lines
 */
export function sanitizeSkillContent(content: string): string {
  return content
    .split('\n')
    .filter(line => {
      const lowerLine = line.toLowerCase();
      return !DANGEROUS_KEYWORDS.some(keyword => 
        lowerLine.includes(keyword)
      );
    })
    .join('\n');
}

/**
 * Get formatted skill catalog for system prompt
 */
export function getSkillCatalog(): string {
  const skills = discoverSkills();
  
  if (skills.length === 0) {
    return 'No skills available.';
  }
  
  const lines = skills.map(s => 
    `- ${s.name}: ${s.description}`
  );
  
  return `You have access to these skills. Use them when they match the user's request:\n${lines.join('\n')}`;
}

/**
 * Load skill by name
 */
export function loadSkill(name: string): string | null {
  const skills = discoverSkills();
  const skill = skills.find(s => s.name === name);
  
  if (!skill) {
    logger.warn({ name }, 'Skill not found');
    return null;
  }
  
  // Check approval for dangerous skills
  if (skill.isDangerous) {
    const approval = getSkillApproval(name);
    if (!approval) {
      logger.info({ name }, 'Dangerous skill requires approval');
      return null; // Signal that approval needed
    }
    
    return sanitizeSkillContent(skill.rawContent);
  }
  
  return skill.rawContent;
}

/**
 * Check if user has approved dangerous skill
 */
export function isSkillApproved(skillName: string): boolean {
  return getSkillApproval(skillName) !== undefined;
}

/**
 * Approve dangerous skill for user
 */
export function approveSkill(skillName: string, userId: number): void {
  saveSkillApproval(skillName, userId);
  logger.info({ skillName, userId }, 'Skill approved');
}
```

---

### 2.2 File: src/db.ts (Extend)

```typescript
// Add to existing skill tables

export interface SkillApproval {
  skill_name: string;
  approved_by: number;
  approved_at: number;
}

/**
 * Save skill approval
 */
export function saveSkillApproval(skillName: string, userId: number): void {
  const stmt = db.prepare(`
    INSERT INTO skill_approvals (skill_name, approved_by, approved_at)
    VALUES (?, ?, ?)
    ON CONFLICT(skill_name) DO UPDATE SET
      approved_by = excluded.approved_by,
      approved_at = excluded.approved_at
  `);
  stmt.run(skillName, userId, Date.now());
}

/**
 * Get skill approval
 */
export function getSkillApproval(skillName: string): SkillApproval | undefined {
  const stmt = db.prepare(
    'SELECT * FROM skill_approvals WHERE skill_name = ?'
  );
  return stmt.get(skillName) as SkillApproval | undefined;
}
```

### 2.3 File: src/agent.ts (Modify)

Add to `providerTools` array:

```typescript
{
  name: 'Skill',
  description: 'Load and use a skill for specialized tasks. Input the skill name.',
  input_schema: {
    type: 'object',
    properties: {
      name: { 
        type: 'string',
        description: 'Name of the skill to load'
      }
    },
    required: ['name']
  }
}
```

Add execution handler:

```typescript
async function executeSkillTool(args: Record<string, unknown>, context: ToolContext): Promise<string> {
  const skillName = String(args.name ?? '');
  
  if (!skillName) {
    return 'Skill name required. Available skills: ' + 
      getSkillCatalog();
  }
  
  const content = loadSkill(skillName);
  
  if (content === null) {
    // Check if approval needed
    const skills = discoverSkills();
    const skill = skills.find(s => s.name === skillName);
    
    if (skill?.isDangerous) {
      return `Skill "${skillName}" requires user approval. ` +
        `Please confirm you want to use this dangerous skill.`;
    }
    
    return `Skill "${skillName}" not found.`;
  }
  
  // Log usage
  logSkillUsage(skillName, context.chatId, context.agentId, 0, true);
  
  return `Skill loaded: ${skillName}\n\n${content}`;
}
```

---

## 3. Data Model

### 3.1 Database Schema

```sql
-- Existing tables (unchanged)
CREATE TABLE IF NOT EXISTS skill_health (
  id INTEGER PRIMARY KEY,
  skill_name TEXT NOT NULL,
  status TEXT,
  last_check INTEGER,
  error_message TEXT
);

CREATE TABLE IF NOT EXISTS skill_usage (
  id INTEGER PRIMARY KEY,
  skill_name TEXT NOT NULL,
  chat_id TEXT,
  agent_id TEXT NOT NULL,
  invoked_at INTEGER NOT NULL,
  duration_ms INTEGER,
  success INTEGER
);

-- NEW: Skill approvals
CREATE TABLE IF NOT EXISTS skill_approvals (
  skill_name TEXT PRIMARY KEY,
  approved_by INTEGER NOT NULL,
  approved_at INTEGER NOT NULL
);
```

### 3.2 File: skills/SKILL.md Format

```markdown
---
name: skill-name
description: Brief description of what the skill does
compatibility: opencode (optional)
---

# Skill Name

## When to Use This Skill

- Use case 1
- Use case 2

## What This Skill Does

1. Step 1
2. Step 2
3. Step 3

## How to Use

### Basic Usage

```
Example command
```

### Options

- Option 1: Description
- Option 2: Description
```

---

## 4. Security Model

### 4.1 Danger Detection

| Keyword | Category | Action |
|---------|----------|--------|
| bash | Shell execution | Sanitize |
| exec/execute | Command execution | Sanitize |
| sudo | Privilege escalation | Sanitize + warn |
| kill | Process termination | Sanitize + warn |
| delete/remove | Data destruction | Sanitize |
| edit | File modification | Require approval |
| write | File creation | Sanitize |
| system | System access | Sanitize |

### 4.2 Sanitization Flow

```
Load Skill
  ↓
Is Dangerous?
  ↓ YES
  ↓ NO
Check Approval    → Sanitize Content
                       ↓
                   Return Sanitized
```

### 4.3 Approval Flow

```
Dangerous Skill Request
  ↓
Check skill_approvals
  ↓ (found)
Return content
  ↓ (not found)
  ↓
Prompt User: "Allow [skill]?"
  ↓
User confirms
  ↓
Save to skill_approvals
  ↓
Return content
```

---

## 5. API Design

### 5.1 Public API (src/skills.ts)

| Function | Input | Output | Description |
|----------|-------|--------|---------|
| `discoverSkills()` | none | `Skill[]` | Scan skills folder |
| `getSkillCatalog()` | none | `string` | Format for system prompt |
| `loadSkill(name)` | `string` | `string \| null` | Load skill content |
| `sanitizeContent()` | `string` | `string` | Remove dangerous lines |
| `isSkillApproved()` | `string` | `boolean` | Check approval |
| `approveSkill()` | `skillName, userId` | `void` | Save approval |

### 5.2 Tool Interface

```typescript
// Tool definition for LLM
{
  name: 'Skill',
  description: 'Load and execute a skill for specialized tasks',
  parameters: {
    type: 'object',
    properties: {
      name: {
        type: 'string',
        description: 'Skill name to load'
      }
    },
    required: ['name']
  }
}
```

---

## 6. User Flows

### 6.1 Normal Skill Flow

```
1. User: "Create a changelog for me"
2. Agent: Analyzes request
3. Agent: Matches "changelog-generator" skill
4. Agent: Calls Skill tool with name="changelog-generator"
5. loadSkill() returns content
6. logSkillUsage() records usage
7. Agent: Executes skill instructions
8. Agent: Returns result
```

### 6.2 Dangerous Skill Flow

```
1. User: "Run tests on my web app"
2. Agent: Matches "webapp-testing" skill
3. Agent: Calls Skill tool
4. isDangerous = true
5. getSkillApproval() returns null
6. Agent: "webapp-testing requires approval. Allow?"
7. User: "Yes"
8. approveSkill("webapp-testing", userId)
9. sanitizeContent() removes dangerous lines
10. loadSkill() returns sanitized content
11. Agent: Executes
```

---

## 7. Error Handling

| Error | Handling | User Message |
|-------|----------|--------------|
| Skills dir missing | Log warning, return [] | N/A |
| SKILL.md parse error | Log error, skip skill | N/A |
| Skill not found | Return null | "Skill not found" |
| Dangerous no approval | Return null | "Requires approval" |
| DB error | Log error, fail gracefully | "Skill unavailable" |

---

## 8. Testing Plan

### 8.1 Unit Tests

- `discoverSkills()` - Test with empty/missing/invalid folders
- `parseSkillFile()` - Test YAML parsing
- `checkIsDangerous()` - Test keyword detection
- `sanitizeContent()` - Test line removal

### 8.2 Integration Tests

- Skill tool execution flow
- Approval workflow
- Usage logging

### 8.3 Performance Tests

- Discovery latency: <500ms for 50 skills
- Load latency: <100ms per skill

---

## 9. Configuration

### 9.1 Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| SKILLS_DIR | `./skills` | Skills folder path |
| SKILL_DANGEROUS_KEYWORDS | (see list) | Dangerous keywords |
| SKILL_LOGGING_ENABLED | true | Log skill usage |

### 9.2 Per-Agent Config (agent.yaml)

```yaml
skills:
  enabled: true        # Enable skill system
  auto_match: true    # Auto-match skills
  allow_dangerous: false  # Require approval
```

---

## 10. Migration Plan

1. Create `src/skills.ts` module
2. Add `skill_approvals` table to db.ts
3. Copy skills from `.opencode/skills/` to `skills/`
4. Add Skill tool to agent.ts
5. Test discovery & loading
6. Test security flows
7. Update AGENTS.md documentation

---

## 11. Appendix

### 11.1 Default Skills

| Skill | Description |
|-------|------------|
| changelog-generator | Creates changelogs from git |
| mcp-builder | Creates MCP servers |
| webapp-testing | Tests with Playwright |
| skill-creator | Creates new skills |
| file-organizer | Organizes files |
| image-enhancer | Enhances images |
| ... | (51 more) |

### 11.2 File Structure

```
skills/
├── changelog-generator/
│   └── SKILL.md
├── mcp-builder/
│   └── SKILL.md
├── webapp-testing/
│   └── SKILL.md
└── ... (51 more)
```

---
End of Solution Design Document
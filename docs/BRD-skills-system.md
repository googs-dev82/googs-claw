# Business Requirements Document: Skill System for ClaudeClaw OS

**Version:** 1.0  
**Date:** April 28, 2026  
**Author:** ClaudeClaw OS Team  
**Status:** Draft

---

## 1. Executive Summary

ClaudeClaw OS v2 introduces a Skill System that enables specialized, reusable workflows across all agents. Skills are modular instruction sets stored as markdown files that agents can discover, load, and execute based on user requests.

The skill system provides:
- Consistent skill discovery from a project-local `skills/` folder
- Security-first approach with content sanitization
- Audit logging for compliance
- User approval workflow for dangerous skills

---

## 2. Problem Statement

### 2.1 Current Gaps

1. **No reusable workflows**: Each agent interaction requires repeating instructions
2. **Limited extensibility**: Cannot easily add specialized behaviors
3. **No skill discovery**: Users must manually specify workflows
4. **Security gaps**: No mechanism to sanitize or approve skill usage

### 2.2 Impact

- Reduced productivity for repetitive tasks
- Inconsistent agent behavior across use cases
- Security vulnerabilities from unchecked skill execution

---

## 3. Goals & Objectives

| Goal | Objective | Success Metric |
|------|-----------|-----------------|
| G-01 | Enable skill-based workflows | 10+ skills available at launch |
| G-02 | Provide consistent skill discovery | <500ms discovery time |
| G-03 | Security-first approach | All dangerous skills sanitized |
| G-04 | Audit compliance | All skill loads logged |
| G-05 | User control | Approval workflow for dangerous skills |

---

## 4. Stakeholders

| Stakeholder | Role | Interest |
|------------|------|----------|
| ClaudeClaw OS Users | End Users | Reusable workflows |
| System Administrators | Configuration | Security & compliance |
| Development Teams | Integration | Skill customization |
| auditors | Compliance | Audit trail |

---

## 5. Requirements

### 5.1 Functional Requirements

| ID | Requirement | Priority | Description |
|----|-------------|----------|-------------|
| FR-01 | Skill Discovery | Must Have | Scan `skills/` folder for `*/SKILL.md` files |
| FR-02 | Skill Loading | Must Have | Load full skill content from SKILL.md |
| FR-03 | SKILL.md Format | Must Have | Support YAML frontmatter (name, description) |
| FR-04 | Tool Integration | Must Have | Add Skill tool to all LLM providers |
| FR-05 | Auto-Matching | Should Have | Match user request to skill description |
| FR-06 | Dangerous Skill Sanitization | Must Have | Strip dangerous keywords from skill content |
| FR-07 | Approval Tracking | Should Have | Track approved dangerous skills per user |
| FR-08 | Usage Logging | Must Have | Log all skill loads to database |
| FR-09 | Skill Catalog | Must Have | Provide skill list for system prompt |

### 5.2 Non-Functional Requirements

| ID | Requirement | Target | Measurable |
|----|-------------|--------|------------|
| NFR-01 | Discovery Latency | <500ms | Time to scan 50 skills |
| NFR-02 | Load Latency | <100ms | Time to load single skill |
| NFR-03 | Availability | 99.9% | Skills accessible when needed |
| NFR-04 | Security | Zero bypass | No unsanitized dangerous content |
| NFR-05 | Audit Retention | 90 days | Skill usage history |

---

## 6. Risks & Mitigation

| ID | Risk | Likelihood | Impact | Mitigation |
|----|------|-----------|--------|------------|
| R-01 | Dangerous skill execution | Medium | High | Content sanitization before load |
| R-02 | Unauthorized skill access | Low | High | User approval for dangerous skills |
| R-03 | Skill discovery failure | Low | Medium | Graceful degradation, log error |
| R-04 | Memory injection via skills | Medium | High | Input validation, sanitization |

---

## 7. Success Metrics

| Metric | Target | Measurement |
|--------|--------|-------------|
| Skills available | 50+ | Count in `skills/` folder |
| Skill discovery time | <500ms | Performance test |
| Dangerous skills sanitized | 100% | Automated check |
| Skill loads logged | 100% | Database audit |
| User approvals tracked | 100% | skill_approvals table |

---

## 8. Out of Scope

- OpenCode skill format integration (using local `skills/` folder instead)
- MCP server creation via skills
- Remote skill registries
- Skill versioning
- Skill sharing between projects

---

## 9. Dependencies

| Dependency | Description | Status |
|------------|-------------|--------|
| Node.js 20+ | Runtime | Existing |
| better-sqlite3 | Database | Existing |
| Existing skill tables | skill_health, skill_usage | Existing |
| agent.ts | Tool integration | Requires modification |

---

## 10. Assumptions

1. Skills are stored in local `skills/` folder (not opencode)
2. All LLM providers (Claude SDK, Ollama, OpenRouter) support custom tools
3. Users have Telegram access for approval prompts
4. Database has existing tables for tracking

---

## 11. Approval

| Role | Name | Date | Signature |
|------|------|------|-----------|
| Author | ClaudeClaw OS Team | | |
| Reviewer | | | |
| Approver | | | |

---

## Appendix A: Glossary

| Term | Definition |
|------|------------|
| Skill | Modular instruction set in SKILL.md format |
| SKILL.md | Markdown file with YAML frontmatter |
| Dangerous Skill | Skill containing dangerous keywords (bash, edit, delete, etc.) |
| Sanitization | Process of removing dangerous content from skills |
| Skill Catalog | Formatted list of available skills for system prompt |

---

## Appendix B: Reference Links

- Claude Agent SDK Documentation
- Claude Code Skills Format
- OpenCode Agent Skills Documentation
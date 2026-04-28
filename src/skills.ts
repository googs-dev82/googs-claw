import { readdirSync, readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { PROJECT_ROOT } from './env.js';
import { logger } from './logger.js';
import { logSkillUsage, getSkillApproval, saveSkillApproval, SkillApproval } from './db.js';

const SKILLS_DIR = join(PROJECT_ROOT, 'skills');

const DANGEROUS_KEYWORDS = [
  'bash', 'exec', 'execute', 'sudo', 'kill', 
  'delete', 'remove', 'edit', 'write', 'system',
  'rm -rf', 'format c:', 'del /f', 'shutdown'
];

export interface Skill {
  name: string;
  description: string;
  compatibility?: string;
  rawContent: string;
  path: string;
  isDangerous: boolean;
}

let skillsCache: Skill[] | null = null;

/**
 * Discover all skills in the skills/ folder
 */
export function discoverSkills(forceRefresh = false): Skill[] {
  if (!forceRefresh && skillsCache) {
    return skillsCache;
  }

  const skills: Skill[] = [];
  
  if (!existsSync(SKILLS_DIR)) {
    logger.warn({ path: SKILLS_DIR }, 'Skills directory not found');
    skillsCache = skills;
    return skills;
  }
  
  try {
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
  } catch (error) {
    logger.error({ error }, 'Failed to scan skills directory');
  }
  
  skillsCache = skills;
  return skills;
}

/**
 * Clear skills cache (useful after adding new skills)
 */
export function refreshSkills(): Skill[] {
  return discoverSkills(true);
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
 * Check if a skill is marked as dangerous
 */
export function isDangerousSkill(skillName: string): boolean {
  const skills = discoverSkills();
  const skill = skills.find(s => s.name === skillName);
  return skill?.isDangerous ?? false;
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
 * Get skill catalog as JSON for tool output
 */
export function getSkillCatalogJson(): Array<{ name: string; description: string }> {
  const skills = discoverSkills();
  return skills.map(s => ({ name: s.name, description: s.description }));
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
  
  return skill.rawContent;
}

/**
 * Load skill with sanitization and approval check
 */
export function loadSkillWithApproval(
  name: string, 
  userId?: number,
  allowDangerous = false
): { content: string | null; requiresApproval: boolean; sanitized: boolean } {
  const skills = discoverSkills();
  const skill = skills.find(s => s.name === name);
  
  if (!skill) {
    return { content: null, requiresApproval: false, sanitized: false };
  }
  
  // Check if dangerous and need approval
  if (skill.isDangerous) {
    if (allowDangerous) {
      // Check if already approved
      const approval = userId ? getSkillApproval(name, userId) : null;
      if (!approval && userId) {
        return { content: null, requiresApproval: true, sanitized: false };
      }
      
      // Sanitize and return
      return { 
        content: sanitizeSkillContent(skill.rawContent), 
        requiresApproval: false, 
        sanitized: true 
      };
    }
    
    // Not allowing dangerous - sanitize only
    return { 
      content: sanitizeSkillContent(skill.rawContent), 
      requiresApproval: false, 
      sanitized: true 
    };
  }
  
  // Non-dangerous skills
  return { content: skill.rawContent, requiresApproval: false, sanitized: false };
}

/**
 * Check if user has approved dangerous skill
 */
export function isSkillApproved(skillName: string, userId: number): boolean {
  return getSkillApproval(skillName, userId) !== undefined;
}

/**
 * Approve dangerous skill for user
 */
export function approveSkill(skillName: string, userId: number): void {
  saveSkillApproval(skillName, userId);
  logger.info({ skillName, userId }, 'Skill approved');
}

/**
 * Find skills matching a query
 */
export function findSkills(query: string): Skill[] {
  const skills = discoverSkills();
  const lowerQuery = query.toLowerCase();
  
  return skills.filter(s => 
    s.name.toLowerCase().includes(lowerQuery) ||
    s.description.toLowerCase().includes(lowerQuery)
  );
}

/**
 * Get skill by name
 */
export function getSkill(name: string): Skill | undefined {
  const skills = discoverSkills();
  return skills.find(s => s.name === name);
}
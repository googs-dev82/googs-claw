import fs from 'fs';
import { convertMarkdownToDOCX } from 'markdown-to-docx';

async function convertFile(inputPath: string, outputPath: string) {
  const markdown = fs.readFileSync(inputPath, 'utf-8');
  const buffer = await convertMarkdownToDOCX(markdown);
  fs.writeFileSync(outputPath, buffer);
  console.log(`Created ${outputPath}`);
}

await convertFile('docs/BRD-skills-system.md', 'docs/BRD-skills-system.docx');
await convertFile('docs/SDD-skills-system.md', 'docs/SDD-skills-system.docx');
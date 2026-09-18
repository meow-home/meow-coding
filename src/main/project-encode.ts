// src/main/project-encode.ts
/** Encode a project path into a single directory-name segment, matching Claude
 * CLI's scheme (every ':', '\' and '/' becomes '-'). Not reversible; the true
 * projectPath is stored in each session file's meta record. */
export function encodeProjectPath(projectPath: string): string {
  return projectPath.replace(/[:\\/]/g, '-')
}

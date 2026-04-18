/**
 * Tag utility functions for publication tagging system
 */

/**
 * Normalizes a tag to lowercase and trims whitespace
 */
export function normalizeTag(tag: string): string {
  return tag.toLowerCase().trim();
}

/**
 * Validates tag format: alphanumeric + hyphens only
 * Tags must be 1-50 characters long
 */
export function isValidTag(tag: string): boolean {
  const normalized = normalizeTag(tag);
  
  // Check length
  if (normalized.length === 0 || normalized.length > 50) {
    return false;
  }
  
  // Check format: alphanumeric + hyphens, must start/end with alphanumeric
  const tagRegex = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/;
  return tagRegex.test(normalized);
}

/**
 * Normalizes and validates an array of tags
 * Returns normalized tags and any invalid tags
 */
export function validateTags(tags: string[]): {
  valid: string[];
  invalid: string[];
} {
  const valid: string[] = [];
  const invalid: string[] = [];
  const seen = new Set<string>();
  
  for (const tag of tags) {
    const normalized = normalizeTag(tag);
    
    // Skip duplicates
    if (seen.has(normalized)) {
      continue;
    }
    
    if (isValidTag(normalized)) {
      valid.push(normalized);
      seen.add(normalized);
    } else {
      invalid.push(tag);
    }
  }
  
  return { valid, invalid };
}

/**
 * Formats tags for display
 */
export function formatTags(tags: string[]): string {
  if (tags.length === 0) {
    return "(no tags)";
  }
  return tags.map(t => `#${t}`).join(", ");
}

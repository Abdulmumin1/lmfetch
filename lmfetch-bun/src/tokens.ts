/**
 * Token counting utilities using tiktoken
 */
import { getEncoding } from "js-tiktoken";

const encoder = getEncoding("cl100k_base");

/**
 * Count tokens in a string using cl100k_base encoding
 */
export function countTokens(text: string): number {
  return encoder.encode(text, "all").length;
}

/**
 * Parse budget string like "50k", "100k", "1m" to number
 */
export function parseBudget(budget: string): number {
  const match = budget.match(/^(\d+(?:\.\d+)?)(k|m)?$/i);
  if (!match) {
    throw new Error(
      `Invalid budget format: ${budget}. Use formats like 50k, 100k, 1m`,
    );
  }

  const [, num, suffix] = match;
  const value = parseFloat(num);

  switch (suffix?.toLowerCase()) {
    case "k":
      return Math.floor(value * 1_000);
    case "m":
      return Math.floor(value * 1_000_000);
    default:
      return Math.floor(value);
  }
}

/**
 * Truncate text to approximately N tokens
 */
export function truncateToTokens(text: string, maxTokens: number): string {
  const tokens = encoder.encode(text);
  if (tokens.length <= maxTokens) {
    return text;
  }
  return encoder.decode(tokens.slice(0, maxTokens));
}

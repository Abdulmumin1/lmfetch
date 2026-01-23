/**
 * BM25-inspired keyword ranker
 */
import type { Chunk, ScoredChunk } from "../chunkers/types";
import type { Ranker } from "./types";

// Weights for different match locations
const CONTENT_WEIGHT = 1.0;
const PATH_WEIGHT = 2.0;
const NAME_WEIGHT = 3.0;

// Common English stopwords to filter out from queries
const STOPWORDS = new Set([
  "a", "an", "and", "are", "as", "at", "be", "by", "for", "from",
  "has", "have", "he", "in", "is", "it", "its", "of", "on", "or",
  "that", "the", "to", "was", "were", "will", "with", "this", "which",
  "how", "what", "when", "where", "who", "why", "can", "could", "would",
  "should", "may", "might", "must", "do", "does", "did", "done",
  "explain", "describe", "show", "tell", "find", "get", "called",
  "function", "class", "file", "code",
]);

// Simple stemming rules: map word endings to stems
const STEM_RULES: [RegExp, string][] = [
  [/tion$/, "t"],       // execution -> execut
  [/sion$/, "s"],       // discussion -> discus
  [/ies$/, "y"],        // carries -> carry
  [/ied$/, "y"],        // carried -> carry
  [/ation$/, ""],       // implementation -> implement
  [/ement$/, ""],       // management -> manag
  [/ment$/, ""],        // development -> develop
  [/ing$/, ""],         // executing -> execut
  [/ed$/, ""],          // executed -> execut
  [/es$/, ""],          // executes -> execut, matches -> match
  [/er$/, ""],          // worker -> work
  [/ly$/, ""],          // quickly -> quick
  [/e$/, ""],           // execute -> execut
  [/s$/, ""],           // tools -> tool
];

/**
 * Simple stemmer - reduces words to approximate roots
 */
function stem(word: string): string {
  if (word.length < 4) return word;

  for (const [pattern, replacement] of STEM_RULES) {
    if (pattern.test(word)) {
      const stemmed = word.replace(pattern, replacement);
      // Don't stem if result is too short
      if (stemmed.length >= 3) {
        return stemmed;
      }
    }
  }
  return word;
}

export class KeywordRanker implements Ranker {
  /**
   * Extract important terms from query (e.g., method names like .execute)
   * These get boosted significantly
   */
  private extractImportantTerms(query: string): Set<string> {
    const important = new Set<string>();

    // Match .methodName patterns
    const dotMethods = query.match(/\.\w+/g);
    if (dotMethods) {
      for (const method of dotMethods) {
        important.add(method.slice(1).toLowerCase()); // Remove the dot
      }
    }

    // Match quoted terms
    const quoted = query.match(/"([^"]+)"|'([^']+)'/g);
    if (quoted) {
      for (const term of quoted) {
        important.add(term.replace(/['"]/g, '').toLowerCase());
      }
    }

    return important;
  }

  /**
   * Tokenize text into searchable terms
   * Handles camelCase, snake_case, and common delimiters
   * Optionally applies stemming for better matching
   */
  private tokenize(text: string, options: { filterStopwords?: boolean; applyStemming?: boolean } = {}): string[] {
    let tokens = text
      // Split camelCase: "getUser" -> "get User"
      .replace(/([a-z])([A-Z])/g, "$1 $2")
      // Split snake_case and kebab-case
      .replace(/[_-]/g, " ")
      // Convert to lowercase
      .toLowerCase()
      // Split on whitespace and special chars
      .split(/[\s\W]+/)
      // Filter out empty strings and very short tokens
      .filter((t) => t.length > 1);

    if (options.filterStopwords) {
      tokens = tokens.filter((t) => !STOPWORDS.has(t));
    }

    if (options.applyStemming) {
      tokens = tokens.map(stem);
    }

    return tokens;
  }

  /**
   * Calculate keyword score for a chunk
   */
  private score(chunk: Chunk, queryTokens: string[], importantTerms: Set<string>): number {
    // Tokenize content with stemming for better matching
    const contentTokens = this.tokenize(chunk.content, { applyStemming: true });
    const pathTokens = this.tokenize(chunk.relativePath, { applyStemming: true });
    const nameTokens = chunk.name ? this.tokenize(chunk.name, { applyStemming: true }) : [];

    let score = 0;

    // Calculate content density factor (normalize by chunk size)
    // Smaller chunks with same matches get higher density scores
    const densityFactor = Math.min(1.0, 200 / Math.max(contentTokens.length, 1));

    for (const qt of queryTokens) {
      // Boost multiplier for important terms (e.g., .execute)
      const isImportant = importantTerms.has(qt);
      const boostMultiplier = isImportant ? 5.0 : 1.0;

      // Content matches (with density normalization)
      const contentMatches = contentTokens.filter((t) =>
        t.includes(qt) || qt.includes(t)
      ).length;
      // Use log to reduce impact of many matches, add density factor
      const normalizedContentScore = contentMatches > 0
        ? (1 + Math.log(contentMatches)) * (1 + densityFactor)
        : 0;
      score += normalizedContentScore * CONTENT_WEIGHT * boostMultiplier;

      // Path bonus (file path contains query term) - no density needed
      const pathMatches = pathTokens.filter((t) => t.includes(qt) || qt.includes(t)).length;
      score += pathMatches * PATH_WEIGHT * boostMultiplier;

      // Name bonus (function/class name contains query term) - strongest signal
      const nameMatches = nameTokens.filter((t) => t.includes(qt) || qt.includes(t)).length;
      score += nameMatches * NAME_WEIGHT * boostMultiplier;

      // Exact match bonuses (using stemmed comparison)
      if (contentTokens.includes(qt)) {
        score += 2 * boostMultiplier;
      }
      if (pathTokens.includes(qt)) {
        score += 10 * boostMultiplier;  // Strong path match bonus
      }
      if (nameTokens.includes(qt)) {
        score += 20 * boostMultiplier;  // Very strong name match bonus
      }
    }

    // Bonus for chunks where ALL query tokens appear
    const allTokensPresent = queryTokens.every(qt =>
      contentTokens.some(t => t.includes(qt) || qt.includes(t)) ||
      pathTokens.some(t => t.includes(qt) || qt.includes(t)) ||
      nameTokens.some(t => t.includes(qt) || qt.includes(t))
    );
    if (allTokensPresent && queryTokens.length > 1) {
      score *= 1.5;  // 50% bonus for matching all terms
    }

    // Penalty for test files (less relevant for understanding implementation)
    if (chunk.relativePath.includes('.test.') || chunk.relativePath.includes('.spec.') ||
        chunk.relativePath.includes('__fixtures__') || chunk.relativePath.includes('__tests__')) {
      score *= 0.5;
    }

    // Penalty for codemod files (migration scripts, not implementation)
    if (chunk.relativePath.includes('/codemod/') || chunk.relativePath.includes('/codemods/')) {
      score *= 0.3;
    }

    // Small penalty for prepare/config files when query is about execution
    if (chunk.relativePath.includes('prepare') && !queryTokens.some(t => t.includes('prepar'))) {
      score *= 0.7;
    }

    return score;
  }

  async rank(chunks: Chunk[], query: string): Promise<ScoredChunk[]> {
    // Tokenize query with stopword filtering and stemming
    const queryTokens = this.tokenize(query, { filterStopwords: true, applyStemming: true });

    if (queryTokens.length === 0) {
      // No meaningful query tokens, return chunks with zero scores
      return chunks.map((chunk) => ({ ...chunk, score: 0 }));
    }

    // Extract important terms from query (e.g., .execute)
    const importantTerms = this.extractImportantTerms(query);

    // Score all chunks
    const scored = chunks.map((chunk) => ({
      ...chunk,
      score: this.score(chunk, queryTokens, importantTerms),
    }));

    // Sort by score descending
    scored.sort((a, b) => b.score - a.score);

    return scored;
  }
}

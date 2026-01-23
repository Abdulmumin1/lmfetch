/**
 * Hybrid ranker combining keyword, embedding, and importance scores
 */
import { generateText } from "ai";
import { google } from "@ai-sdk/google";
import { normalize, retry } from "../utils";
import { KeywordRanker } from "./keyword";
import { EmbeddingRanker } from "./embedding";
import type { Chunk, ScoredChunk } from "../chunkers/types";
import type { Ranker, RankerOptions } from "./types";

// Score weights
const KEYWORD_WEIGHT = 0.4;
const EMBEDDING_WEIGHT = 0.4;
const IMPORTANCE_WEIGHT = 0.2;

// Penalties
const MARKDOWN_PENALTY = 0.6; // 40% score reduction for markdown files

export class HybridRanker implements Ranker {
  private keywordRanker: KeywordRanker;
  private embeddingRanker: EmbeddingRanker;
  private importanceScores: Map<string, number>;
  private options: RankerOptions;

  constructor(
    importanceScores: Map<string, number> = new Map(),
    options: RankerOptions = {},
  ) {
    this.keywordRanker = new KeywordRanker();
    this.embeddingRanker = new EmbeddingRanker();
    this.importanceScores = importanceScores;
    this.options = options;
  }

  /**
   * Generate a hypothetical document for HyDE
   * (Hypothetical Document Embeddings)
   */
  private async generateHyDE(query: string): Promise<string> {
    try {
      const { text } = await retry(
        async () => {
          return await generateText({
            model: google("gemini-flash-latest"),
            prompt: `Write a short, hypothetical code snippet or documentation that would answer this question: "${query}"

Keep it concise (under 500 chars). Focus on realistic code that might exist in a codebase.`,
            maxTokens: 200,
          });
        },
        { retries: 2, delay: 500 },
      );

      return text;
    } catch {
      // Fall back to using the query directly
      return query;
    }
  }

  /**
   * Get importance score for a chunk
   */
  private getImportance(chunk: Chunk): number {
    // Get file importance
    let importance = this.importanceScores.get(chunk.filePath) ?? 0.5;

    // Apply markdown penalty
    if (chunk.language === "markdown" || chunk.language === "mdx") {
      importance *= MARKDOWN_PENALTY;
    }

    return importance;
  }

  async rank(chunks: Chunk[], query: string): Promise<ScoredChunk[]> {
    const progress = this.options.onProgress || (() => {});

    // Fast mode: only use keyword ranking
    if (this.options.fast) {
      progress("Ranking by keywords...");
      return this.keywordRanker.rank(chunks, query);
    }

    // Get keyword scores
    progress("Computing keyword scores...");
    const keywordScored = await this.keywordRanker.rank(chunks, query);
    const keywordScores = keywordScored.map((c) => c.score);

    // Generate HyDE document for better embedding match
    progress("Generating hypothetical answer...");
    const hydeDoc = await this.generateHyDE(query);

    // Get embedding scores using HyDE document
    progress("Computing semantic similarity...");
    const embeddingScored = await this.embeddingRanker.rank(chunks, hydeDoc);

    // Create lookup for embedding scores
    const embeddingScoreMap = new Map<string, number>();
    for (const scored of embeddingScored) {
      embeddingScoreMap.set(scored.id, scored.score);
    }

    // Normalize keyword scores to 0-1 range
    const normalizedKeyword = normalize(keywordScores);

    // Combine scores
    progress("Combining ranking signals...");
    const scored: ScoredChunk[] = chunks.map((chunk, i) => {
      const keywordScore = normalizedKeyword[i];
      const embeddingScore = embeddingScoreMap.get(chunk.id) ?? 0;
      const importanceScore = this.getImportance(chunk);

      const finalScore =
        keywordScore * KEYWORD_WEIGHT +
        embeddingScore * EMBEDDING_WEIGHT +
        importanceScore * IMPORTANCE_WEIGHT;

      return {
        ...chunk,
        score: finalScore,
      };
    });

    // Sort by final score descending
    scored.sort((a, b) => b.score - a.score);

    return scored;
  }
}

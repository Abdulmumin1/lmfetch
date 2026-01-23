/**
 * LLM-powered reranking (optional)
 */
import { generateText } from "ai";
import { google } from "@ai-sdk/google";
import { retry } from "../utils";
import type { ScoredChunk } from "../chunkers/types";

const RERANK_MODEL = "gemini-2.5-flash-lite";
const MAX_CHUNKS_TO_RERANK = 20;

/**
 * Use LLM to rerank chunks for better relevance
 */
export async function llmRerank(
  chunks: ScoredChunk[],
  query: string,
  onProgress?: (message: string) => void
): Promise<ScoredChunk[]> {
  const progress = onProgress || (() => {});

  // Only rerank top chunks
  const toRerank = chunks.slice(0, MAX_CHUNKS_TO_RERANK);
  const rest = chunks.slice(MAX_CHUNKS_TO_RERANK);

  progress("Running LLM reranking...");

  // Score each chunk with LLM
  const rerankedScores = await Promise.all(
    toRerank.map(async (chunk) => {
      const score = await scoreWithLLM(chunk, query);
      return { ...chunk, score };
    })
  );

  // Sort reranked chunks by new score
  rerankedScores.sort((a, b) => b.score - a.score);

  // Combine with rest (which keep their original relative order)
  return [...rerankedScores, ...rest];
}

/**
 * Score a single chunk using LLM
 */
async function scoreWithLLM(chunk: ScoredChunk, query: string): Promise<number> {
  try {
    const { text } = await retry(
      async () => {
        return await generateText({
          model: google(RERANK_MODEL),
          system: `You are a relevance scorer. Given a code snippet and a query, output ONLY a number from 0.0 to 1.0 indicating how relevant the code is to answering the query.

0.0 = completely irrelevant
0.5 = somewhat relevant
1.0 = highly relevant

Output ONLY the number, nothing else.`,
          prompt: `Query: ${query}

Code (${chunk.relativePath}):
\`\`\`${chunk.language}
${chunk.content.slice(0, 2000)}
\`\`\`

Relevance score:`,
          maxTokens: 10,
        });
      },
      { retries: 2, delay: 500 }
    );

    const score = parseFloat(text.trim());
    if (isNaN(score) || score < 0 || score > 1) {
      return chunk.score; // Keep original score if parsing fails
    }

    // Blend LLM score with original score
    return score * 0.7 + chunk.score * 0.3;
  } catch {
    return chunk.score; // Keep original score on error
  }
}

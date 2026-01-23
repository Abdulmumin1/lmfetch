/**
 * Examples of using lmfetch as a library
 */

import { query, fetchContext, ContextBuilder } from "lmfetch";

// Example 1: Quick query with LLM
async function quickQuery() {
  const answer = await query(".", "how does authentication work", {
    model: "gemini-2.0-flash",
    budget: "100k",
  });
  console.log(answer);
}

// Example 2: Fetch context only
async function contextOnly() {
  const context = await fetchContext(".", "database models", {
    budget: "50k",
    semantic: false,  // Use keyword-only ranking (default)
  });
  console.log(context);
}

// Example 3: Advanced usage with ContextBuilder
async function advancedUsage() {
  const builder = new ContextBuilder({
    path: ".",
    query: "API implementation",
    budget: "100k",
    fast: true,  // Keyword-only ranking
    onProgress: (msg) => console.log(msg),
  });

  const result = await builder.build();
  console.log(`Context: ${result.context}`);
  console.log(`Tokens: ${result.tokens}`);
  console.log(`Files processed: ${result.filesProcessed}`);
}

// Example 4: With semantic ranking
async function semanticRanking() {
  const answer = await query(".", "explain the architecture", {
    semantic: true,  // Enable semantic (embedding) ranking
    budget: "150k",
  });
  console.log(answer);
}

// Run examples
async function main() {
  console.log("Example 1: Quick query");
  await quickQuery();

  console.log("\nExample 2: Context only");
  await contextOnly();

  console.log("\nExample 3: Advanced usage");
  await advancedUsage();

  console.log("\nExample 4: Semantic ranking");
  await semanticRanking();
}

main().catch(console.error);

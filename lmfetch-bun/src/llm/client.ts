/**
 * Unified LLM client using AI SDK
 */
import { generateText, streamText } from "ai";
import { google } from "@ai-sdk/google";
import { openai } from "@ai-sdk/openai";
import { anthropic } from "@ai-sdk/anthropic";
import { retry } from "../utils";

export type Provider = "openai" | "anthropic" | "google";

export interface GenerateOptions {
  model: string;
  prompt: string;
  system?: string;
  maxTokens?: number;
}

export interface StreamOptions extends GenerateOptions {
  onChunk?: (chunk: string) => void;
}

/**
 * Detect provider from model name
 */
export function detectProvider(model: string): Provider {
  if (
    model.startsWith("gpt") ||
    model.startsWith("o1") ||
    model.startsWith("o3")
  ) {
    return "openai";
  }
  if (model.startsWith("claude")) {
    return "anthropic";
  }
  return "google"; // Default to Gemini
}

/**
 * Get the appropriate model instance
 */
function getModel(modelName: string) {
  const provider = detectProvider(modelName);

  switch (provider) {
    case "openai":
      return openai(modelName);
    case "anthropic":
      return anthropic(modelName);
    case "google":
      return google(modelName);
  }
}

/**
 * Generate text with any supported model
 */
export async function generate(options: GenerateOptions): Promise<string> {
  const { model: modelName, prompt, system, maxTokens } = options;
  const model = getModel(modelName);

  const result = await retry(
    async () => {
      return await generateText({
        model,
        prompt,
        system,
        maxTokens,
      });
    },
    { retries: 3, delay: 1000, backoff: 2 },
  );

  return result.text;
}

/**
 * Stream text generation
 */
export async function stream(options: StreamOptions): Promise<string> {
  const { model: modelName, prompt, system, maxTokens, onChunk } = options;
  const model = getModel(modelName);

  const result = streamText({
    model,
    prompt,
    system,
    maxTokens,
  });

  let fullText = "";

  for await (const chunk of result.textStream) {
    fullText += chunk;
    if (onChunk) {
      onChunk(chunk);
    }
  }

  return fullText;
}

/**
 * Query an LLM with context
 */
export async function queryWithContext(
  context: string,
  query: string,
  model: string = "gemini-flash-latest",
  onChunk?: (chunk: string) => void,
): Promise<string> {
  //   const system = `You are an expert code assistant. You have been given context from a codebase to help answer questions.

  // Guidelines:
  // - Be concise and direct
  // - Reference specific files and line numbers when relevant
  // - If the context doesn't contain enough information to answer, say so
  // - Format code examples with proper syntax highlighting`;

  //   const prompt = `## Context from Codebase

  // ${context}

  // ## Question

  // ${query}

  // ## Answer`;

  const system = `You are a code analysis assistant. Answer questions thoroughly using the provided context.

Guidelines:
- Include relevant code snippets to support your explanation
- Cite sources as \`file.py:L10\` or \` file.py:L10-20\`
- Show the actual implementation, not just describe it
- If explaining a flow, walk through the key code paths

If the context doesn't fully answer the question, say so.`;

  const prompt = `<context>
      ${context}
    </context>

    Question: ${query}

    Provide a detailed answer with code examples from the context`;

  if (onChunk) {
    return stream({ model, prompt, system, onChunk });
  }

  return generate({ model, prompt, system });
}

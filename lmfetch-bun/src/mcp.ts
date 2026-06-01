import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { buildContextWithSearch } from "./context-search";
import { findFiles, readCode, searchCode } from "./search";

function textResult(value: unknown) {
  const structuredContent = typeof value === "string"
    ? { text: value }
    : (value as { [x: string]: unknown });
  return {
    content: [
      {
        type: "text" as const,
        text: typeof value === "string" ? value : JSON.stringify(value, null, 2),
      },
    ],
    structuredContent,
  };
}

export function createMcpServer(): McpServer {
  const server = new McpServer({
    name: "lmfetch",
    version: "0.1.0",
  });

  server.registerTool(
    "search_code",
    {
      description: "Search code and return ranked file/line evidence before reading context.",
      inputSchema: {
        path: z.string().default(".").describe("Local directory path or GitHub URL"),
        query: z.string().min(1).describe("Text or regex query"),
        glob: z.string().optional().describe("Restrict search to matching paths"),
        fileType: z.string().optional().describe("Restrict search to a ripgrep file type"),
        maxFiles: z.number().int().positive().default(10),
        maxMatchesPerFile: z.number().int().positive().default(3),
        provider: z.enum(["auto", "fff", "ripgrep"]).default("auto"),
      },
    },
    async ({ path, query, glob, fileType, maxFiles, maxMatchesPerFile, provider }) => {
      const result = await searchCode(path, query, {
        pathGlob: glob,
        fileType,
        maxFiles,
        maxMatchesPerFile,
        provider,
      });
      return textResult(result);
    },
  );

  server.registerTool(
    "find_files",
    {
      description: "Fuzzy-find files by path or filename.",
      inputSchema: {
        path: z.string().default(".").describe("Local directory path or GitHub URL"),
        pattern: z.string().default("").describe("Case-insensitive filename/path pattern"),
        glob: z.string().optional().describe("Restrict search to matching paths"),
        fileType: z.string().optional().describe("Restrict search to a ripgrep file type"),
        maxResults: z.number().int().positive().default(50),
        provider: z.enum(["auto", "fff", "ripgrep"]).default("auto"),
      },
    },
    async ({ path, pattern, glob, fileType, maxResults, provider }) => {
      const result = await findFiles(path, pattern, {
        pathGlob: glob,
        fileType,
        maxResults,
        provider,
      });
      return textResult(result);
    },
  );

  server.registerTool(
    "read_code",
    {
      description: "Read an exact file or unique suffix with line numbers.",
      inputSchema: {
        path: z.string().default(".").describe("Local directory path or GitHub URL"),
        file: z.string().min(1).describe("Exact path or unique suffix"),
        startLine: z.number().int().positive().default(1),
        endLine: z.number().int().nonnegative().default(0),
        maxLines: z.number().int().positive().default(80),
      },
    },
    async ({ path, file, startLine, endLine, maxLines }) => {
      const result = await readCode(path, file, { startLine, endLine, maxLines });
      return textResult(result);
    },
  );

  server.registerTool(
    "fetch_context",
    {
      description: "Build a token-budgeted code context for a query using search-first retrieval.",
      inputSchema: {
        path: z.string().default(".").describe("Local directory path or GitHub URL"),
        query: z.string().min(1).describe("Natural language question or code query"),
        budget: z.union([z.string(), z.number()]).default("50k"),
        includes: z.array(z.string()).optional(),
        excludes: z.array(z.string()).optional(),
        forceLarge: z.boolean().default(false),
        searchMaxFiles: z.number().int().positive().default(12),
        searchContextLines: z.number().int().nonnegative().default(80),
        provider: z.enum(["auto", "fff", "ripgrep"]).default("auto"),
      },
    },
    async ({ path, query, budget, includes, excludes, forceLarge, searchMaxFiles, searchContextLines, provider }) => {
      const result = await buildContextWithSearch(path, query, {
        budget,
        includes,
        excludes,
        forceLarge,
        searchMaxFiles,
        searchContextLines,
        searchProvider: provider,
        fast: true,
      });
      return textResult({
        context: result.context,
        tokens: result.tokens,
        filesProcessed: result.filesProcessed,
        chunksCreated: result.chunksCreated,
      });
    },
  );

  return server;
}

export async function runMcpServer(): Promise<void> {
  const server = createMcpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("lmfetch MCP server running on stdio");
}

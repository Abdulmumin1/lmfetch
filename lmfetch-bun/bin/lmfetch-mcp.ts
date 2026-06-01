#!/usr/bin/env bun
/**
 * lmfetch MCP server entry point
 */
import { runMcpServer } from "../src/mcp";

runMcpServer().catch((error) => {
  console.error(error);
  process.exit(1);
});

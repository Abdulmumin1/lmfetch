/**
 * CLI interface for lmfetch
 */
import { Command } from "commander";
import chalk from "chalk";
import ora, { Ora } from "ora";
import cliProgress from "cli-progress";
import { marked } from "marked";
import { markedTerminal } from "marked-terminal";
import { ContextBuilder } from "./builder";
import { queryWithContext } from "./llm";
import { getCache } from "./cache";
import { isPiped } from "./utils";
import { parseBudget } from "./tokens";
import { version } from "../package.json";

// Configure marked with terminal renderer
marked.use(
  markedTerminal({
    // Default terminal theme
    code: chalk.yellow,
    blockquote: chalk.gray.italic,
    strong: chalk.bold.white,
    em: chalk.italic,
    codespan: chalk.cyan,
    del: chalk.dim.strikethrough,
    link: chalk.blue,
    href: chalk.blue.underline,
    table: chalk.white,
    // Customize other styling
    tab: 2,
    reflowText: true,
    width: 100,
  }) as any,
);

/**
 * Render markdown with terminal formatting (pink theme)
 */
function renderMarkdown(text: string): string {
  try {
    return marked(text) as string;
  } catch (error) {
    // Fallback to plain text if markdown parsing fails
    return text;
  }
}

const program = new Command();

program
  .name("lmfetch")
  .description("Lightning-fast code context fetcher for LLMs")
  .version(version)
  .argument("<path>", "Local directory path or GitHub URL")
  .argument("<query>", "Natural language query about the codebase")
  .option("-b, --budget <budget>", "Token budget (e.g., 50k, 100k, 1m)", "50k")
  .option("-o, --output <file>", "Write context to file instead of stdout")
  .option("-c, --context", "Output context only, skip LLM query")
  .option("-i, --include <patterns...>", "Include patterns (glob)")
  .option("-e, --exclude <patterns...>", "Exclude patterns (glob)")
  .option(
    "-m, --model <model>",
    "LLM model for answering",
    "gemini-flash-latest",
  )
  .option(
    "-s, --semantic",
    "Use semantic (embedding) ranking (slower but may be more accurate)",
  )
  .option("--clean-cache", "Clear the internal cache")
  .option("--force-large", "Process files larger than 1MB or 20k lines")
  .action(async (path, query, options) => {
    // Handle cache clearing
    if (options.cleanCache) {
      const cache = await getCache();
      cache.clear();
      console.log(chalk.green("✓ Cache cleared"));
      return;
    }

    const isInteractive = !isPiped();

    // Parse budget for display
    const budgetTokens = parseBudget(options.budget);

    // Display query info
    if (isInteractive) {
      console.log();
      console.log(chalk.dim("Query   ") + query);
    }

    let totalFiles = 0;
    let progressBar: cliProgress.SingleBar | null = null;
    let currentSpinner: Ora | null = null;

    const progress = (message: string) => {
      // Parse progress messages
      if (message.includes("Discovering files")) {
        // Show spinner during discovery
        if (isInteractive) {
          currentSpinner = ora({
            text: "Discovering files...",
            spinner: "star",
            color: "yellow",
            interval: 150,
          }).start();
        }
      } else if (message.includes("Found") && message.includes("files")) {
        // Stop discovery spinner
        if (currentSpinner) {
          currentSpinner.stop();
          currentSpinner = null;
        }

        // Parse file count and start progress bar
        const match = message.match(/Found (\d+) files/);
        if (match) {
          totalFiles = parseInt(match[1]);
          if (isInteractive && totalFiles > 0) {
            progressBar = new cliProgress.SingleBar(
              {
                format:
                  chalk.dim("Files   ") +
                  "{value}/{total} " +
                  chalk.yellow("[{bar}]") +
                  " {percentage}%",
                barCompleteChar: "█",
                barIncompleteChar: "░",
                hideCursor: true,
              },
              cliProgress.Presets.legacy,
            );
            progressBar.start(totalFiles, 0);
          }
        }
      } else if (message.includes("Analyzing")) {
        // Show spinner during analysis
        progressBar?.update(Math.floor(totalFiles * 0.1));
        if (isInteractive && !currentSpinner) {
          currentSpinner = ora({
            text: "Analyzing dependencies...",
            spinner: "star",
            color: "yellow",
            interval: 150,
          }).start();
        }
      } else if (message.includes("Chunking")) {
        // Stop previous spinner, show chunking spinner
        if (currentSpinner) {
          currentSpinner.stop();
          currentSpinner = null;
        }
        progressBar?.update(Math.floor(totalFiles * 0.3));
        if (isInteractive) {
          currentSpinner = ora({
            text: "Chunking files...",
            spinner: "star",
            color: "yellow",
            interval: 150,
          }).start();
        }
      } else if (message.includes("Created") && message.includes("chunks")) {
        // Stop chunking spinner
        if (currentSpinner) {
          currentSpinner.stop();
          currentSpinner = null;
        }
        progressBar?.update(Math.floor(totalFiles * 0.6));
      } else if (message.includes("Ranking")) {
        // Show ranking spinner
        if (isInteractive && !currentSpinner) {
          currentSpinner = ora({
            text: "Ranking chunks...",
            spinner: "star",
            color: "yellow",
            interval: 150,
          }).start();
        }
      } else if (
        message.includes("Computing keyword") ||
        message.includes("semantic") ||
        message.includes("Combining")
      ) {
        // Update ranking spinner text
        if (currentSpinner) {
          if (message.includes("keyword")) {
            currentSpinner.text = "Computing keyword scores...";
          } else if (message.includes("semantic")) {
            currentSpinner.text = "Computing semantic similarity...";
          } else if (message.includes("Combining")) {
            currentSpinner.text = "Combining ranking signals...";
          }
        }
      } else if (message.includes("Selecting")) {
        // Stop ranking spinner
        if (currentSpinner) {
          currentSpinner.stop();
          currentSpinner = null;
        }
        progressBar?.update(Math.floor(totalFiles * 0.95));
      }

      // Don't show other progress in interactive mode when we have progress bar
      if (!isInteractive) {
        console.log(message);
      }
    };

    try {
      // Build context
      const builder = new ContextBuilder({
        path,
        query,
        budget: options.budget,
        includes: options.include,
        excludes: options.exclude,
        fast: !options.semantic, // Default to fast (keyword-only), use embeddings only with -s
        forceLarge: options.forceLarge,
        onProgress: progress,
      });

      const result = await builder.build();

      // Clean up any remaining spinners/progress
      (currentSpinner as Ora | null)?.stop();
      if (progressBar) {
        (progressBar as cliProgress.SingleBar).update(result.filesProcessed);
        (progressBar as cliProgress.SingleBar).stop();
      }

      // Show token usage
      if (isInteractive) {
        const percentage = Math.round((result.tokens / budgetTokens) * 100);
        const barWidth = 20;
        const filled = Math.round((percentage / 100) * barWidth);
        const bar = "█".repeat(filled) + "░".repeat(barWidth - filled);

        console.log(
          chalk.dim("Tokens  ") +
            result.tokens.toLocaleString() +
            " " +
            chalk.yellow(`[${bar}]`) +
            " " +
            percentage +
            "%",
        );
        console.log();
      }

      // Output context to file if specified
      if (options.output) {
        await Bun.write(options.output, result.context);
        console.log(chalk.green(`✓ Context written to ${options.output}`));
        return;
      }

      // Context only mode
      if (options.context) {
        console.log(result.context);
        return;
      }

      // Show model being used
      if (isInteractive) {
        console.log(chalk.yellow(options.model));
        console.log();
      }

      // Query LLM with context - show spinner while waiting
      const spinner = isInteractive
        ? ora({
            text: "Generating answer...",
            spinner: "star",
            color: "yellow",
            interval: 200,
          }).start()
        : null;

      const answer = await queryWithContext(
        result.context,
        query,
        options.model,
      );

      if (spinner) {
        spinner.stop();
      }

      // Output answer with markdown rendering
      if (isInteractive) {
        console.log(renderMarkdown(answer));
      } else {
        console.log(answer);
      }
      console.log();
    } catch (err) {
      (currentSpinner as Ora | null)?.stop();
      (progressBar as cliProgress.SingleBar | null)?.stop();
      console.error(chalk.red(`Error: ${(err as Error).message}`));
      process.exit(1);
    }
  });

// Handle --clean-cache without path/query
program.hook("preAction", async (thisCommand) => {
  const opts = thisCommand.opts();
  if (opts.cleanCache) {
    const cache = await getCache();
    cache.clear();
    console.log(chalk.green("✓ Cache cleared"));
    process.exit(0);
  }
});

export function run() {
  program.parse();
}

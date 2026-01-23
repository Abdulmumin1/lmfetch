#!/usr/bin/env bun

// Demo script to show markdown rendering
import chalk from "chalk";
import { highlight } from "cli-highlight";

const sampleMarkdown = `# Beautiful Markdown Rendering

This is how **lmfetch** now renders markdown in the terminal!

## Features

- Syntax-highlighted code blocks with borders
- Colored headings at different levels
- Beautiful list formatting
- Inline \`code\` styling

### Code Example

\`\`\`typescript
function greet(name: string): string {
  // This is a comment
  const message = \`Hello, \${name}!\`;
  return message;
}

const result = greet("World");
console.log(result);
\`\`\`

### Lists

1. First item with **bold text**
2. Second item with *italic text*
3. Third item with \`inline code\`

Pretty cool, right?
`;

function renderMarkdown(text: string): string {
  const lines = text.split("\n");
  const output: string[] = [];
  let inCodeBlock = false;
  let codeLanguage = "";
  let codeLines: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (line.startsWith("```")) {
      if (inCodeBlock) {
        const code = codeLines.join("\n");
        try {
          const highlighted = highlight(code, {
            language: codeLanguage || "typescript",
            theme: {
              keyword: chalk.cyan,
              built_in: chalk.cyan,
              string: chalk.green,
              number: chalk.yellow,
              literal: chalk.yellow,
              comment: chalk.gray,
              function: chalk.blue,
              class: chalk.blue,
              title: chalk.blue,
              params: chalk.reset,
              tag: chalk.magenta,
              attr: chalk.cyan,
            },
          });
          output.push(chalk.dim("┌" + "─".repeat(78) + "┐"));
          highlighted.split("\n").forEach((line) => {
            output.push(chalk.dim("│ ") + line);
          });
          output.push(chalk.dim("└" + "─".repeat(78) + "┘"));
        } catch {
          output.push(chalk.dim("┌" + "─".repeat(78) + "┐"));
          codeLines.forEach((line) => {
            output.push(chalk.dim("│ ") + chalk.cyan(line));
          });
          output.push(chalk.dim("└" + "─".repeat(78) + "┘"));
        }
        codeLines = [];
        inCodeBlock = false;
      } else {
        codeLanguage = line.slice(3).trim();
        inCodeBlock = true;
      }
      continue;
    }

    if (inCodeBlock) {
      codeLines.push(line);
      continue;
    }

    if (line.startsWith("####")) {
      output.push("\n" + chalk.bold.cyan(line.slice(5).trim()));
    } else if (line.startsWith("###")) {
      output.push("\n" + chalk.bold.green(line.slice(4).trim()));
    } else if (line.startsWith("##")) {
      output.push("\n" + chalk.bold.yellow(line.slice(3).trim()));
    } else if (line.startsWith("#")) {
      output.push("\n" + chalk.bold.magenta(line.slice(2).trim()));
    } else if (line.match(/^[\s]*[-*+]\s/)) {
      const indent = line.match(/^[\s]*/)?.[0] || "";
      const content = line.replace(/^[\s]*[-*+]\s/, "");
      output.push(indent + chalk.cyan("●") + " " + formatInline(content));
    } else if (line.match(/^[\s]*\d+\.\s/)) {
      const match = line.match(/^([\s]*)(\d+)\.\s(.*)$/);
      if (match) {
        const [, indent, num, content] = match;
        output.push(indent + chalk.cyan(num + ".") + " " + formatInline(content));
      } else {
        output.push(formatInline(line));
      }
    } else if (line.trim() === "") {
      output.push("");
    } else {
      output.push(formatInline(line));
    }
  }

  return output.join("\n");
}

function formatInline(text: string): string {
  let result = text;
  result = result.replace(/`([^`]+)`/g, (_, code) => chalk.cyan(code));
  result = result.replace(/\*\*([^*]+)\*\*/g, (_, text) => chalk.bold(text));
  result = result.replace(/\*([^*]+)\*/g, (_, text) => chalk.italic(text));
  result = result.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, text) =>
    chalk.blue.underline(text)
  );
  return result;
}

console.log(renderMarkdown(sampleMarkdown));

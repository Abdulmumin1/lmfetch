"""CLI for lmfetch."""

import asyncio
import re
import sys

import click
from rich.console import Console
from rich.syntax import Syntax
from rich.text import Text
from rich.spinner import Spinner
from rich.live import Live
from rich.panel import Panel
from rich.table import Table

from rich.panel import Panel
from rich.table import Table

console = Console()
err_console = Console(stderr=True)


def run_async(coro):
    return asyncio.get_event_loop().run_until_complete(coro)


def is_piped():
    return not sys.stdout.isatty()


def render_markdown(text: str) -> None:
    """Render markdown with syntax-highlighted code and tables."""
    lines = text.split("\n")
    i = 0
    while i < len(lines):
        line = lines[i]

        # Code blocks
        if line.startswith("```"):
            lang = line[3:].strip() or "text"
            code_lines = []
            i += 1
            while i < len(lines) and not lines[i].startswith("```"):
                code_lines.append(lines[i])
                i += 1
            code = "\n".join(code_lines)
            syntax = Syntax(code, lang, theme="monokai", background_color="default")
            console.print(syntax)
            i += 1
            continue

        # Tables
        if line.strip().startswith("|") and i + 1 < len(lines) and lines[i + 1].strip().startswith("|"):
            table_lines = []
            while i < len(lines) and line.strip().startswith("|"):
                table_lines.append(line)
                i += 1
                if i < len(lines):
                    line = lines[i]
            
            if len(table_lines) >= 2:
                # Parse table
                try:
                    # Parse header
                    header_cells = [c.strip() for c in table_lines[0].strip().strip("|").split("|")]
                    
                    # Parse rows (skip separator at index 1)
                    rows = []
                    for row_line in table_lines[2:]:
                        row_cells = [c.strip() for c in row_line.strip().strip("|").split("|")]
                        if len(row_cells) == len(header_cells):
                            rows.append(row_cells)
                    
                    # Render with Rich
                    table = Table(show_header=True, header_style="bold magenta", border_style="dim", box=None)
                    for h in header_cells:
                        table.add_column(h)
                    
                    for r in rows:
                        table.add_row(*r)
                    
                    console.print(table)
                    console.print() # spacing
                    continue
                except Exception:
                    # Fallback if parsing fails, print raw lines
                    for tl in table_lines:
                        console.print(tl)
                    continue
            else:
                 # Not a valid table structure (too short), fallback
                 for tl in table_lines:
                     console.print(tl)
                 continue

        if line.startswith("######"):
            console.print(Text(line[6:].strip(), style="bold"))
        elif line.startswith("#####"):
            console.print(Text(line[5:].strip(), style="bold"))
        elif line.startswith("####"):
            console.print(Text(line[4:].strip(), style="bold"))
        elif line.startswith("###"):
            console.print(Text(line[3:].strip(), style="bold cyan"))
        elif line.startswith("##"):
            console.print(Text(line[2:].strip(), style="bold cyan"))
        elif line.startswith("#"):
            console.print(Text(line[1:].strip(), style="bold magenta"))
        else:
            formatted = line
            formatted = re.sub(r'\*\*(.+?)\*\*', r'[bold]\1[/bold]', formatted)
            formatted = re.sub(r'__(.+?)__', r'[bold]\1[/bold]', formatted)
            formatted = re.sub(r'\*(.+?)\*', r'[italic]\1[/italic]', formatted)
            formatted = re.sub(r'_(.+?)_', r'[italic]\1[/italic]', formatted)
            formatted = re.sub(r'`([^`]+)`', r'[cyan]\1[/cyan]', formatted)
            console.print(formatted)

        i += 1


def print_stats(result, query: str) -> None:
    """Print a clean stats summary."""
    table = Table.grid(padding=(0, 2))
    table.add_column(style="dim")
    table.add_column()

    files_str = f"{result.files_included}/{result.files_scanned}"
    if result.related_files_added > 0:
        files_str += f" [dim](+{result.related_files_added} imports)[/dim]"

    tokens_pct = int(result.total_tokens / result.budget * 100)
    tokens_bar = "█" * (tokens_pct // 10) + "░" * (10 - tokens_pct // 10)

    table.add_row("Query", f"[bold]{query}[/bold]")
    table.add_row("Files", files_str)
    table.add_row("Tokens", f"{result.total_tokens:,} [dim]{tokens_bar}[/dim] {tokens_pct}%")

    console.print()
    console.print(table)
    console.print()


@click.command()
@click.version_option(package_name="lmfetch")
@click.argument("path", required=False)
@click.argument("query", required=False)
@click.option("-b", "--budget", default="50k", help="Token budget (50k, 100k, 1m)")
@click.option("-o", "--output", type=click.Path(), help="Write context to file")
@click.option("-c", "--context", is_flag=True, help="Output context only, skip LLM")
@click.option("-i", "--include", multiple=True, help="Include patterns (*.py)")
@click.option("-e", "--exclude", multiple=True, help="Exclude patterns (tests/*)")
@click.option("-m", "--model", default="gemini-3-flash-preview", help="Model to use")
@click.option("-f", "--fast", is_flag=True, help="Skip smart reranking")
@click.option("--clean-cache", is_flag=True, help="Clear the internal cache")
@click.option("--force-large", is_flag=True, help="Process large files (>1MB or >20k lines)")
def cli(path, query, budget, output, context, include, exclude, model, fast, clean_cache, force_large):
    """Build smart context from codebases for LLM queries.

    \b
    Examples:
      lmfetch . "how does auth work"
      lmfetch ./src "explain the API" -b 100k
      lmfetch github.com/owner/repo "architecture overview"
      lmfetch . "database models" -c > context.md
    """
    try:
        if clean_cache:
            from .cache import SQLiteCache
            cache = SQLiteCache()
            cache.clear()
            console.print("[green]✓[/green] Cache cleared")
            return

        # Check if path/query are missing (required unless clean-cache is used)
        if not path or not query:
            ctx = click.get_current_context()
            click.echo(ctx.get_help())
            return
        
        piped = is_piped()
        
        from .builder import ContextBuilder
        from .tokens import parse_token_budget

        budget_tokens = parse_token_budget(budget)

        builder = ContextBuilder(
            budget=budget_tokens,
            follow_imports=True,
            use_smart_rerank=not fast,
        )

        if not piped:
            spinner = Spinner("dots2", text="[dim]Initializing...[/dim]", style="cyan")
            with Live(spinner, console=console, transient=True, refresh_per_second=10):
                def on_progress(msg: str):
                    spinner.update(text=f"[bold cyan]{msg}[/bold cyan]")
                
                result = run_async(builder.build(
                    path=path,
                    query=query,
                    include=list(include) if include else None,
                    exclude=list(exclude) if exclude else None,
                    on_progress=on_progress,
                    force_large=force_large,
                ))
        else:
            result = run_async(builder.build(
                path=path,
                query=query,
                include=list(include) if include else None,
                exclude=list(exclude) if exclude else None,
                force_large=force_large,
            ))

        context_text = result.to_text(format="markdown")

        if output:
            with open(output, "w") as f:
                f.write(context_text)
            if not piped:
                print_stats(result, query)
                console.print(f"[green]✓[/green] Saved to [bold]{output}[/bold]")
            return

        if piped:
            print(context_text)
            return

        if context:
            print_stats(result, query)
            console.print("[dim]─" * 40 + "[/dim]\n")
            print(context_text)
            return

        print_stats(result, query)

        with Live(Spinner("dots2", text="[bold cyan]Thinking...[/bold cyan]", style="cyan"), console=console, transient=True):
            answer = run_async(_query_llm(context_text, query, model))

        console.print(Panel.fit(
            f"[dim]{model}[/dim]",
            border_style="dim",
            padding=(0, 1),
        ))
        console.print()
        render_markdown(answer)
        console.print()

    except KeyboardInterrupt:
        console.print("\n[dim]Cancelled[/dim]")
        sys.exit(130)
    except Exception as e:
        err_console.print(f"[red]Error:[/red] {e}")
        sys.exit(1)


async def _query_llm(context: str, query: str, model_name: str) -> str:
    from ai_query import generate_text, google, openai, anthropic

    if model_name.startswith("gpt"):
        model = openai(model_name)
    elif model_name.startswith("claude"):
        model = anthropic(model_name)
    else:
        model = google(model_name)

    system = """You are a code analysis assistant. Answer questions thoroughly using the provided context.

Guidelines:
- Include relevant code snippets to support your explanation
- Cite sources as `file.py:L10` or `file.py:L10-20`
- Show the actual implementation, not just describe it
- If explaining a flow, walk through the key code paths

If the context doesn't fully answer the question, say so."""

    prompt = f"""<context>
{context}
</context>

Question: {query}

Provide a detailed answer with code examples from the context."""

    result = await generate_text(model=model, system=system, prompt=prompt)
    return result.text



if __name__ == "__main__":
    cli()

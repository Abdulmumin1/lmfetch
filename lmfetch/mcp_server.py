from fastmcp import FastMCP
from lmfetch.builder import ContextBuilder
from lmfetch.tokens import parse_token_budget

# Initialize FastMCP server
mcp = FastMCP("lmfetch")

@mcp.tool()
async def fetch_context(
    query: str,
    path: str = ".",
    budget: str = "50k",
    include: list[str] | None = None,
    exclude: list[str] | None = None,
    force_large: bool = False,
) -> str:
    """
    Scan a codebase and return relevant context for a query.
    
    Args:
        query: The question or query to answer using the codebase.
        path: Path to the codebase (local path or GitHub URL). Defaults to current directory.
        budget: Token budget for the context (e.g. "50k", "100k"). Defaults to "50k".
        include: List of glob patterns to include (e.g. ["*.py"]).
        exclude: List of glob patterns to exclude (e.g. ["tests/*"]).
        force_large: Allow processing files larger than 1MB or 20k lines.
    """
    # Parse budget string to int
    budget_tokens = parse_token_budget(budget)
    
    # Initialize builder
    builder = ContextBuilder(
        budget=budget_tokens,
        follow_imports=True,
        # For MCP, we default to smart rerank unless budget is very small? 
        # Actually CLI defaults to smart rerank unless --fast is passed.
        # Let's align with CLI default (use_smart_rerank=True).
        use_smart_rerank=True,
    )
    
    # Build context
    result = await builder.build(
        path=path,
        query=query,
        include=include,
        exclude=exclude,
        force_large=force_large,
    )
    
    # Return as markdown
    return result.to_text()

@mcp.custom_route("/health", methods=["GET"])
async def health_check(request):
    from starlette.responses import JSONResponse
    return JSONResponse({"status": "healthy", "service": "lmfetch-mcp"})



def main():
    import os
    
    port = os.environ.get("PORT")
    
    if port:
        mcp.run(transport="http", host="0.0.0.0", port=int(port))
    else:
        mcp.run()

if __name__ == "__main__":
    main()
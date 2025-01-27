from fastapi import FastAPI, HTTPException
import httpx
from selectolax.parser import HTMLParser
from urllib.parse import urljoin, urlparse
import html2text
import asyncio
from contextlib import asynccontextmanager
from typing import Dict, Set, List
from functools import lru_cache
import time
from anyio import Semaphore
from typing import Dict, List, Set
from fastapi.responses import PlainTextResponse
from fastapi.middleware.cors import CORSMiddleware
import re
from markdownify import markdownify as md

# Global settings for performance tuning
MAX_CONCURRENT_REQUESTS = 100  # Adjust based on target server capacity
REQUEST_TIMEOUT = 10.0
CACHE_TTL = 300  # 5 minutes
USER_AGENT = "Mozilla/5.0 (compatible; AIFetch-Crawler/1.0)"

#No Longer Using HTML2Text - getting a reliable result from markdownify
# Configure HTML-to-Markdown converter
# h = html2text.HTML2Text()
# h.ignore_links = False
# h.ignore_images = True
# h.body_width = 0
# h.ignore_tables = True
# h.bypass_tables = True
# h.ignore_emphasis = False
# h.single_line_break = True
# h.decode_errors = 'ignore'

def sanitize_html(html: str) -> str:
    """Remove unnecessary elements and clean HTML"""
    try:
        tree = HTMLParser(html)
        
        # Remove unwanted tags
        for selector in [
            'svg', 'script', 'style', 'nav', 
            'footer', 'header', 'form', 'iframe',
            'noscript', 'meta', 'link', 'button'
        ]:
            for node in tree.css(selector):
                node.decompose()
        
        # Remove inline attributes using del
        for node in tree.css('[style], [class], [id]'):
            for attr in ['style', 'class', 'id']:
                if attr in node.attrs:
                    del node.attrs[attr]
        
        # Extract main content if available
        main_content = tree.css_first('article, main, .content, .main')
        clean_html = main_content.html if main_content else tree.body.html
        
        # Remove empty elements
        return re.sub(r'<(\w+)[^>]*>\s*</\1>', '', clean_html)
    
    except Exception as e:
        print(f"HTML sanitization error: {str(e)}")
        return html

def clean_markdown(md: str) -> str:
    """Post-process markdown content"""
    # Remove residual HTML tags
    md = re.sub(r'<[^>]+>', '', md)
    
    # Clean excessive whitespace
    md = re.sub(r'\n{3,}', '\n\n', md)
    md = re.sub(r' {2,}', ' ', md)
    
    # Remove special characters
    md = re.sub(r'[\x00-\x1F\x7F-\x9F]', '', md)
    
    return md.strip()

def safe_html_to_markdown(html: str) -> str:
    """Convert sanitized HTML to clean markdown"""
    try:
        cleaned_html = sanitize_html(html)
        # print(cleaned_html)
        markdown = md(cleaned_html)
        return clean_markdown(markdown)
    except Exception as e:
        print(f"Markdown conversion error: {str(e)}")
        return "Could not convert content to Markdown"

@asynccontextmanager
async def lifespan(app: FastAPI):
    app.state.client = httpx.AsyncClient(
        http2=True,
        timeout=REQUEST_TIMEOUT,
        limits=httpx.Limits(max_connections=MAX_CONCURRENT_REQUESTS),
        headers={"User-Agent": USER_AGENT}
    )
    app.state.semaphore = Semaphore(MAX_CONCURRENT_REQUESTS)
    yield
    await app.state.client.aclose()

app = FastAPI(lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=['*'],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@lru_cache(maxsize=1024)
def parse_url(url: str) -> tuple:
    """Cached URL parsing for frequent operations"""
    parsed = urlparse(url)
    return (parsed.scheme, parsed.netloc, parsed.path)

async def fetch_url(client: httpx.AsyncClient, url: str) -> str:
    """Optimized URL fetcher with retry logic"""
    async with app.state.semaphore:
        for attempt in range(3):
            try:
                response = await client.get(url)
                response.raise_for_status()
                return response.text
            except (httpx.HTTPError, httpx.TimeoutException) as e:
                if attempt == 2 or isinstance(e, httpx.HTTPStatusError) and e.response.status_code < 500:
                    return ""
                await asyncio.sleep(2 ** attempt)
    return ""

def extract_links(html: str, base_url: str) -> Set[str]:
    """High-performance link extraction using selectolax"""
    tree = HTMLParser(html)
    links = set()
    base_scheme, base_netloc, _ = parse_url(base_url)
    
    for node in tree.css('a[href]'):
        href = node.attrs.get('href', '')
        full_url = urljoin(base_url, href)
        scheme, netloc, path = parse_url(full_url)
        
        if netloc == base_netloc and scheme in ('http', 'https'):
            links.add(f"{scheme}://{netloc}{path}")
    
    return links

async def process_page(client: httpx.AsyncClient, url: str) -> tuple:
    """Enhanced page processing with robust cleaning"""
    try:
        html = await fetch_url(client, url)
        if not html:
            return url, None, set()
        
        loop = asyncio.get_running_loop()
        
        # Process content in parallel
        markdown_content = await loop.run_in_executor(
            None, 
            safe_html_to_markdown, 
            html
        )
        
        links = await loop.run_in_executor(
            None, 
            extract_links, 
            html, 
            url
        )
        
        return url, markdown_content, links
    
    except Exception as e:
        print(f"Error processing {url}: {str(e)}")
        return url, None, set()


async def crawl_site(client: httpx.AsyncClient, start_url: str, max_depth: int) -> Dict:
    """Optimized BFS crawler with depth control"""
    visited = set()
    queue = [(start_url, 0)]
    results = {}
    
    while queue and len(visited) < 120:
        batch = []
        current_depth = queue[0][1]
        
        # Process pages in batches at the same depth
        while queue and queue[0][1] == current_depth:
            batch.append(queue.pop(0))
        
        # Parallel processing of batch
        tasks = [process_page(client, url) for url, depth in batch]
        pages = await asyncio.gather(*tasks)
        
        for url, content, links in pages:
            if url in visited:
                continue
                
            visited.add(url)
            results[url] = content
            
            # Queue next level links
            if current_depth < max_depth:
                for link in links:
                    if link not in visited:
                        queue.append((link, current_depth + 1))
    
    return results

def build_url_tree(urls: Set[str], base_url: str) -> str:
    """Build a file-system-like tree structure from URLs"""
    parsed_base = urlparse(base_url)
    base_domain = parsed_base.netloc
    scheme = parsed_base.scheme
    
    tree = {}
    urls = sorted(urls)

    for url in urls:
        parsed = urlparse(url)
        if parsed.netloc != base_domain:
            continue
            
        path = parsed.path.strip('/')
        parts = path.split('/') if path else []
        
        current_level = tree
        for part in parts:
            if part not in current_level:
                current_level[part] = {}
            current_level = current_level[part]

    output = []
    
    def print_tree(node: Dict, indent: int = 0, is_last: bool = True, prefix: str = ''):
        keys = list(node.keys())
        for i, key in enumerate(keys):
            is_last_child = i == len(keys) - 1
            full_path = '/'.join(prefix.split('/') + [key])
            absolute_url = f"{scheme}://{base_domain}/{full_path}"
            
            # Directory line
            pointer = "└── " if is_last_child else "├── "
            output.append(f"{'    ' * indent}{pointer}{key}/")
            
            # File line (show absolute URL)
            if not node[key]:  # Leaf node
                file_pointer = "    " * (indent + 1) + "└── "
                output.append(f"{file_pointer}({absolute_url})")
            
            # Recursive call for children
            new_prefix = f"{prefix}/{key}" if prefix else key
            print_tree(
                node[key], 
                indent + 1, 
                is_last_child,
                new_prefix
            )

    output.append(f"{parsed_base.netloc}/")
    print_tree(tree)
    return '\n'.join(output)

@app.get("/gx/", response_class=PlainTextResponse)
async def generate_sitemap(url: str, max_depth: int = 3):
    start_time = time.monotonic()
    
    # Validate URL
    parsed = urlparse(url)
    if not parsed.scheme or not parsed.netloc:
        raise HTTPException(400, "Invalid URL format")
    
    # Crawl website
    client = app.state.client
    results = await crawl_site(client, url, max_depth)
    
    # Build outputs
    valid_urls = [url for url, content in results.items() if content]
    tree_output = build_url_tree(valid_urls, url)
    
    # Generate content sections
    content_output = ["\n---"]
    for url, content in results.items():
        if content:
            content_output.append(f"\n--({url})--\n{content}\n---pageEnd")
    
    # Performance metrics
    duration = time.monotonic() - start_time
    content_output.append(f"\nGenerated in {duration:.2f}s - {len(valid_urls)} pages")
    
    return tree_output + "\n".join(content_output)

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(
        app,
        host="0.0.0.0",
        port=8000,
        loop="uvloop",
        http="httptools",
        timeout_keep_alive=30
    )
    
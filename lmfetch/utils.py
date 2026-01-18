import asyncio
import functools
import random
import logging

logger = logging.getLogger(__name__)

def retry(retries: int = 3, delay: float = 1.0, backoff: float = 2.0, exceptions: tuple = (Exception,)):
    """Retry an async function with exponential backoff."""
    def decorator(func):
        @functools.wraps(func)
        async def wrapper(*args, **kwargs):
            current_delay = delay
            last_exception = None
            
            for attempt in range(retries + 1):
                try:
                    return await func(*args, **kwargs)
                except exceptions as e:
                    last_exception = e
                    if attempt == retries:
                        break
                    
                    wait_time = current_delay * (1 + random.random() * 0.1) # Add jitter
                    logger.warning(f"Retrying {func.__name__} in {wait_time:.2f}s due to {e}")
                    await asyncio.sleep(wait_time)
                    current_delay *= backoff
            
            raise last_exception
        return wrapper
    return decorator

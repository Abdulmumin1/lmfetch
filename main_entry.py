import multiprocessing
import sys
from lmfetch.cli import cli

if __name__ == "__main__":
    # Needed for PyInstaller/Nuitka onefile multiprocessing support
    multiprocessing.freeze_support()
    cli()

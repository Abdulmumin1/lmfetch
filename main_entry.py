import multiprocessing
import sys
import os
import certifi
from lmfetch.cli import cli

if __name__ == "__main__":
    # Needed for PyInstaller/Nuitka onefile multiprocessing support
    multiprocessing.freeze_support()
    
    # Fix SSL errors in frozen app by pointing to the bundled certs
    os.environ["SSL_CERT_FILE"] = certifi.where()
    
    cli()

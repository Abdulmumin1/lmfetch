import os
from setuptools import setup, Extension

# Only compile if explicitly requested or if we are building a wheel
if os.environ.get("LMFETCH_COMPILE") == "1":
    try:
        from Cython.Build import cythonize
        
        # Cythonize the Python modules directly
        extensions = cythonize(
            [
                "lmfetch/chunkers/code.py",
                # "lmfetch/rankers/hybrid.py", 
                # "lmfetch/rankers/keyword.py",
            ],
            compiler_directives={'language_level': "3"}
        )
    except ImportError:
        # Fallback if Cython is not installed
        extensions = []
else:
    extensions = []

setup(
    name="lmfetch",
    packages=["lmfetch"],
    ext_modules=extensions,
)

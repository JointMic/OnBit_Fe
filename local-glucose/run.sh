#!/bin/sh
set -eu
cd "$(dirname "$0")"
exec uv run --python 3.12 --with 'torch>=2.10,<3' --with 'numpy>=2,<3' --with 'scipy>=1.13,<2' python server.py "$@"

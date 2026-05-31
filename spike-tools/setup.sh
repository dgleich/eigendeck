#!/usr/bin/env bash
# Reproduce the notebook-spike test environment.
#
# Run from /work/spike-tools:
#     ./setup.sh
# Then:
#     source .venv/bin/activate
#     python test_protocol.py        # python WS client → real jupyter server
#     python test_playwright.py      # drives external-kernel.html in Chromium + WebKit
#     python test_lite.py            # loads JupyterLite headlessly
#     python test_lite_numpy.py      # JupyterLite + numpy + matplotlib
#
# Tests assume a jupyter server is running on 127.0.0.1:8888 (only the
# external-kernel tests). Start one with:
#     jupyter server --no-browser --port=8888 \
#       --ServerApp.ip=127.0.0.1 \
#       --IdentityProvider.token='spike-token' \
#       --ServerApp.allow_origin='*' \
#       --ServerApp.disable_check_xsrf=True

set -euo pipefail
cd "$(dirname "$0")"

uv venv --python 3.11
# shellcheck disable=SC1091
source .venv/bin/activate

uv pip install \
    jupyter-server jupyter-client ipykernel \
    numpy matplotlib \
    jupyterlite-core jupyterlite-pyodide-kernel \
    websockets requests playwright

python -m ipykernel install --user --name spike-py3 --display-name "Python 3 (spike)"

playwright install chromium webkit

# Build the JupyterLite dist into the spike's public dir (gitignored).
mkdir -p lite-build
( cd lite-build && jupyter lite build --output-dir /work/public/notebook-spike/lite )

# Strip sourcemaps — sourcemaps account for ~44 MB / 65 MB of the dist
# and aren't needed for the spike (or for shipping).
find /work/public/notebook-spike/lite -name "*.map" -type f -delete

echo
echo "Setup complete. Dist size:"
du -sh /work/public/notebook-spike/lite
echo
echo "Next: source .venv/bin/activate && python test_playwright.py"

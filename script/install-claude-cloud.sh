#!/usr/bin/env bash
# Install the native development stack in a Claude cloud (claude.ai/code) session.
# Run as root (the Claude cloud default). It builds a conda-forge environment with
# PostgreSQL 17, pgvector and Ruby, then installs the app as the unprivileged
# `claude` user, because PostgreSQL refuses to run as root. Safe to rerun.
# The Codex equivalent is install-native-cloud.sh; this does not replace it.
set -euo pipefail

root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
cd "$root"
state="$root/.native"
mkdir -p "$state/logs" "$state/home"

if [[ $(id -u) -ne 0 ]]; then
  echo 'Run this script as root (it switches to the claude user itself).' >&2
  exit 1
fi

# 1. conda-forge environment: PostgreSQL 17, pgvector, Ruby 3.4.x and gem build libraries.
if [[ ! -x $state/conda/bin/ruby || ! -f $state/conda/share/extension/vector.control ]]; then
  mm_dir="$state/micromamba"
  if [[ ! -x $mm_dir/bin/micromamba ]]; then
    mkdir -p "$mm_dir"
    curl -fsSL -o "$mm_dir/micromamba.tar.bz2" \
      https://conda.anaconda.org/conda-forge/linux-64/micromamba-2.10.0-0.tar.bz2
    tar -xjf "$mm_dir/micromamba.tar.bz2" -C "$mm_dir" bin/micromamba
  fi
  "$mm_dir/bin/micromamba" create -y -p "$state/conda" -c conda-forge --override-channels \
    'ruby=3.4' 'postgresql=17' pgvector libpq yaml libffi zlib openssl readline \
    > "$state/logs/conda.log" 2>&1
fi
ln -sfn "$state/conda" "$state/ruby"
ln -sfn "$state/conda" "$state/pgsql"

# conda's Ruby records conda-only compiler names for building gems. Point those names at
# the system toolchain so native gems (pg, bigdecimal, ...) compile.
mkdir -p "$state/bin"
for pair in cc:gcc cpp:cpp c++:g++ ar:ar as:as ld:ld objcopy:objcopy objdump:objdump \
  ranlib:ranlib strip:strip pkg-config:pkg-config; do
  ln -sfn "$(command -v "${pair#*:}")" "$state/bin/x86_64-conda-linux-gnu-${pair%%:*}"
done
ln -sfn "$(command -v nm)" "$state/bin/llvm-nm"

# 2. Things the claude user cannot read from /root: the uv binary and the proxy CA bundle.
if [[ ! -x /usr/local/bin/uv ]]; then
  install -m 0755 "$(command -v uv)" /usr/local/bin/uv
fi
for ca in "${CCR_CA_BUNDLE:-/root/.ccr/ca-bundle.crt}" /etc/ssl/certs/ca-certificates.crt; do
  if [[ -f $ca ]]; then
    install -m 0644 "$ca" "$state/ca-bundle.crt"
    break
  fi
done

# 3. Hand the checkout to the claude user and run the shared installer as that user.
chown -R claude:claude "$root"
runuser -u claude -- env HOME="$state/home" PATH="$PATH" \
  python3 script/claude_cloud.py install

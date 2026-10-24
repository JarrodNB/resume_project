#!/usr/bin/env bash
# Provision the native development runtime in an unprivileged Debian 13 container.
# Everything writable stays in this checkout so a fresh container needs one command.
set -euo pipefail

root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
cd "$root"
state="$root/.native"
logs="$state/logs"
mkdir -p "$logs"

if [[ $(id -u) -eq 0 ]]; then
  echo 'Run this script as the normal workspace user, not root.' >&2
  exit 1
fi
. /etc/os-release
if [[ ${ID:-} != debian || ${VERSION_CODENAME:-} != trixie ]]; then
  echo 'This rootless installer targets Debian 13 (trixie).' >&2
  exit 1
fi

for tool in apt-get curl dpkg-deb ffmpeg gcc git make node npm perl \
  pkg-config python3 tar uv; do
  command -v "$tool" >/dev/null || { echo "Missing required host tool: $tool" >&2; exit 1; }
done

on_error() {
  echo "Native provisioning failed. Recent build output:" >&2
  for file in "$logs"/{postgres,ruby,pgvector}.log; do
    if [[ -f $file ]]; then
      echo "==> $file" >&2
      tail -n 12 "$file" >&2
    fi
  done
}
trap on_error ERR

postgres_version=17.6
pgvector_version=v0.8.1
ruby_version=3.4.11
prefix="$state/pgsql"
sysroot="$state/sysroot"
source_dir="$state/sources"
mkdir -p "$source_dir"

if [[ ! -x $prefix/bin/postgres || ! -f $prefix/share/extension/vector.control || ! -x $state/ruby/bin/ruby ]]; then
  apt_dir="$state/apt"
  mkdir -p "$apt_dir/lists/partial" "$apt_dir/cache/archives/partial" "$apt_dir/downloads" "$sysroot"
  printf 'deb https://deb.debian.org/debian trixie main\n' > "$apt_dir/sources.list"
  apt_options=(
    -o "Dir::Etc::sourcelist=$apt_dir/sources.list"
    -o 'Dir::Etc::sourceparts=-'
    -o "Dir::State::lists=$apt_dir/lists"
    -o "Dir::Cache=$apt_dir/cache"
    -o "Dir::Cache::archives=$apt_dir/cache/archives"
  )
  echo 'Downloading build prerequisites into .native/sysroot ...'
  apt-get update "${apt_options[@]}" -o APT::Get::List-Cleanup=0 > "$logs/apt-update.log" 2>&1
  (
    cd "$apt_dir/downloads"
    apt-get download bison flex m4 libffi-dev libreadline-dev \
      libyaml-dev "${apt_options[@]}" > "$logs/apt-download.log" 2>&1
    for archive in ./*.deb; do
      dpkg-deb -x "$archive" "$sysroot"
    done
  )
  export CPPFLAGS="-I$sysroot/usr/include ${CPPFLAGS:-}"
  export LDFLAGS="-L$sysroot/usr/lib/x86_64-linux-gnu ${LDFLAGS:-}"
  export PKG_CONFIG_PATH="$sysroot/usr/lib/x86_64-linux-gnu/pkgconfig${PKG_CONFIG_PATH:+:$PKG_CONFIG_PATH}"
fi

if [[ ! -x $prefix/bin/postgres ]]; then
  archive="$source_dir/postgresql-$postgres_version.tar.bz2"
  if [[ ! -f $archive ]]; then
    curl -fsSL "https://ftp.postgresql.org/pub/source/v$postgres_version/postgresql-$postgres_version.tar.bz2" -o "$archive"
  fi
  if [[ ! -d $source_dir/postgresql-$postgres_version ]]; then
    tar -xf "$archive" -C "$source_dir"
  fi
  mkdir -p "$state/build-pg"
  echo "Building PostgreSQL $postgres_version ..."
  (
    cd "$state/build-pg"
    export PATH="$sysroot/usr/bin:$PATH"
    export M4="$sysroot/usr/bin/m4"
    export BISON_PKGDATADIR="$sysroot/usr/share/bison"
    "$source_dir/postgresql-$postgres_version/configure" \
      --prefix="$prefix" --without-readline --without-zlib --without-icu > "$logs/postgres.log" 2>&1
    make -j4 >> "$logs/postgres.log" 2>&1
    make install >> "$logs/postgres.log" 2>&1
  )
fi

if [[ ! -f $prefix/share/extension/vector.control ]]; then
  if [[ ! -d $source_dir/pgvector ]]; then
    git clone --depth 1 --branch "$pgvector_version" \
      https://github.com/pgvector/pgvector.git "$source_dir/pgvector" > "$logs/pgvector.log" 2>&1
  fi
  echo "Building pgvector $pgvector_version ..."
  make -C "$source_dir/pgvector" PG_CONFIG="$prefix/bin/pg_config" -j4 >> "$logs/pgvector.log" 2>&1
  make -C "$source_dir/pgvector" PG_CONFIG="$prefix/bin/pg_config" install >> "$logs/pgvector.log" 2>&1
fi

if [[ ! -x $state/ruby/bin/ruby ]]; then
  if [[ ! -d $state/ruby-build ]]; then
    git clone --depth 1 https://github.com/rbenv/ruby-build.git "$state/ruby-build" > "$logs/ruby.log" 2>&1
  fi
  echo "Building Ruby $ruby_version ..."
  MAKE_OPTS=-j4 "$state/ruby-build/bin/ruby-build" "$ruby_version" "$state/ruby" >> "$logs/ruby.log" 2>&1
fi

"$prefix/bin/postgres" --version
"$state/ruby/bin/ruby" --version
test -f "$prefix/share/extension/vector.control"
echo 'Installing application dependencies ...'
python3 script/native.py install

#!/bin/bash
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y --no-install-recommends libcurl4 libssl3 libgssapi-krb5-2 ca-certificates >/dev/null
ldd /input/mongod > /tmp/mongo-libraries.txt
if grep -q 'not found' /tmp/mongo-libraries.txt; then
  cat /tmp/mongo-libraries.txt
  echo 'Unresolved bundled MongoDB dependencies' >&2
  exit 1
fi
# Preserve SONAME filenames but dereference symlinks, so every copied library
# is self-contained. core22 supplies glibc and the loader; do not replace them.
while read -r library; do
  name=$(basename "$library")
  case "$name" in
    ld-linux*|libc.so.*|libm.so.*|libpthread.so.*|libdl.so.*|librt.so.*|libresolv.so.*) continue ;;
  esac
  cp -L "$library" "/output/$name"
done < <(awk '/=> \/.* \(/ {print $3}' /tmp/mongo-libraries.txt)
mkdir -p /output/notices
for copyright in /usr/share/doc/*/copyright; do
  package=$(basename "$(dirname "$copyright")")
  cp -L "$copyright" "/output/notices/$package.txt"
done
dpkg-query -W -f='${Package} ${Version}\n' > /output/ubuntu22-packages.txt
LD_LIBRARY_PATH=/output /input/mongod --version

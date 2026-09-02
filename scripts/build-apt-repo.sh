#!/usr/bin/env bash
# Build the signed APT repository tree for packages.posnic.com
# (RELEASE_TRUST_PLAN §4).
#
# An APT repo is just files - dists/ metadata signed by our GPG key and a
# pool/ of .debs. reprepro builds both. What gets uploaded is the OUTPUT
# tree only; the key itself never leaves the runner's memory-backed keyring.
#
# Usage: build-apt-repo.sh <deb-file> <output-dir>
# Env:   APT_GPG_KEY_ID - fingerprint of the signing (sub)key, already
#        imported into the default keyring by the caller.
set -euo pipefail

DEB=${1:?usage: build-apt-repo.sh <deb-file> <output-dir>}
OUT=${2:?usage: build-apt-repo.sh <deb-file> <output-dir>}
: "${APT_GPG_KEY_ID:?APT_GPG_KEY_ID must name the imported signing key}"

command -v reprepro >/dev/null || { echo "reprepro is not installed"; exit 1; }

mkdir -p "$OUT/conf"
cat > "$OUT/conf/distributions" <<CONF
Origin: Posnic
Label: Posnic
Codename: stable
Architectures: amd64
Components: main
Description: Posnic point of sale - official package repository
SignWith: ${APT_GPG_KEY_ID}
CONF

reprepro -b "$OUT" includedeb stable "$DEB"

# The public key customers fetch first; served beside the repo so the
# install one-liner has a single origin to trust.
gpg --armor --export "$APT_GPG_KEY_ID" > "$OUT/gpg.key"

echo "APT repo built at $OUT:"
find "$OUT" -type f | sort | sed 's/^/  /'

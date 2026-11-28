#!/usr/bin/env bash
# Run the Windows client against the OpenSSH SFTP subsystem bundled with Git for Windows.
set -euo pipefail
cd "$(dirname "$0")/.."
server=/usr/lib/ssh/sftp-server.exe
test -x "$server"
fixture=$(mktemp -d)
trap 'rm -rf -- "$fixture"' EXIT
export MSYS=winsymlinks:sys
# Pass SFTP paths verbatim to the Windows test binary.
export MSYS2_ENV_CONV_EXCL='STRATUM_SFTP_TEST_FOLDER;STRATUM_SFTP_OPERATIONS_DIR;STRATUM_SFTP_TEST_RANGE;STRATUM_SFTP_UNSAFE_TREE;STRATUM_SFTP_LINK_FIXTURE'
export STRATUM_SFTP_TEST_HOST=stratum-disposable
export STRATUM_SFTP_TEST_SUBSYSTEM="$(cygpath -w "$server")"
export STRATUM_SFTP_TEST_FOLDER="$fixture/transfers"
export STRATUM_SFTP_OPERATIONS_DIR="$fixture/operations"
export STRATUM_SFTP_TEST_RANGE="$fixture/range.bin"
export STRATUM_SFTP_LINK_FIXTURE="$fixture/recovery"
export STRATUM_SFTP_UNSAFE_TREE="$fixture/unsafe-download"
ops=$STRATUM_SFTP_OPERATIONS_DIR
links=$STRATUM_SFTP_LINK_FIXTURE
mkdir -p "$STRATUM_SFTP_TEST_FOLDER" "$ops"/{move-source,move-destination,tree/nested,unsafe,outside} "$links/outside" "$STRATUM_SFTP_UNSAFE_TREE"
mkdir -p "$fixture/properties"
printf data > "$fixture/properties/file"
ln -s 'missing target' "$fixture/properties/link"
dd if=/dev/urandom of="$STRATUM_SFTP_TEST_RANGE" bs=64K count=12 status=none
printf tail >> "$STRATUM_SFTP_TEST_RANGE"
touch "$ops/occupied.txt" "$ops/tree/nested/file" "$ops/outside/sentinel.txt" "$ops/move-destination/conflict"
touch "$ops/move-source"/{first,conflict,cancel-first,cancel-second}
ln -s ../outside "$ops/unsafe/link"
# Force a rejected delete walk while a link points outside the selected tree.
deep="$ops/unsafe"
for ((i=0; i<66; i++)); do deep="$deep/d"; done
mkdir -p "$deep"
ln -s ../operations/outside "$STRATUM_SFTP_UNSAFE_TREE/link"
printf keep > "$links/outside/keep"
stage="$links/.stratum-move-copy-"
mkdir "${stage}11111111111111111111111111111111" "${stage}33333333333333333333333333333333"
ln -s ../outside "${stage}11111111111111111111111111111111/link"
ln -s outside "${stage}22222222222222222222222222222222"
printf keep > "${stage}33333333333333333333333333333333/keep"

# Git Bash also ships a Unix link.exe. Give rustc the MSVC linker first.
vswhere="$(cygpath -u "${ProgramFiles_x86:-C:/Program Files (x86)}")/Microsoft Visual Studio/Installer/vswhere.exe"
vs=$("$vswhere" -latest -products '*' -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath | tr -d '\r')
msvc=$(cygpath -u "$vs")/VC/Tools/MSVC
linker=$(ls -d "$msvc"/*/bin/Hostx64/x64 | sort -V | tail -1)
PATH="$linker:$PATH" cargo test --locked --manifest-path src-tauri/Cargo.toml --lib services::remotes:: -- --ignored --test-threads=1

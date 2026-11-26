"""Verify the Tauri updater signature shared by draft and feed publication."""
import base64
import os
from pathlib import Path
import re
import subprocess
import sys
from tempfile import TemporaryDirectory


STABLE_VERSION = re.compile(r"(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)")


def release_asset_names(version):
    if not STABLE_VERSION.fullmatch(version):
        raise ValueError("Expected a stable release version")
    setup = f"Stratum_{version}_x64-setup.exe"
    return (
        setup,
        setup + ".sig",
        f"Stratum_{version}_portable.exe",
        f"Stratum_{version}_x64_en-US.msi",
    )


def verify_installer(work, version, public_key):
    setup, signature_name, *_ = release_asset_names(version)
    signature = (work / signature_name).read_text(encoding="ascii").strip()
    decoded = base64.b64decode(signature, validate=True)
    with TemporaryDirectory(prefix="stratum-signature-") as temporary:
        signature_file = Path(temporary) / "installer.minisig"
        public_key_file = Path(temporary) / "signer.pub"
        signature_file.write_bytes(decoded)
        public_key_file.write_bytes(base64.b64decode(public_key.strip(), validate=True))
        subprocess.run(
            ["minisign", "-V", "-q", "-m", work / setup, "-x", signature_file, "-p", public_key_file],
            check=True,
        )

    trusted = decoded.decode().splitlines()[2].removeprefix("trusted comment: ").split("\t")
    if f"file:{setup}" not in trusted or f"version:{version}" not in trusted:
        raise ValueError("Installer signature must bind this filename and release version")
    return signature


if __name__ == "__main__":
    directory = Path(sys.argv[1])
    version = sys.argv[2]
    for name in release_asset_names(version):
        artifact = directory / name
        if not artifact.is_file() or artifact.stat().st_size == 0:
            sys.exit(f"Missing or empty release artifact: {name}")
    verify_installer(directory, version, os.environ["STRATUM_UPDATER_PUBLIC_KEY"])
    print(f"Verified the v{version} installer signature and required release assets.")

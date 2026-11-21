fn main() {
    // Regenerate the Windows resources when the source icon changes.
    println!("cargo:rerun-if-changed=icons/icon.ico");
    tauri_build::build()
}

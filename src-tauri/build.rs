fn main() {
    // Regenerate the Windows resources when the source icon changes.
    println!("cargo:rerun-if-changed=icons/icon.ico");
    tauri_build::build();
    // The updater integration test uses the same desktop
    // manifest to select Windows Common Controls v6. Tauri links it to bins.
    if std::env::var("CARGO_CFG_TARGET_ENV").as_deref() == Ok("msvc") {
        let output = std::path::PathBuf::from(std::env::var_os("OUT_DIR").unwrap());
        println!(
            "cargo:rustc-link-arg-tests={}",
            output.join("resource.lib").display()
        );
    }
}

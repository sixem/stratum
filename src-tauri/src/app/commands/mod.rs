// Tauri command surface grouped by functional area.
pub mod backup;
pub mod filesystem;
pub mod indexed_search;
pub mod media;
pub mod shell_menu;
pub mod system;
pub mod updates;

pub use backup::*;
pub use filesystem::*;
pub use indexed_search::*;
pub use media::*;
pub use shell_menu::*;
pub use system::*;

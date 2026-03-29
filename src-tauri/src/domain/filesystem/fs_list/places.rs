// Small helpers that expose the user's home folder and common Windows-friendly places.
use super::super::Place;
use std::env;
use std::path::PathBuf;

pub(super) fn home_dir() -> Option<PathBuf> {
    env::var_os("USERPROFILE")
        .or_else(|| env::var_os("HOME"))
        .map(PathBuf::from)
}

fn push_place(places: &mut Vec<Place>, name: &str, path: PathBuf) {
    if path.exists() {
        places.push(Place {
            name: name.to_string(),
            path: path.to_string_lossy().to_string(),
        });
    }
}

pub fn get_home() -> Option<String> {
    home_dir().map(|path| path.to_string_lossy().to_string())
}

pub fn get_places() -> Vec<Place> {
    let mut places = Vec::new();
    if let Some(home) = home_dir() {
        push_place(&mut places, "Home", home.clone());
        push_place(&mut places, "Desktop", home.join("Desktop"));
        push_place(&mut places, "Documents", home.join("Documents"));
        push_place(&mut places, "Downloads", home.join("Downloads"));
        push_place(&mut places, "Pictures", home.join("Pictures"));
    }
    places
}

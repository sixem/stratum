// Negotiate what the transfer manager will do before taking data from the source.
use serde::Serialize;
use windows::Win32::System::Ole::{
    DROPEFFECT, DROPEFFECT_COPY, DROPEFFECT_MOVE, DROPEFFECT_NONE, MK_ALT,
};
use windows::Win32::System::SystemServices::{MK_CONTROL, MK_SHIFT, MODIFIERKEYS_FLAGS};

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub(super) enum DropAction {
    Auto,
    Copy,
    Move,
}

impl DropAction {
    pub(super) fn choose(
        allowed: DROPEFFECT,
        keys: MODIFIERKEYS_FLAGS,
        can_move: bool,
    ) -> Option<Self> {
        if keys.0 & MK_ALT != 0 {
            return None;
        }
        let copy = (allowed & DROPEFFECT_COPY) == DROPEFFECT_COPY;
        let move_files = can_move && (allowed & DROPEFFECT_MOVE) == DROPEFFECT_MOVE;
        let ctrl = (keys & MK_CONTROL).0 != 0;
        let shift = (keys & MK_SHIFT).0 != 0;
        match (ctrl, shift) {
            (true, true) => None, // Stratum does not create shortcuts on drop.
            (true, false) => copy.then_some(Self::Copy),
            (false, true) => move_files.then_some(Self::Move),
            (false, false) if copy && move_files => Some(Self::Auto),
            (false, false) if copy => Some(Self::Copy),
            (false, false) if move_files => Some(Self::Move),
            _ => None,
        }
    }

    pub(super) fn hover_effect(self) -> DROPEFFECT {
        match self {
            Self::Move => DROPEFFECT_MOVE,
            Self::Copy | Self::Auto => DROPEFFECT_COPY,
        }
    }

    pub(super) fn completion_effect(self) -> DROPEFFECT {
        // Conflict prompts and the managed move run after Drop returns. Returning
        // MOVE here can instruct the other application to delete its originals.
        match self {
            Self::Move => DROPEFFECT_NONE,
            Self::Copy | Self::Auto => DROPEFFECT_COPY,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use windows::Win32::System::Ole::DROPEFFECT_LINK;

    #[test]
    fn incoming_effect_honors_source_permissions_and_keyboard_modifiers() {
        let both = DROPEFFECT_COPY | DROPEFFECT_MOVE;
        let plain = MODIFIERKEYS_FLAGS(0);
        assert_eq!(
            DropAction::choose(both, plain, true),
            Some(DropAction::Auto)
        );
        assert_eq!(
            DropAction::choose(DROPEFFECT_COPY, plain, true),
            Some(DropAction::Copy)
        );
        assert_eq!(
            DropAction::choose(both, MK_CONTROL, true),
            Some(DropAction::Copy)
        );
        assert_eq!(
            DropAction::choose(both, MK_SHIFT, true),
            Some(DropAction::Move)
        );
        assert_eq!(
            DropAction::choose(both, plain, false),
            Some(DropAction::Copy)
        );
        assert_eq!(DropAction::choose(DROPEFFECT_MOVE, plain, false), None);
        assert_eq!(DropAction::choose(DROPEFFECT_COPY, MK_SHIFT, true), None);
        assert_eq!(DropAction::choose(DROPEFFECT_LINK, plain, true), None);
        assert_eq!(
            DropAction::choose(both, MODIFIERKEYS_FLAGS(MK_ALT), true),
            None
        );
        assert_eq!(DropAction::choose(both, MK_CONTROL | MK_SHIFT, true), None);
        assert_eq!(DropAction::Move.completion_effect(), DROPEFFECT_NONE);
    }
}

// Bitwright - Sprite Engine
// Copyright (C) 2026 Afterhours Studio
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as
// published by the Free Software Foundation, either version 3 of the
// License, or (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program. If not, see <https://www.gnu.org/licenses/>.
//! One agent's connection to the server, and the asset it is working on.
//!
//! The op log records an actor per write, so a sprite drawn by two agents and a
//! person can answer "who put that there". That string is made here, from the
//! session id the transport assigned, and nowhere else.

use bitwright::store::AssetId;
use std::sync::Mutex;

/// The `current` field is private on purpose: a session's asset changes when the
/// session opens one, not because a tool argument happened to name another.
pub struct Session {
    pub id: String,
    current: Mutex<Option<AssetId>>,
}

impl Session {
    pub fn new(id: impl Into<String>) -> Self {
        Self {
            id: id.into(),
            current: Mutex::new(None),
        }
    }

    /// The actor written into the op log: `agent:<session id>`.
    pub fn actor(&self) -> String {
        format!("agent:{}", self.id)
    }

    pub fn current_asset(&self) -> Option<AssetId> {
        *self
            .current
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    pub fn set_current_asset(&self, id: AssetId) {
        *self
            .current
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner()) = Some(id);
    }
}

#[cfg(test)]
mod tests {
    use super::Session;
    use bitwright::store::AssetId;
    use std::sync::Arc;
    use uuid::Uuid;

    #[test]
    fn actor_is_the_agent_prefix_over_the_session_id() {
        let session = Session::new("sess-17");
        assert_eq!(session.actor(), "agent:sess-17");
    }

    #[test]
    fn current_asset_starts_empty() {
        let session = Session::new("fresh");
        assert_eq!(session.current_asset(), None);
    }

    #[test]
    fn current_asset_round_trips_through_the_setter() {
        let session = Session::new("worker");
        let id = AssetId(Uuid::now_v7());
        session.set_current_asset(id);
        assert_eq!(session.current_asset(), Some(id));

        // The session tracks one asset at a time: opening another replaces it.
        let later = AssetId(Uuid::now_v7());
        session.set_current_asset(later);
        assert_eq!(session.current_asset(), Some(later));
    }

    #[test]
    fn a_poisoned_lock_still_reports_the_asset() {
        let session = Arc::new(Session::new("poisoned"));
        let id = AssetId(Uuid::now_v7());
        session.set_current_asset(id);
        // Poison the lock the way a panicking tool would.
        let shared = Arc::clone(&session);
        let handle = std::thread::spawn(move || {
            let _guard = shared.current.lock().unwrap();
            panic!("tool panicked while holding the lock");
        });
        let _ = handle.join();
        assert_eq!(session.current_asset(), Some(id));
    }
}

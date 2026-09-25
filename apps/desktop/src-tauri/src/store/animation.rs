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

//! An animation is an ordered row of ordinary assets, so every layer, op and
//! gate rule applies to a frame unchanged. Only the order, the durations and
//! the playback mode live here; an asset with no `frame` row is a one-frame
//! animation, which keeps every asset made before animations valid as it is.

use super::history::{self, Mutation};
use super::{now, read_asset, read_document, AppError, AssetId, Result, Store, STEPS};
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::ops::RangeInclusive;
use uuid::Uuid;

/// 8 FPS, the rate most hand-drawn pixel cycles are timed at.
pub const DEFAULT_DURATION_MS: u32 = 125;
pub const DURATION_MS: RangeInclusive<u32> = 10..=10_000;
pub const PLAYBACKS: [&str; 3] = ["forward", "reverse", "pingpong"];
/// A blank frame starts no later than this step: it has no pixels, so any
/// gate past the silhouette would be judging work that is not there.
const BLANK_STEP: &str = "silhouette";
/// A background is a tilemap and a tileset a grid of tiles: neither is one
/// drawing a frame could be a pose of, so neither gains frames.
const UNANIMATED_KINDS: [&str; 2] = ["background", "tileset"];

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Frame {
    pub asset_id: AssetId,
    pub position: u32,
    pub duration_ms: u32,
    pub name: String,
    pub step: String,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Animation {
    pub root_id: AssetId,
    pub playback: String,
    pub frames: Vec<Frame>,
}

/// One frame in order: its asset and how long it is shown.
type Slot = (AssetId, u32);

/// The root of the animation `id` belongs to; `id` itself for a root or a
/// lone asset. Fails as `document.not_found` when `id` is not an asset.
fn root_of(c: &Connection, id: AssetId) -> Result<AssetId> {
    read_asset(c, id)?;
    let root: Option<String> = c
        .query_row(
            "SELECT root_id FROM frame WHERE asset_id=?1",
            [id.0.to_string()],
            |r| r.get(0),
        )
        .optional()?;
    match root {
        Some(root) => Uuid::parse_str(&root)
            .map(AssetId)
            .map_err(|e| AppError::new("store.database_failed", e.to_string())),
        None => Ok(id),
    }
}

/// The stored frames of `root` in order, empty for a lone asset.
fn slots(c: &Connection, root: AssetId) -> Result<Vec<Slot>> {
    let mut statement =
        c.prepare("SELECT asset_id, duration_ms FROM frame WHERE root_id=?1 ORDER BY position")?;
    let rows = statement
        .query_map([root.0.to_string()], |r| {
            Ok((AssetId(super::uuid(r, 0)?), r.get::<_, u32>(1)?))
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(rows)
}

/// The frames of `root` in order, a lone asset being its own single frame.
fn order(c: &Connection, root: AssetId) -> Result<Vec<Slot>> {
    let stored = slots(c, root)?;
    Ok(if stored.is_empty() {
        vec![(root, DEFAULT_DURATION_MS)]
    } else {
        stored
    })
}

fn playback(c: &Connection, root: AssetId) -> Result<String> {
    let mode: Option<String> = c
        .query_row(
            "SELECT playback FROM animation WHERE root_id=?1",
            [root.0.to_string()],
            |r| r.get(0),
        )
        .optional()?;
    Ok(mode.unwrap_or_else(|| PLAYBACKS[0].into()))
}

/// Every frame asset of the animation `id` belongs to, in order: `[id]` for a
/// lone asset. A write that frames share is applied to each of these.
pub(super) fn frame_ids(c: &Connection, id: AssetId) -> Result<Vec<AssetId>> {
    let root = root_of(c, id)?;
    Ok(order(c, root)?.into_iter().map(|(id, _)| id).collect())
}

pub(super) fn read(c: &Connection, any_frame: AssetId) -> Result<Animation> {
    let root = root_of(c, any_frame)?;
    let frames = order(c, root)?
        .into_iter()
        .enumerate()
        .map(|(position, (id, duration_ms))| {
            let asset = read_asset(c, id)?;
            Ok(Frame {
                asset_id: id,
                position: position as u32,
                duration_ms,
                name: asset.name,
                step: asset.step,
                updated_at: asset.updated_at,
            })
        })
        .collect::<Result<Vec<_>>>()?;
    Ok(Animation {
        root_id: root,
        playback: playback(c, root)?,
        frames,
    })
}

/// The name a person or agent is refused because an animation derives it:
/// `<base> #<n>` with `n` ≥ 2 written the way `layout` writes it. Returns
/// the base, which is the root name that would derive `value`.
fn derived_base(value: &str) -> Option<&str> {
    let (base, n) = value.rsplit_once(" #")?;
    let parsed: u32 = n.parse().ok()?;
    (parsed >= 2 && parsed.to_string() == n).then_some(base)
}

fn name_taken(value: &str) -> AppError {
    AppError::new("animation.name_taken", value)
}

/// Refuses `value` for a root or lone asset (`own`, or none when creating)
/// when it is `<root> #<n>` of another animation's root: that name belongs to
/// the animation's frames, taken now or once the animation grows, and letting
/// an unrelated asset hold it would make the next frame add fail on a name
/// the person never chose. An asset with animation rows is an animated root,
/// whatever its frame count.
pub(super) fn check_reserved(
    c: &Connection,
    project: Uuid,
    value: &str,
    own: Option<AssetId>,
) -> Result<()> {
    let Some(base) = derived_base(value) else {
        return Ok(());
    };
    let owner: Option<Uuid> = c
        .query_row(
            "SELECT a.id FROM asset a JOIN frame f ON f.asset_id=a.id AND f.position=0
             WHERE a.project_id=?1 AND a.name=?2",
            params![project.to_string(), base],
            |r| super::uuid(r, 0),
        )
        .optional()?;
    match owner {
        Some(owner) if own.map_or(true, |own| own.0 != owner) => Err(name_taken(value)),
        _ => Ok(()),
    }
}

/// Checks every name `layout` would write before it writes any: a derived
/// name held by an asset outside the animation fails as
/// `animation.name_taken` naming it, and one too long to be a name fails as
/// `document.invalid_name` (the root name fits; the ` #n` pushed it over).
fn check_derived(c: &Connection, slots: &[Slot], root_name: &str) -> Result<()> {
    let project = read_asset(c, slots[0].0)?.project_id;
    super::name(root_name)?;
    for position in 1..slots.len() {
        let value = format!("{root_name} #{}", position + 1);
        super::name(&value)?;
        let holder: Option<Uuid> = c
            .query_row(
                "SELECT id FROM asset WHERE project_id=?1 AND name=?2",
                params![project.to_string(), value],
                |r| super::uuid(r, 0),
            )
            .optional()?;
        if holder.is_some_and(|holder| !slots.iter().any(|(id, _)| id.0 == holder)) {
            return Err(name_taken(&value));
        }
    }
    Ok(())
}

/// Gives a lone asset the rows an animation keeps its timing in, so a
/// duration or playback set before a second frame exists is kept rather
/// than dropped.
fn ensure_rows(c: &Connection, root: AssetId) -> Result<()> {
    if slots(c, root)?.is_empty() {
        c.execute(
            "INSERT INTO animation(root_id, playback) VALUES(?1, ?2)",
            params![root.0.to_string(), PLAYBACKS[0]],
        )?;
        c.execute(
            "INSERT INTO frame(asset_id, root_id, position, duration_ms) VALUES(?1, ?1, 0, ?2)",
            params![root.0.to_string(), DEFAULT_DURATION_MS],
        )?;
    }
    Ok(())
}

/// Drops the rows of a one-frame animation whose timing is the default, so
/// they say no more than their absence would.
fn tidy(c: &Connection, root: AssetId) -> Result<()> {
    let stored = slots(c, root)?;
    if stored.len() == 1 && stored[0].1 == DEFAULT_DURATION_MS && playback(c, root)? == PLAYBACKS[0]
    {
        c.execute("DELETE FROM frame WHERE root_id=?1", [root.0.to_string()])?;
        c.execute(
            "DELETE FROM animation WHERE root_id=?1",
            [root.0.to_string()],
        )?;
    }
    Ok(())
}

/// Rewrites the animation that was rooted at `old_root` as `slots`, in that
/// order: the rows, the root (whoever is first now) and every frame's name.
/// Rewriting rather than shifting positions and names in place means
/// neither `UNIQUE (root_id, position)` nor `UNIQUE (project_id, name)` can
/// be hit half way through. Every name is checked before anything is
/// written, and a frame whose name changed has its `updated_at` bumped so
/// lists sorted by it see the change. One frame left keeps its rows only
/// while its timing differs from the default.
fn layout(
    c: &Connection,
    old_root: AssetId,
    slots: &[Slot],
    playback: &str,
    root_name: &str,
) -> Result<()> {
    check_derived(c, slots, root_name)?;
    let before = slots
        .iter()
        .map(|(id, _)| Ok(read_asset(c, *id)?.name))
        .collect::<Result<Vec<_>>>()?;
    c.execute(
        "DELETE FROM frame WHERE root_id=?1",
        [old_root.0.to_string()],
    )?;
    c.execute(
        "DELETE FROM animation WHERE root_id=?1",
        [old_root.0.to_string()],
    )?;
    // A control character can never be in a name a person or agent chose
    // (`super::name` refuses it), so a parked name cannot collide with one.
    for (id, _) in slots {
        c.execute(
            "UPDATE asset SET name=?1 WHERE id=?2",
            params![format!("\u{1}{}", id.0), id.0.to_string()],
        )?;
    }
    let root = slots[0].0;
    c.execute(
        "INSERT INTO animation(root_id, playback) VALUES(?1, ?2)",
        params![root.0.to_string(), playback],
    )?;
    for (position, (id, duration)) in slots.iter().enumerate() {
        c.execute(
            "INSERT INTO frame(asset_id, root_id, position, duration_ms) VALUES(?1, ?2, ?3, ?4)",
            params![
                id.0.to_string(),
                root.0.to_string(),
                position as i64,
                duration
            ],
        )?;
    }
    let at = now();
    for (position, ((id, _), old)) in slots.iter().zip(&before).enumerate() {
        let value = if position == 0 {
            root_name.to_string()
        } else {
            format!("{root_name} #{}", position + 1)
        };
        c.execute(
            "UPDATE asset SET name=?1, updated_at=CASE WHEN ?1=?2 THEN updated_at ELSE ?3 END
             WHERE id=?4",
            params![value, old, at, id.0.to_string()],
        )?;
    }
    tidy(c, root)
}

/// Renames the root `root` to `value` and every frame after it. The caller
/// has already refused a non-root frame, whose name is derived. Returns
/// false for an asset with no animation rows, which the caller renames
/// itself.
pub(super) fn rename(c: &Connection, root: AssetId, value: &str) -> Result<bool> {
    let stored = slots(c, root)?;
    if stored.is_empty() {
        return Ok(false);
    }
    layout(c, root, &stored, &playback(c, root)?, value)?;
    Ok(true)
}

fn check_duration(ms: u32) -> Result<()> {
    if !DURATION_MS.contains(&ms) {
        return Err(AppError::new(
            "animation.invalid_duration",
            format!(
                "a frame lasts {}..={} ms, not {ms}",
                DURATION_MS.start(),
                DURATION_MS.end()
            ),
        ));
    }
    Ok(())
}

fn step_index(step: &str) -> usize {
    STEPS.iter().position(|s| *s == step).unwrap_or(0)
}

impl Store {
    pub fn animation_read(&self, any_frame: AssetId) -> Result<Animation> {
        read(&self.connection, any_frame)
    }

    pub fn frame_add(&mut self, after: AssetId, copy: bool) -> Result<Animation> {
        self.frame_add_as(after, copy, "user")
    }

    /// Inserts a new frame right after `after`. A copy takes its layers,
    /// palette and step (not its references: those belong to the drawing
    /// that was traced, not to each pose). A blank frame has the same layer
    /// roles, all empty, the same palette, and starts at the earlier of the
    /// source's step and the silhouette. The palette and layers are written
    /// through the new frame's op log under `actor`, as a variation's are.
    pub fn frame_add_as(&mut self, after: AssetId, copy: bool, actor: &str) -> Result<Animation> {
        history::validate_actor(actor)?;
        let limit = self.history_limit;
        let tx = self.connection.transaction()?;
        let root = root_of(&tx, after)?;
        let mut slots = order(&tx, root)?;
        let index = slots
            .iter()
            .position(|(id, _)| *id == after)
            .ok_or_else(|| AppError::new("document.not_found", after.0.to_string()))?;
        let source = read_document(&tx, after)?;
        let root_asset = read_asset(&tx, root)?;
        if UNANIMATED_KINDS.contains(&root_asset.kind.as_str()) {
            return Err(AppError::new(
                "animation.unsupported_kind",
                format!("a {} cannot be animated", root_asset.kind),
            ));
        }
        let step = if copy || step_index(&source.asset.step) < step_index(BLANK_STEP) {
            source.asset.step.clone()
        } else {
            BLANK_STEP.to_string()
        };
        let id = AssetId(Uuid::now_v7());
        let at = now();
        tx.execute(
            "INSERT INTO asset(id,project_id,style_id,name,kind,width,height,step,created_at,updated_at)
             VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?9)",
            params![
                id.0.to_string(),
                root_asset.project_id.to_string(),
                root_asset.style_id.map(|s| s.to_string()),
                format!("\u{1}{}", id.0),
                root_asset.kind,
                root_asset.width,
                root_asset.height,
                step,
                at
            ],
        )?;
        tx.execute(
            "INSERT INTO palette VALUES(?1,'[]','[]')",
            [id.0.to_string()],
        )?;
        let mut layers = Vec::with_capacity(source.layers.len());
        for layer in &source.layers {
            let mut frame_layer = layer.clone();
            frame_layer.id = Uuid::now_v7();
            tx.execute(
                "INSERT INTO layer(id,asset_id,role,ordinal,visible,locked,opacity,pixels)
                 VALUES(?1,?2,?3,?4,?5,?6,?7,?8)",
                params![
                    frame_layer.id.to_string(),
                    id.0.to_string(),
                    frame_layer.role.0,
                    frame_layer.ordinal,
                    frame_layer.visible,
                    frame_layer.locked,
                    frame_layer.opacity,
                    vec![0u8; frame_layer.buffer.data.len()]
                ],
            )?;
            layers.push(frame_layer);
        }
        if !source.palette.slots.is_empty() || !source.palette.ramps.is_empty() {
            history::record(
                &tx,
                id,
                Mutation::Palette(source.palette.clone()),
                actor,
                limit,
            )?;
        }
        if copy {
            for layer in layers {
                if layer.buffer.data.iter().any(|&index| index != 0) {
                    let role = layer.role;
                    history::record(&tx, id, Mutation::Layer(Some(layer), role), actor, limit)?;
                }
            }
        }
        slots.insert(index + 1, (id, slots[index].1));
        layout(&tx, root, &slots, &playback(&tx, root)?, &root_asset.name)?;
        tx.commit()?;
        self.animation_read(id)
    }

    /// Deletes one frame and its asset. The last frame is refused: deleting
    /// the whole asset is `asset_delete`. Deleting the root makes the next
    /// frame the root, under the animation's name.
    pub fn frame_delete(&mut self, frame: AssetId) -> Result<Animation> {
        let tx = self.connection.transaction()?;
        let root = root_of(&tx, frame)?;
        let mut slots = order(&tx, root)?;
        if slots.len() < 2 {
            return Err(AppError::new(
                "animation.last_frame",
                "an animation keeps at least one frame; delete the asset instead",
            ));
        }
        let root_name = read_asset(&tx, root)?.name;
        let mode = playback(&tx, root)?;
        slots.retain(|(id, _)| *id != frame);
        // The rows go first: the root's asset row cascades to every frame
        // row that names it, and the name must be free for the next root.
        tx.execute("DELETE FROM frame WHERE root_id=?1", [root.0.to_string()])?;
        tx.execute(
            "DELETE FROM animation WHERE root_id=?1",
            [root.0.to_string()],
        )?;
        tx.execute("DELETE FROM asset WHERE id=?1", [frame.0.to_string()])?;
        layout(&tx, root, &slots, &mode, &root_name)?;
        tx.commit()?;
        self.animation_read(slots[0].0)
    }

    /// Moves a frame to position `to`, clamped to the last position. A frame
    /// moved to the front becomes the root and takes the animation's name.
    pub fn frame_move(&mut self, frame: AssetId, to: u32) -> Result<Animation> {
        let tx = self.connection.transaction()?;
        let root = root_of(&tx, frame)?;
        let mut slots = order(&tx, root)?;
        let from = slots
            .iter()
            .position(|(id, _)| *id == frame)
            .ok_or_else(|| AppError::new("document.not_found", frame.0.to_string()))?;
        let to = (to as usize).min(slots.len() - 1);
        if from != to {
            let root_name = read_asset(&tx, root)?.name;
            let mode = playback(&tx, root)?;
            let moved = slots.remove(from);
            slots.insert(to, moved);
            layout(&tx, root, &slots, &mode, &root_name)?;
        }
        tx.commit()?;
        self.animation_read(frame)
    }

    /// Runs one timing write on the animation `any_frame` belongs to, giving
    /// a lone asset its rows first (so the timing is kept for when it gains
    /// frames) and dropping them again if the write left the defaults.
    fn retime(
        &mut self,
        any_frame: AssetId,
        write: impl FnOnce(&Connection, AssetId) -> Result<()>,
    ) -> Result<Animation> {
        let tx = self.connection.transaction()?;
        let root = root_of(&tx, any_frame)?;
        ensure_rows(&tx, root)?;
        write(&tx, root)?;
        tidy(&tx, root)?;
        tx.commit()?;
        self.animation_read(root)
    }

    /// Sets one frame's duration.
    pub fn frame_set_duration(&mut self, frame: AssetId, ms: u32) -> Result<Animation> {
        check_duration(ms)?;
        self.retime(frame, |c, _| {
            c.execute(
                "UPDATE frame SET duration_ms=?1 WHERE asset_id=?2",
                params![ms, frame.0.to_string()],
            )?;
            Ok(())
        })
    }

    /// Sets every frame's duration: the FPS control.
    pub fn animation_set_duration(&mut self, any_frame: AssetId, ms: u32) -> Result<Animation> {
        check_duration(ms)?;
        self.retime(any_frame, |c, root| {
            c.execute(
                "UPDATE frame SET duration_ms=?1 WHERE root_id=?2",
                params![ms, root.0.to_string()],
            )?;
            Ok(())
        })
    }

    /// Sets the playback mode.
    pub fn animation_set_playback(&mut self, any_frame: AssetId, mode: &str) -> Result<Animation> {
        if !PLAYBACKS.contains(&mode) {
            return Err(AppError::new(
                "animation.invalid_playback",
                format!("playback is forward, reverse or pingpong, not {mode}"),
            ));
        }
        self.retime(any_frame, |c, root| {
            c.execute(
                "UPDATE animation SET playback=?1 WHERE root_id=?2",
                params![mode, root.0.to_string()],
            )?;
            Ok(())
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::raster::{LayerRole, Palette, PaletteSlot};

    fn palette(rgba: [u8; 4]) -> Palette {
        Palette {
            slots: vec![PaletteSlot {
                index: 1,
                rgba,
                name: None,
                ramp: None,
                step: None,
            }],
            ramps: vec![],
        }
    }

    /// A drawn 4x4 sprite named "hero" at the flats step.
    fn hero() -> (Store, uuid::Uuid, AssetId) {
        let mut store = Store::memory().unwrap();
        let project = store.project_create("project", "hd2d").unwrap().id;
        let hero = store
            .asset_create(project, "hero", "character", 4, 4)
            .unwrap()
            .id;
        store
            .palette_write(hero, palette([90, 70, 50, 255]))
            .unwrap();
        let mut layer = store.layer_read(hero, LayerRole("silhouette")).unwrap();
        layer.buffer.data[5] = 1;
        store.layer_write(hero, layer).unwrap();
        store
            .connection
            .execute(
                "UPDATE asset SET step='flats' WHERE id=?1",
                [hero.0.to_string()],
            )
            .unwrap();
        (store, project, hero)
    }

    fn names(animation: &Animation) -> Vec<String> {
        animation.frames.iter().map(|f| f.name.clone()).collect()
    }
    fn ids(animation: &Animation) -> Vec<AssetId> {
        animation.frames.iter().map(|f| f.asset_id).collect()
    }
    fn rows(store: &Store) -> (i64, i64) {
        store
            .connection
            .query_row(
                "SELECT (SELECT COUNT(*) FROM frame), (SELECT COUNT(*) FROM animation)",
                [],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .unwrap()
    }

    #[test]
    fn a_lone_asset_is_a_one_frame_animation_with_no_rows() {
        let (store, _, hero) = hero();
        let animation = store.animation_read(hero).unwrap();
        assert_eq!(animation.root_id, hero);
        assert_eq!(animation.playback, "forward");
        assert_eq!(animation.frames.len(), 1);
        assert_eq!(animation.frames[0].duration_ms, DEFAULT_DURATION_MS);
        assert_eq!(animation.frames[0].name, "hero");
        assert_eq!(rows(&store), (0, 0));
        assert_eq!(
            store
                .animation_read(AssetId(Uuid::now_v7()))
                .unwrap_err()
                .code,
            "document.not_found"
        );
    }

    #[test]
    fn a_copied_frame_takes_the_layers_palette_and_step_but_not_the_references() {
        let (mut store, _, hero) = hero();
        store
            .reference_write(crate::store::Reference {
                id: Uuid::now_v7(),
                asset_id: hero,
                name: "photo".into(),
                source_png: vec![1, 2, 3],
                conformed: None,
                conform_meta: None,
                created_at: 0,
            })
            .unwrap();
        let animation = store.frame_add_as(hero, true, "agent:s-1").unwrap();
        assert_eq!(rows(&store), (2, 1));
        let frame = animation.frames[1].asset_id;
        assert_eq!(animation.frames[1].step, "flats");
        let source = store.asset_open(hero).unwrap();
        let copy = store.asset_open(frame).unwrap();
        assert_eq!(copy.palette, source.palette);
        for (a, b) in source.layers.iter().zip(&copy.layers) {
            assert_eq!((a.role, a.ordinal), (b.role, b.ordinal));
            assert_eq!(a.buffer, b.buffer);
            assert_ne!(a.id, b.id);
        }
        assert_eq!(
            (copy.asset.width, copy.asset.kind.as_str()),
            (4, "character")
        );
        assert!(store.reference_list(frame).unwrap().is_empty());
        let log = store.op_log(frame).unwrap();
        assert!(log.iter().any(|op| op.kind == "palette_write"));
        assert!(log.iter().any(|op| op.kind == "layer_write"));
        assert!(log.iter().all(|op| op.actor == "agent:s-1"));
    }

    #[test]
    fn a_blank_frame_has_empty_layers_the_same_palette_and_starts_no_later_than_the_silhouette() {
        let (mut store, project, hero) = hero();
        let animation = store.frame_add(hero, false).unwrap();
        let blank = store.asset_open(animation.frames[1].asset_id).unwrap();
        assert_eq!(blank.asset.step, "silhouette");
        assert_eq!(blank.palette, store.palette_read(hero).unwrap());
        assert_eq!(
            blank.layers.len(),
            store.asset_open(hero).unwrap().layers.len()
        );
        assert!(blank
            .layers
            .iter()
            .all(|l| l.buffer.data.iter().all(|&i| i == 0)));
        // A source still at the reference step keeps its earlier step.
        let fresh = store
            .asset_create(project, "rock", "prop", 4, 4)
            .unwrap()
            .id;
        let animation = store.frame_add(fresh, false).unwrap();
        assert_eq!(animation.frames[1].step, "reference");
    }

    #[test]
    fn frames_are_named_after_the_root_and_inserted_after_the_given_frame() {
        let (mut store, _, hero) = hero();
        let two = store.frame_add(hero, true).unwrap().frames[1].asset_id;
        let animation = store.frame_add(two, true).unwrap();
        let three = animation.frames[2].asset_id;
        // Inserting after the root pushes the others along and renumbers.
        let animation = store.frame_add(hero, false).unwrap();
        assert_eq!(names(&animation), ["hero", "hero #2", "hero #3", "hero #4"]);
        assert_eq!(animation.frames[2].asset_id, two);
        assert_eq!(animation.frames[3].asset_id, three);
        assert_eq!(
            animation
                .frames
                .iter()
                .map(|f| f.position)
                .collect::<Vec<_>>(),
            [0, 1, 2, 3]
        );
    }

    #[test]
    fn deleting_a_middle_frame_renumbers_and_the_last_one_is_refused() {
        let (mut store, _, hero) = hero();
        store.frame_add(hero, true).unwrap();
        let animation = store.frame_add(hero, true).unwrap();
        let [_, middle, last] = ids(&animation)[..] else {
            panic!("three frames")
        };
        let animation = store.frame_delete(middle).unwrap();
        assert_eq!(ids(&animation), [hero, last]);
        assert_eq!(names(&animation), ["hero", "hero #2"]);
        assert!(store.asset_read(middle).is_err());
        let animation = store.frame_delete(last).unwrap();
        assert_eq!(ids(&animation), [hero]);
        assert_eq!(rows(&store), (0, 0));
        assert_eq!(
            store.frame_delete(hero).unwrap_err().code,
            "animation.last_frame"
        );
        assert_eq!(store.asset_read(hero).unwrap().name, "hero");
    }

    #[test]
    fn deleting_the_root_promotes_the_next_frame_under_the_animation_name() {
        let (mut store, _, hero) = hero();
        store.frame_add(hero, true).unwrap();
        let animation = store.frame_add_as(hero, true, "user").unwrap();
        store.animation_set_playback(hero, "pingpong").unwrap();
        store
            .frame_set_duration(animation.frames[1].asset_id, 300)
            .unwrap();
        let [_, next, last] = ids(&animation)[..] else {
            panic!("three frames")
        };
        let animation = store.frame_delete(hero).unwrap();
        assert_eq!(animation.root_id, next);
        assert_eq!(ids(&animation), [next, last]);
        assert_eq!(names(&animation), ["hero", "hero #2"]);
        assert_eq!(animation.playback, "pingpong");
        assert_eq!(animation.frames[0].duration_ms, 300);
        assert_eq!(store.animation_read(last).unwrap().root_id, next);
        assert_eq!(store.asset_read(last).unwrap().root_id, Some(next));
    }

    #[test]
    fn moving_a_frame_reorders_renames_and_can_change_the_root() {
        let (mut store, _, hero) = hero();
        store.frame_add(hero, true).unwrap();
        let animation = store.frame_add(hero, true).unwrap();
        let [_, b, c] = ids(&animation)[..] else {
            panic!("three frames")
        };
        // Past the end is clamped to the last position.
        let animation = store.frame_move(hero, 99).unwrap();
        assert_eq!(ids(&animation), [b, c, hero]);
        assert_eq!(animation.root_id, b);
        assert_eq!(names(&animation), ["hero", "hero #2", "hero #3"]);
        assert_eq!(store.asset_read(hero).unwrap().root_id, Some(b));
        assert_eq!(store.asset_read(b).unwrap().frames, 3);
        let animation = store.frame_move(hero, 0).unwrap();
        assert_eq!(ids(&animation), [hero, b, c]);
        assert_eq!(names(&animation), ["hero", "hero #2", "hero #3"]);
        // A lone asset has nowhere to move to.
        let (mut lone, _, sprite) = self::hero();
        assert_eq!(ids(&lone.frame_move(sprite, 3).unwrap()), [sprite]);
    }

    #[test]
    fn durations_are_bounded_and_set_per_frame_or_for_all() {
        let (mut store, _, hero) = hero();
        let second = store.frame_add(hero, true).unwrap().frames[1].asset_id;
        for bad in [0, 9, 10_001] {
            assert_eq!(
                store.frame_set_duration(second, bad).unwrap_err().code,
                "animation.invalid_duration"
            );
            assert_eq!(
                store.animation_set_duration(hero, bad).unwrap_err().code,
                "animation.invalid_duration"
            );
        }
        let animation = store.frame_set_duration(second, 10).unwrap();
        assert_eq!(
            animation
                .frames
                .iter()
                .map(|f| f.duration_ms)
                .collect::<Vec<_>>(),
            [125, 10]
        );
        let animation = store.animation_set_duration(second, 10_000).unwrap();
        assert!(animation.frames.iter().all(|f| f.duration_ms == 10_000));
        // A copy is timed like the frame it was copied from.
        let animation = store.frame_add(second, true).unwrap();
        assert_eq!(animation.frames[2].duration_ms, 10_000);
    }

    #[test]
    fn playback_must_be_one_of_the_three_modes() {
        let (mut store, _, hero) = hero();
        store.frame_add(hero, true).unwrap();
        assert_eq!(
            store
                .animation_set_playback(hero, "shuffle")
                .unwrap_err()
                .code,
            "animation.invalid_playback"
        );
        for mode in PLAYBACKS {
            assert_eq!(
                store.animation_set_playback(hero, mode).unwrap().playback,
                mode
            );
        }
    }

    #[test]
    fn a_palette_write_lands_on_every_frame_and_undoes_per_frame() {
        let (mut store, _, hero) = hero();
        let second = store.frame_add(hero, true).unwrap().frames[1].asset_id;
        let before = store.palette_read(hero).unwrap();
        let after = palette([200, 10, 10, 255]);
        let (_, touched) = store
            .palette_write_frames_as(second, after.clone(), "agent:s-1")
            .unwrap();
        assert_eq!(
            touched.iter().map(|(id, _)| *id).collect::<Vec<_>>(),
            [hero, second]
        );
        for frame in [hero, second] {
            assert_eq!(store.palette_read(frame).unwrap(), after);
            let last = store.op_log(frame).unwrap().pop().unwrap();
            assert_eq!(
                (last.kind.as_str(), last.actor.as_str()),
                ("palette_write", "agent:s-1")
            );
        }
        store.undo(second, "user").unwrap();
        assert_eq!(store.palette_read(second).unwrap(), before);
        assert_eq!(store.palette_read(hero).unwrap(), after);
        // The plain writer fans out too, and returns the frame's own result.
        let (_, result) = store.palette_write(hero, before.clone()).unwrap();
        assert_eq!(result.seq, store.op_log(hero).unwrap().pop().unwrap().seq);
        assert_eq!(store.palette_read(second).unwrap(), before);
    }

    #[test]
    fn a_palette_write_one_frame_cannot_take_is_refused_on_every_frame() {
        let (mut store, _, hero) = hero();
        let second = store.frame_add(hero, false).unwrap().frames[1].asset_id;
        // The root paints slot 1; the blank frame does not. Dropping the slot
        // must fail as a whole rather than leave the frames disagreeing.
        assert_eq!(
            store.palette_delete(second).unwrap_err().code,
            "palette.unknown_slot"
        );
        assert_eq!(
            store.palette_read(second).unwrap(),
            store.palette_read(hero).unwrap()
        );
    }

    #[test]
    fn the_asset_list_shows_roots_with_their_count_and_frames_with_their_root() {
        let (mut store, project, hero) = hero();
        let rock = store
            .asset_create(project, "rock", "prop", 4, 4)
            .unwrap()
            .id;
        store.frame_add(hero, true).unwrap();
        let second = store.frame_add(hero, true).unwrap().frames[1].asset_id;
        let list = store.asset_list(project).unwrap();
        let find = |id: AssetId| list.iter().find(|a| a.id == id).unwrap();
        assert_eq!((find(hero).root_id, find(hero).frames), (None, 3));
        assert_eq!((find(second).root_id, find(second).frames), (Some(hero), 0));
        assert_eq!((find(rock).root_id, find(rock).frames), (None, 1));
        let wire = serde_json::to_value(find(second)).unwrap();
        assert_eq!(wire["rootId"], serde_json::json!(hero.0));
        assert_eq!(wire["frames"], 0);
    }

    #[test]
    fn deleting_a_root_asset_deletes_every_frame_and_a_later_frame_alone() {
        let (mut store, project, hero) = hero();
        let rock = store
            .asset_create(project, "rock", "prop", 4, 4)
            .unwrap()
            .id;
        store.frame_add(hero, true).unwrap();
        let animation = store.frame_add(hero, true).unwrap();
        store.asset_delete(animation.frames[2].asset_id).unwrap();
        assert_eq!(store.animation_read(hero).unwrap().frames.len(), 2);
        store.asset_delete(hero).unwrap();
        let left: Vec<AssetId> = store
            .asset_list(project)
            .unwrap()
            .into_iter()
            .map(|a| a.id)
            .collect();
        assert_eq!(left, [rock]);
        assert_eq!(rows(&store), (0, 0));
    }

    #[test]
    fn renaming_the_root_renames_its_frames_and_a_later_frame_is_refused() {
        let (mut store, _, hero) = hero();
        store.frame_add(hero, true).unwrap();
        let second = store.frame_add(hero, true).unwrap().frames[1].asset_id;
        assert_eq!(
            store.asset_rename(second, "other").unwrap_err().code,
            "animation.frame_name"
        );
        // The new root name may even be one of the old frame names.
        store.asset_rename(hero, "hero #2").unwrap();
        assert_eq!(
            names(&store.animation_read(hero).unwrap()),
            ["hero #2", "hero #2 #2", "hero #2 #3"]
        );
        store.undo(hero, "user").unwrap();
        assert_eq!(
            names(&store.animation_read(hero).unwrap()),
            ["hero", "hero #2", "hero #3"]
        );
    }

    #[test]
    fn frames_share_the_root_style() {
        let (mut store, project, hero) = hero();
        let second = store.frame_add(hero, true).unwrap().frames[1].asset_id;
        let style = store
            .style_create(
                Some(project),
                "terse",
                "custom",
                crate::raster::StyleRules::default(),
            )
            .unwrap();
        store.asset_set_style(second, Some(style.id)).unwrap();
        assert_eq!(store.asset_read(hero).unwrap().style_id, Some(style.id));
        let third = store.frame_add(hero, true).unwrap().frames[1].asset_id;
        assert_eq!(store.asset_read(third).unwrap().style_id, Some(style.id));
    }

    fn create(store: &mut Store, project: Uuid, name: &str) -> Result<AssetId> {
        Ok(store.asset_create(project, name, "prop", 4, 4)?.id)
    }
    fn asset_count(store: &Store) -> i64 {
        store
            .connection
            .query_row("SELECT COUNT(*) FROM asset", [], |r| r.get(0))
            .unwrap()
    }

    #[test]
    fn a_derived_name_another_asset_holds_is_refused_before_anything_is_written() {
        let (mut store, project, hero) = hero();
        create(&mut store, project, "hero #2").unwrap();
        let count = asset_count(&store);
        let error = store.frame_add(hero, true).unwrap_err();
        assert_eq!(
            (error.code.as_str(), error.detail.as_str()),
            ("animation.name_taken", "hero #2")
        );
        assert_eq!(asset_count(&store), count);
        assert_eq!(rows(&store), (0, 0));

        // Renaming an animated root onto a name whose frames are taken.
        let (mut store, project, hero) = self::hero();
        store.frame_add(hero, true).unwrap();
        create(&mut store, project, "cat #2").unwrap();
        let error = store.asset_rename(hero, "cat").unwrap_err();
        assert_eq!(
            (error.code.as_str(), error.detail.as_str()),
            ("animation.name_taken", "cat #2")
        );
        assert_eq!(
            names(&store.animation_read(hero).unwrap()),
            ["hero", "hero #2"]
        );
    }

    #[test]
    fn undoing_a_rename_onto_taken_frame_names_is_refused_and_consumes_nothing() {
        let (mut store, project, hero) = hero();
        store.asset_rename(hero, "knight").unwrap();
        store.frame_add(hero, true).unwrap();
        // "hero" is no animation's root now, so "hero #2" is free to take.
        create(&mut store, project, "hero #2").unwrap();
        let log = store.op_log(hero).unwrap().len();
        let error = store.undo(hero, "user").unwrap_err();
        assert_eq!(
            (error.code.as_str(), error.detail.as_str()),
            ("animation.name_taken", "hero #2")
        );
        assert_eq!(store.op_log(hero).unwrap().len(), log);
        assert_eq!(
            names(&store.animation_read(hero).unwrap()),
            ["knight", "knight #2"]
        );
    }

    #[test]
    fn a_name_an_animation_derives_is_reserved_for_its_frames() {
        let (mut store, project, hero) = hero();
        store.frame_add(hero, true).unwrap();
        let rock = create(&mut store, project, "rock").unwrap();
        for reserved in ["hero #3", "hero #99"] {
            let error = create(&mut store, project, reserved).unwrap_err();
            assert_eq!(
                (error.code.as_str(), error.detail.as_str()),
                ("animation.name_taken", reserved)
            );
            assert_eq!(
                store.asset_rename(rock, reserved).unwrap_err().code,
                "animation.name_taken"
            );
        }
        // Only the form a frame could be named is reserved.
        for free in ["hero #1", "hero #02", "hero #x", "hero#3"] {
            create(&mut store, project, free).unwrap();
        }
        // Another project's animation reserves nothing here.
        let other = store.project_create("other", "hd2d").unwrap().id;
        create(&mut store, other, "hero #3").unwrap();
    }

    #[test]
    fn a_root_name_too_long_to_number_is_an_invalid_name() {
        let (mut store, _, hero) = hero();
        store.frame_add(hero, true).unwrap();
        let long = "x".repeat(1022);
        assert_eq!(
            store.asset_rename(hero, &long).unwrap_err().code,
            "document.invalid_name"
        );
        assert_eq!(store.asset_read(hero).unwrap().name, "hero");
        // A lone asset may take it, and then cannot gain frames.
        let (mut lone, _, sprite) = self::hero();
        lone.asset_rename(sprite, &long).unwrap();
        assert_eq!(
            lone.frame_add(sprite, true).unwrap_err().code,
            "document.invalid_name"
        );
    }

    #[test]
    fn backgrounds_and_tilesets_cannot_be_animated() {
        let (mut store, project, _) = hero();
        for kind in ["background", "tileset"] {
            let id = store.asset_create(project, kind, kind, 16, 16).unwrap().id;
            assert_eq!(
                store.frame_add(id, true).unwrap_err().code,
                "animation.unsupported_kind"
            );
        }
        assert_eq!(rows(&store), (0, 0));
    }

    #[test]
    fn undoing_a_style_on_one_frame_restyles_every_frame() {
        let (mut store, project, hero) = hero();
        let second = store.frame_add(hero, true).unwrap().frames[1].asset_id;
        let style = store
            .style_create(
                Some(project),
                "terse",
                "custom",
                crate::raster::StyleRules::default(),
            )
            .unwrap();
        let hero_log = store.op_log(hero).unwrap().len();
        store.asset_set_style(second, Some(style.id)).unwrap();
        // Logged on the frame it was set on only.
        assert_eq!(store.op_log(hero).unwrap().len(), hero_log);
        store.undo(second, "user").unwrap();
        for frame in [hero, second] {
            assert_eq!(store.asset_read(frame).unwrap().style_id, None);
        }
        store.redo(second, "user").unwrap();
        for frame in [hero, second] {
            assert_eq!(store.asset_read(frame).unwrap().style_id, Some(style.id));
        }
    }

    #[test]
    fn a_rename_made_as_root_is_refused_while_the_asset_is_a_later_frame() {
        let (mut store, _, hero) = hero();
        store.asset_rename(hero, "knight").unwrap();
        store.frame_add(hero, true).unwrap();
        store.frame_move(hero, 1).unwrap();
        let log = store.op_log(hero).unwrap().len();
        assert_eq!(
            store.undo(hero, "user").unwrap_err().code,
            "history.not_root"
        );
        assert_eq!(store.op_log(hero).unwrap().len(), log);
        // The step is still there once the frame leads again.
        store.frame_move(hero, 0).unwrap();
        store.undo(hero, "user").unwrap();
        assert_eq!(
            names(&store.animation_read(hero).unwrap()),
            ["hero", "hero #2"]
        );
    }

    #[test]
    fn only_the_frames_a_change_renamed_have_their_updated_at_bumped() {
        let (mut store, _, hero) = hero();
        store.frame_add(hero, true).unwrap();
        let animation = store.frame_add(hero, true).unwrap();
        let [_, b, c] = ids(&animation)[..] else {
            panic!("three frames")
        };
        store
            .connection
            .execute("UPDATE asset SET updated_at=0", [])
            .unwrap();
        store.frame_move(c, 1).unwrap();
        let updated = |id| store.asset_read(id).unwrap().updated_at;
        assert_eq!(updated(hero), 0);
        assert!(updated(b) > 0 && updated(c) > 0);
    }

    #[test]
    fn timing_set_on_a_lone_asset_is_kept_until_it_is_the_default_again() {
        let (mut store, _, hero) = hero();
        let animation = store.animation_set_playback(hero, "pingpong").unwrap();
        assert_eq!(animation.playback, "pingpong");
        let animation = store.frame_set_duration(hero, 300).unwrap();
        assert_eq!(animation.frames[0].duration_ms, 300);
        assert_eq!(rows(&store), (1, 1));
        let asset = store.asset_read(hero).unwrap();
        assert_eq!((asset.root_id, asset.frames), (None, 1));
        // Renaming still works with the rows in place, and the timing is
        // what the next frame starts from.
        store.asset_rename(hero, "knight").unwrap();
        let animation = store.frame_add(hero, true).unwrap();
        assert_eq!(names(&animation), ["knight", "knight #2"]);
        assert_eq!(animation.frames[1].duration_ms, 300);
        assert_eq!(animation.playback, "pingpong");
        // Back down to one frame: non-default timing keeps the rows...
        store.frame_delete(animation.frames[1].asset_id).unwrap();
        assert_eq!(rows(&store), (1, 1));
        assert_eq!(
            store.animation_read(hero).unwrap().frames[0].duration_ms,
            300
        );
        // ...and the defaults drop them.
        store
            .animation_set_duration(hero, DEFAULT_DURATION_MS)
            .unwrap();
        assert_eq!(rows(&store), (1, 1));
        store.animation_set_playback(hero, "forward").unwrap();
        assert_eq!(rows(&store), (0, 0));
        store
            .animation_set_duration(hero, DEFAULT_DURATION_MS)
            .unwrap();
        assert_eq!(rows(&store), (0, 0));
    }
}

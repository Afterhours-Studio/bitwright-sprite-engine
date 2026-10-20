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

// Ported from claude-pxl, MIT, Copyright (c) 2026 crsolver

//! Turns "fake" pixel art (an AI image, or a picture that was scaled up, whose
//! pixels are blurry, uneven blocks) into real pixels: remove the background,
//! find the block grid, sample one colour per block, snap to a palette and
//! clean up stray pixels.
//!
//! The steps run in this order, and the order matters:
//!
//! 1. Background: the dominant border colour is flooded from the border, then
//!    removed everywhere as a chroma key, fringe included.
//! 2. Detached bits are dropped before the grid is measured, because a speck
//!    off the subject's grid shifts the phase.
//! 3. The grid is detected at a fractional pitch (7.5 px, 19.5 px): an
//!    edge-energy profile, lightly blurred, autocorrelated, refined to
//!    sub-pixel, then a phase.
//! 4. One colour per block: the most common 5-bit bucket in the inner 60%.
//! 5. Colours are reduced (k-means in OKLab) or snapped to a given palette.
//! 6. Specks go, but only pixels whose four neighbours all share one other
//!    colour, so 1 px tips and lone accents stay.
//!
//! Pixels are packed `0xRRGGBBAA`; `0` is fully transparent.

use std::collections::HashMap;

use super::color::srgb_to_oklab;
use super::{RasterError, Result};

/// A packed `0xRRGGBBAA` pixel. `CLEAR` is the only transparent value.
pub type Px = u32;

/// The one transparent pixel.
pub const CLEAR: Px = 0;

/// The longest block the grid detector will look for.
const MAX_CELL: usize = 64;

type Lab = [f32; 3];

/// A pixel grid the pipeline works on.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Img {
    pub w: usize,
    pub h: usize,
    pub data: Vec<Px>,
}

impl Img {
    pub fn new(w: usize, h: usize) -> Self {
        Self {
            w,
            h,
            data: vec![CLEAR; w * h],
        }
    }

    /// The pixel at a position, `CLEAR` outside the image.
    pub fn get(&self, x: i64, y: i64) -> Px {
        if x < 0 || y < 0 || x >= self.w as i64 || y >= self.h as i64 {
            CLEAR
        } else {
            self.data[y as usize * self.w + x as usize]
        }
    }

    /// Packs an 8-bit RGBA image, the way a decoded PNG arrives.
    pub fn from_rgba(w: usize, h: usize, rgba: &[u8]) -> Self {
        let data = rgba
            .chunks_exact(4)
            .map(|p| {
                (u32::from(p[0]) << 24)
                    | (u32::from(p[1]) << 16)
                    | (u32::from(p[2]) << 8)
                    | u32::from(p[3])
            })
            .collect();
        Self { w, h, data }
    }
}

/// What to do about the background.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Background {
    /// The dominant border colour.
    Auto,
    /// This colour.
    Key(Px),
    /// Keep everything.
    Keep,
}

#[derive(Debug, Clone)]
pub struct Options {
    pub background: Background,
    /// Also remove background-coloured pixels the subject encloses.
    pub bg_global: bool,
    /// RGB distance (0..441) under which a pixel counts as background.
    pub bg_tolerance: f64,
    /// The size of one source block; `None` detects it.
    pub cell: Option<f64>,
    /// The art is scaled down, keeping its aspect, to fit this box.
    pub fit: Option<(usize, usize)>,
    /// A fixed palette to snap to, as `[r, g, b]`.
    pub palette: Option<Vec<[u8; 3]>>,
    /// Otherwise reduce to at most this many colours.
    pub colors: usize,
    /// Passes of speck removal.
    pub clean: u32,
    /// Repaint the silhouette edge in the darkest palette colour.
    pub outline: bool,
    /// Edge pixels up to this much lighter (OKLab L) than the line colour
    /// count as already being outline.
    pub outline_dark: f32,
    /// Pixels with alpha below this become transparent.
    pub alpha_cut: u8,
    /// Keep only the largest 8-connected shape.
    pub main_only: bool,
}

impl Default for Options {
    fn default() -> Self {
        Self {
            background: Background::Auto,
            bg_global: true,
            bg_tolerance: 48.0,
            cell: None,
            fit: None,
            palette: None,
            colors: 32,
            clean: 2,
            outline: false,
            outline_dark: 0.12,
            alpha_cut: 128,
            main_only: false,
        }
    }
}

#[derive(Debug, Clone)]
pub struct Pixelized {
    pub img: Img,
    /// The block size detected (or given) in the source image.
    pub cell: f64,
    /// The size after grid sampling, before any fitting.
    pub native: (usize, usize),
    /// The colours the result uses.
    pub palette: Vec<Px>,
}

// ---------------------------------------------------------------- colour math

fn channels(c: Px) -> [u8; 3] {
    [(c >> 24) as u8, (c >> 16) as u8, (c >> 8) as u8]
}

pub fn pack(r: u8, g: u8, b: u8) -> Px {
    (u32::from(r) << 24) | (u32::from(g) << 16) | (u32::from(b) << 8) | 255
}

fn opaque(c: Px) -> Px {
    let [r, g, b] = channels(c);
    pack(r, g, b)
}

fn oklab(c: Px) -> Lab {
    let [r, g, b] = channels(c);
    srgb_to_oklab([r, g, b, 255])
}

fn lab_dist(a: Lab, b: Lab) -> f32 {
    (a[0] - b[0]).powi(2) + (a[1] - b[1]).powi(2) + (a[2] - b[2]).powi(2)
}

fn rgb_dist(a: Px, b: Px) -> f64 {
    let [r1, g1, b1] = channels(a);
    let [r2, g2, b2] = channels(b);
    (f64::from(r1) - f64::from(r2)).powi(2)
        + (f64::from(g1) - f64::from(g2)).powi(2)
        + (f64::from(b1) - f64::from(b2)).powi(2)
}

/// Like [`rgb_dist`] but already square-rooted.
fn rgb_distance(a: Px, b: Px) -> f64 {
    rgb_dist(a, b).sqrt()
}

/// Bucket key: 5 bits per channel, so near-identical shades vote together.
fn bucket(c: Px) -> u32 {
    let [r, g, b] = channels(c);
    (u32::from(r >> 3) << 10) | (u32::from(g >> 3) << 5) | u32::from(b >> 3)
}

/// Counts in first-seen order, so ties resolve the way the reference does:
/// the colour that appeared first wins.
struct Tally<K: std::hash::Hash + Eq + Copy, V> {
    index: HashMap<K, usize>,
    items: Vec<(K, V)>,
}

impl<K: std::hash::Hash + Eq + Copy, V> Tally<K, V> {
    fn new() -> Self {
        Self {
            index: HashMap::new(),
            items: Vec::new(),
        }
    }

    fn entry(&mut self, key: K, init: impl FnOnce() -> V) -> &mut V {
        let at = *self.index.entry(key).or_insert_with(|| {
            self.items.push((key, init()));
            self.items.len() - 1
        });
        &mut self.items[at].1
    }
}

// ---------------------------------------------------------------- steps

fn remove_background(img: &mut Img, background: Background, tol: f64, global: bool) {
    let (w, h) = (img.w, img.h);
    let key = match background {
        Background::Keep => return,
        Background::Key(c) => c,
        Background::Auto => {
            let mut votes: Tally<u32, (u32, Px)> = Tally::new();
            let mut vote = |c: Px| {
                if c != CLEAR {
                    votes.entry(bucket(c), || (0, c)).0 += 1;
                }
            };
            for x in 0..w {
                vote(img.data[x]);
                vote(img.data[(h - 1) * w + x]);
            }
            for y in 0..h {
                vote(img.data[y * w]);
                vote(img.data[y * w + w - 1]);
            }
            let mut best: Option<(u32, Px)> = None;
            for (_, (n, c)) in &votes.items {
                if best.map_or(true, |(bn, _)| *n > bn) {
                    best = Some((*n, *c));
                }
            }
            match best {
                Some((_, c)) => c,
                None => return,
            }
        }
    };

    // Flood from the border so background-coloured pixels inside the subject
    // survive this pass.
    let mut seen = vec![false; w * h];
    let mut stack: Vec<usize> = Vec::new();
    let push = |i: usize, seen: &mut Vec<bool>, stack: &mut Vec<usize>| {
        if !seen[i] {
            seen[i] = true;
            stack.push(i);
        }
    };
    for x in 0..w {
        push(x, &mut seen, &mut stack);
        push((h - 1) * w + x, &mut seen, &mut stack);
    }
    for y in 0..h {
        push(y * w, &mut seen, &mut stack);
        push(y * w + w - 1, &mut seen, &mut stack);
    }
    while let Some(i) = stack.pop() {
        let c = img.data[i];
        if c != CLEAR && rgb_distance(c, key) > tol {
            continue;
        }
        img.data[i] = CLEAR;
        let (x, y) = (i % w, i / w);
        if x > 0 {
            push(i - 1, &mut seen, &mut stack);
        }
        if x + 1 < w {
            push(i + 1, &mut seen, &mut stack);
        }
        if y > 0 {
            push(i - w, &mut seen, &mut stack);
        }
        if y + 1 < h {
            push(i + w, &mut seen, &mut stack);
        }
    }
    if !global {
        return;
    }
    // Chroma key: the same colour enclosed by the subject (gaps between arm
    // and body) goes too, and so do fringe pixels tinted toward the key next to
    // removed ones.
    for p in img.data.iter_mut() {
        if *p != CLEAR && rgb_distance(*p, key) <= tol {
            *p = CLEAR;
        }
    }
    for _ in 0..2 {
        let src = img.data.clone();
        for i in 0..src.len() {
            if src[i] == CLEAR || rgb_distance(src[i], key) > tol * 2.5 {
                continue;
            }
            let (x, y) = (i % w, i / w);
            let left = x > 0 && src[i - 1] == CLEAR;
            let right = x + 1 < w && src[i + 1] == CLEAR;
            let up = y > 0 && src[i - w] == CLEAR;
            let down = y + 1 < h && src[i + w] == CLEAR;
            if left || right || up || down {
                img.data[i] = CLEAR;
            }
        }
    }
}

/// The box around every non-transparent pixel: `(x, y, w, h)`.
fn bounds(img: &Img) -> Option<(usize, usize, usize, usize)> {
    let (mut x0, mut y0, mut x1, mut y1) = (img.w, img.h, 0usize, 0usize);
    let mut any = false;
    for y in 0..img.h {
        for x in 0..img.w {
            if img.data[y * img.w + x] != CLEAR {
                any = true;
                x0 = x0.min(x);
                x1 = x1.max(x);
                y0 = y0.min(y);
                y1 = y1.max(y);
            }
        }
    }
    any.then(|| (x0, y0, x1 - x0 + 1, y1 - y0 + 1))
}

fn crop(img: &Img, (x0, y0, w, h): (usize, usize, usize, usize)) -> Img {
    let mut out = Img::new(w, h);
    for y in 0..h {
        for x in 0..w {
            out.data[y * w + x] = img.data[(y + y0) * img.w + x + x0];
        }
    }
    out
}

/// Edge strength between column x-1 and x (or row y-1 and y), summed along it.
fn edge_profile(img: &Img, horizontal: bool) -> Vec<f64> {
    let (n, m) = if horizontal {
        (img.w, img.h)
    } else {
        (img.h, img.w)
    };
    let mut prof = vec![0.0; n];
    #[allow(clippy::needless_range_loop)]
    for i in 1..n {
        let mut s = 0.0;
        for j in 0..m {
            let (a, b) = if horizontal {
                (img.data[j * img.w + i - 1], img.data[j * img.w + i])
            } else {
                (img.data[(i - 1) * img.w + j], img.data[i * img.w + j])
            };
            if a == CLEAR && b == CLEAR {
                continue;
            }
            s += if a == CLEAR || b == CLEAR {
                255.0
            } else {
                rgb_distance(a, b)
            };
        }
        prof[i] = s;
    }
    prof
}

fn autocorr(p: &[f64], s: usize) -> f64 {
    let mean = p.iter().sum::<f64>() / p.len() as f64;
    let (mut num, mut den) = (0.0, 0.0);
    for i in 0..p.len() {
        let d = p[i] - mean;
        den += d * d;
        if i + s < p.len() {
            num += d * (p[i + s] - mean);
        }
    }
    if den == 0.0 {
        0.0
    } else {
        num / den
    }
}

/// Grid offset in `[0, cell)`: where the grid lines carry the most edge energy.
fn phase(p: &[f64], cell: f64) -> f64 {
    let (mut best_offset, mut best_sum) = (0.0, -1.0);
    let mut o = 0.0;
    while o < cell {
        let mut sum = 0.0;
        let mut x = o;
        while x < p.len() as f64 {
            sum += p.get(x.round() as usize).copied().unwrap_or(0.0);
            x += cell;
        }
        if sum > best_sum {
            best_sum = sum;
            best_offset = o;
        }
        o += 0.25;
    }
    best_offset
}

/// The detected grid: the block size and where the grid starts.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Grid {
    pub cell: f64,
    pub ox: f64,
    pub oy: f64,
}

/// Block size of fake pixel art, which AI images draw at a fractional pitch
/// (19.5 px, 6.6 px). The first strong peak of the edge-profile
/// autocorrelation gives the pitch; peaks at its multiples refine it to
/// sub-pixel precision.
pub fn detect_cell(img: &Img) -> Grid {
    let none = Grid {
        cell: 1.0,
        ox: 0.0,
        oy: 0.0,
    };
    let px = edge_profile(img, true);
    let py = edge_profile(img, false);
    // A fractional pitch puts block edges alternately on neighbouring pixels
    // (7, 8, 7, 8 ...); a small blur lets those votes meet so the
    // autocorrelation peaks between them.
    let blur = |p: &[f64]| -> Vec<f64> {
        (0..p.len())
            .map(|i| {
                let v = p[i];
                let l = if i > 0 { p[i - 1] } else { v };
                let r = if i + 1 < p.len() { p[i + 1] } else { v };
                l * 0.25 + v * 0.5 + r * 0.25
            })
            .collect()
    };
    let (sx, sy) = (blur(&px), blur(&py));
    let lim = (MAX_CELL * 4).min(img.w.min(img.h) / 3);
    if lim < 3 {
        return none;
    }
    // Every lag the search can ask about, computed once.
    let mut table = vec![-1.0; lim + 2];
    for (s, slot) in table.iter_mut().enumerate().take(lim + 1).skip(1) {
        *slot = (autocorr(&sx, s) + autocorr(&sy, s)) / 2.0;
    }
    let ac = |s: i64| -> f64 {
        if s < 1 || s > lim as i64 {
            -1.0
        } else {
            table[s as usize]
        }
    };
    let top_search = MAX_CELL.min(lim) as i64;
    let mut top = -1.0_f64;
    for s in 2..=top_search {
        top = top.max(ac(s));
    }
    if top < 0.15 {
        return none;
    }
    // The first local maximum that is close to the best one.
    let mut base = 2_i64;
    for s in 2..=top_search {
        if ac(s) >= top * 0.6 && ac(s) >= ac(s - 1) && ac(s) >= ac(s + 1) {
            base = s;
            break;
        }
    }
    // Peak of the autocorrelation near `s`, refined with a parabola.
    let peak_near = |s: f64| -> (f64, f64) {
        let rounded = s.round() as i64;
        let mut bs = rounded.max(2);
        let mut bv = ac(bs);
        for t in (rounded - 2).max(2)..=(lim as i64).min(rounded + 2) {
            let v = ac(t);
            if v > bv {
                bv = v;
                bs = t;
            }
        }
        let (l, r) = (ac(bs - 1), ac(bs + 1));
        let den = l - 2.0 * bv + r;
        let off = if den < 0.0 {
            ((l - r) / (2.0 * den)).clamp(-0.5, 0.5)
        } else {
            0.0
        };
        (bs as f64 + off, bv)
    };
    let mut cell = peak_near(base as f64).0;
    let mut k = 2.0;
    while k * cell <= lim as f64 {
        let (pk, v) = peak_near(k * cell);
        if v < top * 0.4 {
            break;
        }
        cell = pk / k;
        k += 1.0;
    }
    Grid {
        cell,
        ox: phase(&px, cell),
        oy: phase(&py, cell),
    }
}

/// One colour per block: the most common bucket in the block's inner area.
fn sample_grid(img: &Img, grid: Grid, alpha_cut: u8) -> Img {
    let Grid { cell, ox, oy } = grid;
    let sx = ox - (ox / cell).ceil() * cell;
    let sy = oy - (oy / cell).ceil() * cell;
    let cols = ((img.w as f64 - sx) / cell).ceil() as usize;
    let rows = ((img.h as f64 - sy) / cell).ceil() as usize;
    let mut out = Img::new(cols, rows);
    let inset = cell * 0.2;
    for r in 0..rows {
        for c in 0..cols {
            let x0 = (sx + c as f64 * cell + inset).round() as i64;
            let x1 = (sx + (c + 1) as f64 * cell - inset).round() as i64;
            let y0 = (sy + r as f64 * cell + inset).round() as i64;
            let y1 = (sy + (r + 1) as f64 * cell - inset).round() as i64;
            let mut votes: Tally<u32, [u32; 4]> = Tally::new();
            let (mut clear, mut total) = (0u32, 0u32);
            for y in y0.max(0)..(img.h as i64).min(y1.max(y0 + 1)) {
                for x in x0.max(0)..(img.w as i64).min(x1.max(x0 + 1)) {
                    total += 1;
                    let p = img.data[y as usize * img.w + x as usize];
                    if p == CLEAR || (p & 255) < u32::from(alpha_cut) {
                        clear += 1;
                        continue;
                    }
                    let [pr, pg, pb] = channels(p);
                    let v = votes.entry(bucket(p), || [0; 4]);
                    v[0] += 1;
                    v[1] += u32::from(pr);
                    v[2] += u32::from(pg);
                    v[3] += u32::from(pb);
                }
            }
            if total == 0 || clear * 2 >= total || votes.items.is_empty() {
                continue;
            }
            let mut best = votes.items[0].1;
            for (_, v) in &votes.items {
                if v[0] > best[0] {
                    best = *v;
                }
            }
            let avg = |sum: u32| (f64::from(sum) / f64::from(best[0])).round() as u8;
            out.data[r * cols + c] = pack(avg(best[1]), avg(best[2]), avg(best[3]));
        }
    }
    out
}

/// Area resample to `w` x `h`. Each target pixel takes the most common colour
/// under it, but a dark colour covering a good share wins, so outlines and
/// eyes survive heavy reduction.
fn resample(img: &Img, w: usize, h: usize) -> Img {
    if w == img.w && h == img.h {
        return img.clone();
    }
    let mut out = Img::new(w, h);
    let fx = img.w as f64 / w as f64;
    let fy = img.h as f64 / h as f64;
    for y in 0..h {
        for x in 0..w {
            let (x0, x1) = (x as f64 * fx, (x + 1) as f64 * fx);
            let (y0, y1) = (y as f64 * fy, (y + 1) as f64 * fy);
            let mut votes: Tally<Px, f64> = Tally::new();
            let (mut clear, mut total) = (0.0, 0.0);
            for sy in (y0.floor() as i64)..(y1.ceil() as i64) {
                for sx in (x0.floor() as i64)..(x1.ceil() as i64) {
                    let wgt = ((sx as f64 + 1.0).min(x1) - (sx as f64).max(x0))
                        * ((sy as f64 + 1.0).min(y1) - (sy as f64).max(y0));
                    if wgt <= 0.0 {
                        continue;
                    }
                    total += wgt;
                    let p = img.get(sx, sy);
                    if p == CLEAR {
                        clear += wgt;
                        continue;
                    }
                    *votes.entry(p, || 0.0) += wgt;
                }
            }
            if votes.items.is_empty() || clear > total * 0.5 {
                continue;
            }
            let mut ranked: Vec<(Px, f64)> = votes.items.clone();
            ranked.sort_by(|a, b| b.1.total_cmp(&a.1));
            let mut pick = ranked[0].0;
            let pick_l = oklab(pick)[0];
            if let Some(dark) = ranked.iter().find(|(c, _)| oklab(*c)[0] < pick_l - 0.25) {
                if dark.1 >= total * 0.3 {
                    pick = dark.0;
                }
            }
            out.data[y * w + x] = pick;
        }
    }
    out
}

/// Counts of every opaque colour, most used first. Ties keep first-seen order.
fn colour_counts(img: &Img) -> Vec<(Px, u32)> {
    let mut counts: Tally<Px, u32> = Tally::new();
    for &p in &img.data {
        if p != CLEAR {
            *counts.entry(p, || 0) += 1;
        }
    }
    counts.items
}

/// k-means in OKLab, seeded from the most common colours.
pub fn reduce_colors(img: &Img, k: usize) -> Vec<Px> {
    let counts = colour_counts(img);
    if counts.len() <= k || k == 0 {
        return counts.into_iter().map(|(c, _)| c).collect();
    }
    let mut pts: Vec<(Lab, u32)> = counts.iter().map(|(c, n)| (oklab(*c), *n)).collect();
    // Farthest-point seeding, weighted towards frequent colours.
    pts.sort_by_key(|(_, n)| std::cmp::Reverse(*n));
    let mut cent: Vec<Lab> = vec![pts[0].0];
    let mut nearest: Vec<f32> = pts.iter().map(|(lab, _)| lab_dist(*lab, cent[0])).collect();
    while cent.len() < k {
        let (mut bi, mut bd) = (0usize, -1.0_f32);
        for (i, (_, n)) in pts.iter().enumerate() {
            let d = nearest[i] * (*n as f32).sqrt();
            if d > bd {
                bd = d;
                bi = i;
            }
        }
        let seed = pts[bi].0;
        cent.push(seed);
        for (i, (lab, _)) in pts.iter().enumerate() {
            nearest[i] = nearest[i].min(lab_dist(*lab, seed));
        }
    }
    let nearest_centroid = |lab: Lab, cent: &[Lab]| -> usize {
        let (mut bi, mut bd) = (0usize, f32::INFINITY);
        for (i, c) in cent.iter().enumerate() {
            let d = lab_dist(lab, *c);
            if d < bd {
                bd = d;
                bi = i;
            }
        }
        bi
    };
    for _ in 0..12 {
        let mut acc = vec![[0.0f32; 4]; cent.len()];
        for (lab, n) in &pts {
            let a = &mut acc[nearest_centroid(*lab, &cent)];
            let n = *n as f32;
            a[0] += lab[0] * n;
            a[1] += lab[1] * n;
            a[2] += lab[2] * n;
            a[3] += n;
        }
        for (i, a) in acc.iter().enumerate() {
            if a[3] > 0.0 {
                cent[i] = [a[0] / a[3], a[1] / a[3], a[2] / a[3]];
            }
        }
    }
    // Each cluster is represented by its most common real colour: colours stay
    // crisp rather than averaged to mud.
    let mut rep: Vec<Option<(Px, u32)>> = vec![None; cent.len()];
    for (c, n) in &counts {
        let bi = nearest_centroid(oklab(*c), &cent);
        if rep[bi].map_or(true, |(_, best)| *n > best) {
            rep[bi] = Some((*c, *n));
        }
    }
    let mut out: Vec<Px> = Vec::new();
    for (c, _) in rep.into_iter().flatten() {
        if !out.contains(&c) {
            out.push(c);
        }
    }
    out
}

/// Snaps every opaque pixel to its nearest palette colour in OKLab.
fn snap(img: &mut Img, palette: &[Px]) {
    if palette.is_empty() {
        return;
    }
    let labs: Vec<Lab> = palette.iter().map(|c| oklab(*c)).collect();
    let mut memo: HashMap<Px, Px> = HashMap::new();
    for p in img.data.iter_mut() {
        if *p == CLEAR {
            continue;
        }
        let m = *memo.entry(*p).or_insert_with(|| {
            let lab = oklab(*p);
            let (mut bi, mut bd) = (0usize, f32::INFINITY);
            for (j, l) in labs.iter().enumerate() {
                let d = lab_dist(lab, *l);
                if d < bd {
                    bd = d;
                    bi = j;
                }
            }
            opaque(palette[bi])
        });
        *p = m;
    }
}

/// Removes specks: a pixel whose four neighbours all share one other colour
/// takes that colour. Lone accents (eyes, glints) and 1 px tips (fingers, hair
/// ends, sword points) have at least one differing neighbour and stay.
fn cleanup(img: &mut Img, passes: u32) {
    let (w, h) = (img.w, img.h);
    for _ in 0..passes {
        let src = img.data.clone();
        let mut changed = 0;
        for y in 0..h {
            for x in 0..w {
                let c = src[y * w + x];
                let nb = [
                    if x > 0 { src[y * w + x - 1] } else { CLEAR },
                    if x + 1 < w { src[y * w + x + 1] } else { CLEAR },
                    if y > 0 { src[(y - 1) * w + x] } else { CLEAR },
                    if y + 1 < h {
                        src[(y + 1) * w + x]
                    } else {
                        CLEAR
                    },
                ];
                if nb.contains(&c) {
                    continue;
                }
                if nb.iter().all(|n| *n == nb[0]) {
                    img.data[y * w + x] = nb[0];
                    changed += 1;
                }
            }
        }
        if changed == 0 {
            break;
        }
    }
}

/// Clears every opaque pixel not 8-connected to the largest opaque region.
fn keep_largest(img: &mut Img) {
    let (w, h) = (img.w, img.h);
    let mut label = vec![-1i32; w * h];
    let mut sizes: Vec<usize> = Vec::new();
    for i in 0..img.data.len() {
        if img.data[i] == CLEAR || label[i] >= 0 {
            continue;
        }
        let id = sizes.len() as i32;
        let mut stack = vec![i];
        label[i] = id;
        let mut n = 0;
        while let Some(j) = stack.pop() {
            n += 1;
            let (x, y) = ((j % w) as i64, (j / w) as i64);
            for dy in -1..=1 {
                for dx in -1..=1 {
                    let (nx, ny) = (x + dx, y + dy);
                    if nx < 0 || ny < 0 || nx >= w as i64 || ny >= h as i64 {
                        continue;
                    }
                    let k = ny as usize * w + nx as usize;
                    if img.data[k] != CLEAR && label[k] < 0 {
                        label[k] = id;
                        stack.push(k);
                    }
                }
            }
        }
        sizes.push(n);
    }
    if sizes.len() < 2 {
        return;
    }
    let mut keep = 0;
    for (i, n) in sizes.iter().enumerate() {
        if *n > sizes[keep] {
            keep = i;
        }
    }
    for (pixel, id) in img.data.iter_mut().zip(&label) {
        if *id >= 0 && *id != keep as i32 {
            *pixel = CLEAR;
        }
    }
}

/// An even 1 px outline in one colour. Dark silhouette-edge pixels (already
/// outline, in whatever dark shade the source used) become `color`; where the
/// edge is light the outline is added outside instead, so no coloured pixel is
/// lost. Returns the image grown by 1 px on each side.
fn outline_edge(img: &Img, color: Px, dark_l: f32) -> Img {
    let (w, h) = (img.w + 2, img.h + 2);
    let mut out = Img::new(w, h);
    for y in 0..img.h {
        for x in 0..img.w {
            out.data[(y + 1) * w + x + 1] = img.data[y * img.w + x];
        }
    }
    let src = out.data.clone();
    let mut lightness: HashMap<Px, f32> = HashMap::new();
    let mut light = |c: Px| *lightness.entry(c).or_insert_with(|| oklab(c)[0]);
    let at = |x: i64, y: i64| -> Px {
        if x < 0 || y < 0 || x >= w as i64 || y >= h as i64 {
            CLEAR
        } else {
            src[y as usize * w + x as usize]
        }
    };
    const N: [(i64, i64); 4] = [(-1, 0), (1, 0), (0, -1), (0, 1)];
    for y in 0..h as i64 {
        for x in 0..w as i64 {
            let c = src[y as usize * w + x as usize];
            if c == CLEAR {
                continue;
            }
            let open: Vec<(i64, i64)> = N
                .iter()
                .copied()
                .filter(|(dx, dy)| at(x + dx, y + dy) == CLEAR)
                .collect();
            if open.is_empty() {
                continue;
            }
            if light(c) <= dark_l {
                out.data[y as usize * w + x as usize] = color;
            } else {
                for (dx, dy) in open {
                    out.data[(y + dy) as usize * w + (x + dx) as usize] = color;
                }
            }
        }
    }
    out
}

/// Keeps the line colour for lines: the outline plus thin inner contour lines
/// stay; where the line colour is used as a fill (a 2x2 block of it that is not
/// on the silhouette edge) those pixels take the closest other palette colour.
fn reserve_line(img: &mut Img, color: Px, palette: &[Px]) {
    let (w, h) = (img.w, img.h);
    let src = img.data.clone();
    let others: Vec<Px> = palette.iter().copied().filter(|c| *c != color).collect();
    if others.is_empty() {
        return;
    }
    let lc = oklab(color);
    let mut sub = others[0];
    for c in &others[1..] {
        if lab_dist(oklab(*c), lc) < lab_dist(oklab(sub), lc) {
            sub = *c;
        }
    }
    let is = |x: usize, y: usize| src[y * w + x] == color;
    let clear = |x: i64, y: i64| {
        x < 0
            || y < 0
            || x >= w as i64
            || y >= h as i64
            || src[y as usize * w + x as usize] == CLEAR
    };
    let mut fill = vec![false; w * h];
    for y in 0..h.saturating_sub(1) {
        for x in 0..w.saturating_sub(1) {
            if is(x, y) && is(x + 1, y) && is(x, y + 1) && is(x + 1, y + 1) {
                fill[y * w + x] = true;
                fill[y * w + x + 1] = true;
                fill[(y + 1) * w + x] = true;
                fill[(y + 1) * w + x + 1] = true;
            }
        }
    }
    for y in 0..h {
        for x in 0..w {
            let (xi, yi) = (x as i64, y as i64);
            if fill[y * w + x]
                && !clear(xi - 1, yi)
                && !clear(xi + 1, yi)
                && !clear(xi, yi - 1)
                && !clear(xi, yi + 1)
            {
                img.data[y * w + x] = sub;
            }
        }
    }
}

/// Runs the whole pipeline.
///
/// # Errors
///
/// `pixelize.empty` when nothing is left after the background goes.
pub fn pixelize(source: &Img, o: &Options) -> Result<Pixelized> {
    let mut img = source.clone();
    for p in img.data.iter_mut() {
        if (*p & 255) < u32::from(o.alpha_cut) {
            *p = CLEAR;
        }
    }
    remove_background(&mut img, o.background, o.bg_tolerance, o.bg_global);
    // Detached bits off the subject's grid would throw off grid detection.
    if o.main_only {
        keep_largest(&mut img);
    }
    let b = bounds(&img).ok_or_else(|| {
        RasterError::new(
            "pixelize.empty",
            "the picture is empty once its background is removed",
        )
    })?;
    img = crop(&img, b);

    let grid = match o.cell {
        Some(cell) => Grid {
            cell,
            ox: 0.0,
            oy: 0.0,
        },
        None => detect_cell(&img),
    };
    if grid.cell >= 1.5 {
        img = sample_grid(&img, grid, o.alpha_cut);
    }
    if let Some(b) = bounds(&img) {
        img = crop(&img, b);
    }
    let native = (img.w, img.h);

    if let Some((fw, fh)) = o.fit {
        let scale = (fw as f64 / img.w as f64).min(fh as f64 / img.h as f64);
        if scale < 1.0 {
            let tw = ((img.w as f64 * scale).round() as usize).clamp(1, fw);
            let th = ((img.h as f64 * scale).round() as usize).clamp(1, fh);
            img = resample(&img, tw, th);
        }
    }

    let mut palette: Vec<Px> = match &o.palette {
        Some(colours) => colours.iter().map(|c| pack(c[0], c[1], c[2])).collect(),
        None => reduce_colors(&img, o.colors),
    };
    snap(&mut img, &palette);
    cleanup(&mut img, o.clean);
    if o.main_only {
        keep_largest(&mut img);
        if let Some(b) = bounds(&img) {
            img = crop(&img, b);
        }
    }
    if o.outline && !palette.is_empty() {
        let mut col = palette[0];
        for c in &palette {
            if oklab(*c)[0] < oklab(col)[0] {
                col = *c;
            }
        }
        img = outline_edge(&img, col, oklab(col)[0] + o.outline_dark);
        if !palette.contains(&col) {
            palette.push(col);
        }
        reserve_line(&mut img, col, &palette);
    }
    let mut used: Vec<Px> = Vec::new();
    for &p in &img.data {
        if p != CLEAR && !used.contains(&p) {
            used.push(p);
        }
    }
    palette.retain(|c| used.contains(c));
    Ok(Pixelized {
        img,
        cell: grid.cell,
        native,
        palette,
    })
}

/// A fake-pixel-art picture for tests elsewhere in the crate: a 6x8 sprite on a
/// magenta field, drawn at a fractional pitch with a little per-pixel noise so
/// it has the hundreds of near-identical colours a generated image has.
/// Compiled outside `cfg(test)` only because the binary crate's tests reach it
/// through the library; nothing in the application calls it.
#[doc(hidden)]
pub mod fixture {
    use super::*;

    const ART: [&str; 8] = [
        "..K...", ".KRK..", "KRGRK.", "KGRGRK", "KRGRGK", ".KRGRK", "..KRK.", "...K..",
    ];

    pub fn fake_picture(cell: f64, margin: usize, noise: i32) -> Img {
        let w = (6.0 * cell).round() as usize + margin * 2;
        let h = (8.0 * cell).round() as usize + margin * 2;
        let mut img = Img::new(w, h);
        for y in 0..h {
            for x in 0..w {
                let cx = ((x as f64 - margin as f64) / cell).floor();
                let cy = ((y as f64 - margin as f64) / cell).floor();
                let base: [i32; 3] = if cx < 0.0 || cy < 0.0 {
                    [255, 0, 255]
                } else {
                    match ART
                        .get(cy as usize)
                        .and_then(|row| row.as_bytes().get(cx as usize))
                    {
                        Some(b'K') => [20, 12, 10],
                        Some(b'R') => [200, 40, 40],
                        Some(b'G') => [60, 160, 90],
                        _ => [255, 0, 255],
                    }
                };
                // Noise only on the sprite: the background stays a flat key.
                let jitter = |k: usize| -> i32 {
                    if base == [255, 0, 255] || noise == 0 {
                        return 0;
                    }
                    let n = ((x * 73 + y * 151 + k * 31) * 2_654_435) % 997;
                    (n as i32).rem_euclid(2 * noise + 1) - noise
                };
                let ch = |k: usize| (base[k] + jitter(k)).clamp(0, 255) as u8;
                img.data[y * w + x] = pack(ch(0), ch(1), ch(2));
            }
        }
        img
    }

    /// The picture as PNG bytes, the way an import stores it.
    pub fn fake_png(cell: f64, margin: usize, noise: i32) -> Vec<u8> {
        let img = fake_picture(cell, margin, noise);
        let mut data = Vec::with_capacity(img.data.len() * 4);
        for p in &img.data {
            data.extend_from_slice(&p.to_be_bytes());
        }
        super::super::png::encode(&super::super::RgbaImage {
            width: img.w as u16,
            height: img.h as u16,
            data,
        })
        .expect("the fixture encodes")
    }

    /// A transparent PNG the size of a canvas: what the sidecar's conformed
    /// copy has to be, since the store insists it matches the asset.
    pub fn blank_png(w: u16, h: u16) -> Vec<u8> {
        super::super::png::encode(&super::super::RgbaImage {
            width: w,
            height: h,
            data: vec![0; usize::from(w) * usize::from(h) * 4],
        })
        .expect("the fixture encodes")
    }

    /// How many distinct colours a picture has, background included.
    pub fn distinct_colours(img: &Img) -> usize {
        img.data
            .iter()
            .collect::<std::collections::HashSet<_>>()
            .len()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const K: Px = 0x140C0AFF;
    const R: Px = 0xC82828FF;
    const G: Px = 0x3CA05AFF;
    const BG: Px = 0xFF00FFFF;

    const ART: [&str; 8] = [
        "..K...", ".KRK..", "KRGRK.", "KGRGRK", "KRGRGK", ".KRGRK", "..KRK.", "...K..",
    ];

    /// A 6x8 sprite drawn as fake pixel art: blocks of a fractional size on a
    /// magenta field.
    fn fake(cell: f64, margin: usize) -> Img {
        let w = (6.0 * cell).round() as usize + margin * 2;
        let h = (8.0 * cell).round() as usize + margin * 2;
        let mut src = Img::new(w, h);
        src.data.fill(BG);
        for y in 0..h {
            for x in 0..w {
                let cx = ((x as f64 - margin as f64) / cell).floor();
                let cy = ((y as f64 - margin as f64) / cell).floor();
                if cx < 0.0 || cy < 0.0 {
                    continue;
                }
                let ch = ART
                    .get(cy as usize)
                    .and_then(|row| row.as_bytes().get(cx as usize));
                match ch {
                    Some(b'K') => src.data[y * w + x] = K,
                    Some(b'R') => src.data[y * w + x] = R,
                    Some(b'G') => src.data[y * w + x] = G,
                    _ => {}
                }
            }
        }
        src
    }

    fn assert_native_art(r: &Pixelized) {
        assert_eq!((r.img.w, r.img.h), (6, 8));
        for (y, row) in ART.iter().enumerate() {
            for x in 0..6 {
                let want_clear = row.as_bytes()[x] == b'.';
                assert_eq!(
                    r.img.get(x as i64, y as i64) == CLEAR,
                    want_clear,
                    "pixel {x},{y}"
                );
            }
        }
    }

    #[test]
    fn detects_a_fractional_pitch_of_7_5() {
        let grid = detect_cell(&fake(7.5, 20));
        assert!((grid.cell - 7.5).abs() < 0.3, "cell {}", grid.cell);
    }

    #[test]
    fn detects_a_fractional_pitch_of_19_5() {
        let grid = detect_cell(&fake(19.5, 20));
        assert!((grid.cell - 19.5).abs() < 0.5, "cell {}", grid.cell);
    }

    #[test]
    fn recovers_the_native_grid_and_removes_the_chroma_background() {
        let r = pixelize(&fake(7.5, 20), &Options::default()).unwrap();
        assert_native_art(&r);
        assert_eq!(r.palette.len(), 3);
    }

    #[test]
    fn recovers_the_native_grid_at_a_pitch_of_19_5() {
        let r = pixelize(&fake(19.5, 20), &Options::default()).unwrap();
        assert_native_art(&r);
    }

    #[test]
    fn outline_gives_one_line_colour_on_the_silhouette_and_grows_one_pixel() {
        let o = Options {
            outline: true,
            ..Options::default()
        };
        let r = pixelize(&fake(6.4, 20), &o).unwrap();
        assert_eq!((r.img.w, r.img.h), (8, 10));
        let light = |c: Px| (c >> 24) + ((c >> 16) & 255);
        let line = *r.palette.iter().min_by_key(|c| light(**c)).unwrap();
        for y in 0..r.img.h as i64 {
            for x in 0..r.img.w as i64 {
                let c = r.img.get(x, y);
                if c == CLEAR {
                    continue;
                }
                let edge = [(1, 0), (-1, 0), (0, 1), (0, -1)]
                    .iter()
                    .any(|(dx, dy)| r.img.get(x + dx, y + dy) == CLEAR);
                if edge {
                    assert_eq!(c, line, "edge {x},{y}");
                }
            }
        }
    }

    #[test]
    fn a_detached_bit_does_not_shift_the_grid() {
        let mut src = fake(8.0, 20);
        // A block of the subject's colour in the corner, off its grid.
        for y in 2..10 {
            for x in 2..10 {
                src.data[y * src.w + x] = G;
            }
        }
        let kept = Options {
            main_only: true,
            ..Options::default()
        };
        assert_eq!(pixelize(&src, &kept).unwrap().img.h, 8);
        let fitted = Options {
            main_only: true,
            fit: Some((100, 4)),
            ..Options::default()
        };
        assert_eq!(pixelize(&src, &fitted).unwrap().img.h, 4);
    }

    #[test]
    fn the_speck_rule_keeps_one_pixel_tips_and_drops_true_specks() {
        // A 1 px tip hangs off a bar: it has a differing neighbour on three
        // sides but a matching one below, so it stays. The lone dot floats in
        // clear space, all four neighbours alike, so it goes.
        let mut img = Img::new(7, 5);
        for x in 1..6 {
            img.data[3 * 7 + x] = K;
            img.data[2 * 7 + x] = K;
        }
        img.data[7 + 3] = K; // the tip, above the bar
        img.data[4] = R; // the speck, in the top row, away from the bar
        img.data[0] = CLEAR;
        cleanup(&mut img, 2);
        assert_eq!(img.get(3, 1), K, "the 1 px tip is kept");
        assert_eq!(img.get(4, 0), CLEAR, "the speck is dropped");
    }

    #[test]
    fn a_speck_inside_a_fill_takes_the_fill_colour() {
        let mut img = Img::new(5, 5);
        img.data.fill(K);
        img.data[2 * 5 + 2] = R;
        cleanup(&mut img, 1);
        assert_eq!(img.get(2, 2), K);
    }

    #[test]
    fn reducing_colours_caps_the_palette() {
        let mut img = Img::new(16, 1);
        for x in 0..16 {
            img.data[x] = pack((x * 16) as u8, 40, (255 - x * 16) as u8);
        }
        let palette = reduce_colors(&img, 4);
        assert!(palette.len() <= 4 && !palette.is_empty());
    }

    #[test]
    fn a_given_palette_is_snapped_to() {
        let o = Options {
            palette: Some(vec![[0, 0, 0], [255, 255, 255]]),
            ..Options::default()
        };
        let r = pixelize(&fake(7.5, 20), &o).unwrap();
        for p in &r.palette {
            assert!(*p == pack(0, 0, 0) || *p == pack(255, 255, 255));
        }
    }

    #[test]
    fn a_noisy_picture_collapses_to_a_few_colours_on_its_grid() {
        let src = fixture::fake_picture(7.5, 20, 6);
        let before = fixture::distinct_colours(&src);
        let o = Options {
            colors: 3,
            ..Options::default()
        };
        let r = pixelize(&src, &o).unwrap();
        println!(
            "before: {}x{} px, {before} colours; after: {}x{} px, {} colours, pitch {:.2}",
            src.w,
            src.h,
            r.img.w,
            r.img.h,
            r.palette.len(),
            r.cell
        );
        assert!(before > 100, "the fixture should be noisy: {before}");
        assert_eq!((r.img.w, r.img.h), (6, 8));
        assert_eq!(r.palette.len(), 3);
        assert!((r.cell - 7.5).abs() < 0.3);
    }

    #[test]
    fn an_empty_picture_is_refused() {
        let mut img = Img::new(8, 8);
        img.data.fill(BG);
        let error = pixelize(&img, &Options::default()).unwrap_err();
        assert_eq!(error.code, "pixelize.empty");
    }
}

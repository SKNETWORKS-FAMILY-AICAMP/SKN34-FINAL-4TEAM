---
name: STORYFORK Presentation 3D
description: Editorial Korean storytelling paired with animated knowledge graphs and original-only fork timelines.
colors:
  canvas: "#050611"
  stage: "#050716"
  scene: "#060b24"
  ribbon-blue: "#4581ed"
  ribbon-purple: "#8746db"
  dust-blue: "#6578bc"
  dust-purple: "#a775d7"
  graph-label: "#f3f2ff"
  graph-label-back: "#101032"
  direct-link: "#8fbfff"
  peripheral-link: "#554d8b"
  path-head: "#d9ecff"
  junction-core: "#eff9ff"
  original-label: "#aabaff"
  fork-a-label: "#d1b8ff"
  fork-b-label: "#7ae4f3"
  intro-tint: "#a9b6d5"
  evidence-tint: "#acb6cf"
  disclosure-tint: "#a4accb"
  text-primary: "#f4f2ff"
  text-body: "#b9bfdc"
  text-caption: "#b7bdd8"
  accent: "#a28aff"
  progress: "#9d8cfa"
  divider: "#343553"
  world: "#aa94ff"
  person: "#59bcff"
  place: "#5fe1d0"
  organization: "#ffbd75"
  event: "#ed91d1"
  original-path: "#839aff"
  fork-a-path: "#c19aff"
  fork-b-path: "#58dbef"
  control-surface: "#15162b"
  control-default: "#282443"
  control-hover: "#40335e"
  control-text: "#eee9ff"
typography:
  display:
    fontFamily: "Presentation, 'Malgun Gothic', sans-serif"
    fontSize: "65px"
    fontWeight: 720
    lineHeight: 1.22
    letterSpacing: "-0.035em"
  display-fork:
    fontFamily: "Presentation, 'Malgun Gothic', sans-serif"
    fontSize: "58px"
    fontWeight: 720
    lineHeight: 1.22
    letterSpacing: "-0.035em"
  title:
    fontSize: "34px"
    fontWeight: 650
    letterSpacing: "-0.02em"
  body:
    fontSize: "27px"
    lineHeight: 1.6
  supporting:
    fontSize: "22px"
    lineHeight: 1.6
  evidence:
    fontSize: "19px"
    lineHeight: 1.6
  wordmark:
    fontSize: "32px"
    fontWeight: 800
    letterSpacing: "0.04em"
  control:
    fontSize: "14px"
rounded:
  control: "3px"
  badge: "4px"
  controls: "6px"
spacing:
  page-inset: "80px"
  control-gap: "12px"
  legend-gap: "28px"
  relation-gap: "32px"
components:
  preview-control:
    backgroundColor: "{colors.control-default}"
    textColor: "{colors.control-text}"
    typography: "{typography.control}"
    rounded: "{rounded.control}"
    padding: "8px 12px"
  preview-control-hover:
    backgroundColor: "{colors.control-hover}"
---

# Design System: STORYFORK Presentation 3D v2

## Overview

The two 1920 × 1080 presentation movies use Experience mode. Korean editorial copy introduces the relationship graph and timeline. The user’s optical-network and luminous-path references guide the lighting. The brief and implemented code establish composition, color and motion.

## Colors

Indigo frames the stage and WebGL scene. Blue and purple ribbons and dust create background motion. Five category colors identify the graph nodes and legend dots: lavender for world, blue for person, mint for place, amber for organization and pink for event. Bright blue links mark the central neighborhood. Path labels use lighter tints of the blue original, violet Fork A and cyan Fork B. The color detector flagged undocumented literals as an advisory. The frontmatter records the active stage, scene, ribbon, dust, label and copy tints used by v2.

## Typography

Local variable Pretendard loads as Presentation with Malgun Gothic fallback. Graph and fork headlines use the two display roles. Path names use 33px at weight 650 with 19px descriptions. Episode markers use 22px at weight 650. The fork headline and projected HTML labels use stage-colored text shadows for legibility.

## Layout

The fixed 16:9 stage scales uniformly to fit the viewport. The graph composition retains its left editorial introduction at (80, 210), focus panel at (80, 610) and 1290 × 820 graph at (580, 140). A radial mask feathers the graph perimeter. The fork canvas fills the frame beneath the introduction at y=170. Both scenes retain the header disclosure and lower caption, inset 80px horizontally and 49px from the bottom.

## Elevation & Depth

The renderer tone-maps at ACES exposure 0.8. The first pass applies UnrealBloomPass to luminous geometry with radius 0.55 and threshold 0.40. Graph and fork use strengths of 1.25 × 0.85 and 1.4 × 0.85 respectively. A second pass clears depth and renders layer 1 directly, preserving crisp graph sprite labels. Projected HTML fork labels stay above the canvas. The scene adds radial glow sprites and slowly rotating blue-violet dust.

## Shapes

Nodes have spherical cores and additive halos. Source links and timeline paths are bundles of thin strands carrying moving particles. A branch starts with a bright core, a halo and a horizontal streak.

## Components

**Knowledge graph · 14 seconds.** Each of the 20 links has a local text anchor from episodes 1–2. Each link carries nine fibers and 95 particles. Between 3 and 9 seconds the camera moves from z=560 to 380, keeping 홍길동 and direct neighbors bright as other nodes dim to 18%. Three background ribbons and 3,500 dust particles add atmosphere. The lower caption distinguishes these effects from the sourced connections.

**Fork timeline · 11 seconds.** Each of the three paths uses 76 fibers and 3,200 particles. The original begins at 0 seconds. A branches from the original at 2.7 seconds and B at 4.4 seconds. Their strands follow one curve per path. Projected labels identify each independent continuation. The caption identifies EP.02 and EP.03 as illustrative permissions.

**Preview controls.** Scene selection, pause/play, restart and elapsed time sit outside the stage. The exporter captures the presentation at explicit movie times.

## Do's and Don'ts

- Keep category colors aligned between the graph and its legend. Keep source captions visible in the export.
- Treat background ribbons as decoration and optical fibers as parts of a single evidenced edge or timeline.
- Draw both branches directly from the original. Preserve the no-refork rule in the lower caption.
- Use the v2 posters in `renders/graph-poster.png` and `renders/fork-poster.png` as rendered examples. The fresh v2 review marked the reviewed 1920 × 1080 stills ready to ship after comparison with v1 and the supplied references. It noted dim outer graph labels during focus and blunt fiber tips. Encoded video playback is recorded separately in `renders/video-playback.json`.

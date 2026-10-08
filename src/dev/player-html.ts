// The dev player's page shell. Its behavior lives in player.ts (served as
// /__kamishibai/player.js); this is only the markup and the styles.

export const PLAYER_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>kamishibai dev</title>
<style>
  :root {
    --bg: #0f1115; --panel: #171a21; --line: #2a2f3a; --text: #e6e8ee; --dim: #8b93a5;
    --accent: #6aa8ff; --range: rgba(106, 168, 255, 0.18); --voice: #f2b84b; --sound: #6ccf9a;
    --cue: #b59cff; --error: #ff6b6b;
    color-scheme: dark;
  }
  * { box-sizing: border-box; }
  html, body { margin: 0; height: 100%; }
  body {
    background: var(--bg); color: var(--text);
    font: 13px/1.4 ui-sans-serif, system-ui, -apple-system, "Hiragino Sans", sans-serif;
    display: grid; grid-template-rows: auto 1fr auto; overflow: hidden;
  }
  button {
    font: inherit; color: var(--text); background: var(--panel); border: 1px solid var(--line);
    border-radius: 6px; padding: 4px 10px; cursor: pointer;
  }
  button:hover { border-color: var(--dim); }
  button[aria-pressed="true"] { border-color: var(--accent); color: var(--accent); }
  button:disabled { opacity: 0.4; cursor: default; }
  header, footer { background: var(--panel); border-color: var(--line); border-style: solid; border-width: 0; }
  header { border-bottom-width: 1px; display: flex; gap: 12px; align-items: center; padding: 8px 16px; min-width: 0; }
  header > * { flex: none; white-space: nowrap; }
  header .name { font-weight: 600; }
  header .entry, header .status span { overflow: hidden; text-overflow: ellipsis; }
  header .entry { color: var(--dim); font-family: ui-monospace, monospace; flex: 0 1 auto; min-width: 4ch; max-width: 40%; direction: rtl; text-align: left; }
  header .status { color: var(--dim); margin-right: auto; display: flex; gap: 12px; flex: 1 1 0; min-width: 0; }
  header .status .warn { color: var(--voice); }
  main { position: relative; min-height: 0; display: grid; place-items: center; padding: 16px; }
  #frame { position: relative; box-shadow: 0 0 0 1px var(--line), 0 8px 40px rgba(0, 0, 0, 0.5); background: #000; }
  #frame iframe { position: absolute; left: 0; top: 0; border: 0; transform-origin: 0 0; background: #fff; }
  #overlay { position: absolute; inset: 0; pointer-events: none; overflow: hidden; }
  #chips { position: absolute; left: 12px; top: 12px; right: 12px; display: flex; flex-direction: column; gap: 6px; align-items: flex-start; }
  .chip {
    background: rgba(15, 17, 21, 0.86); border: 1px solid var(--line); border-left: 3px solid var(--sound);
    border-radius: 6px; padding: 4px 10px; max-width: 100%; font-size: 14px;
  }
  .chip.voice { border-left-color: var(--voice); }
  .chip .kind { color: var(--dim); font-size: 11px; text-transform: uppercase; letter-spacing: 0.04em; margin-right: 6px; }
  #caption {
    position: absolute; left: 50%; bottom: 6%; transform: translateX(-50%); max-width: 86%;
    background: rgba(0, 0, 0, 0.72); color: #fff; padding: 4px 12px; border-radius: 4px;
    text-align: center; font-size: 16px; white-space: pre-line;
  }
  #caption:empty { display: none; }
  #error {
    position: absolute; left: 16px; right: 16px; top: 16px; max-height: 60%; overflow: auto; margin: 0;
    background: #2a1416; color: #ffd6d6; border: 1px solid var(--error); border-radius: 8px;
    padding: 12px 14px; font: 12px/1.5 ui-monospace, monospace; white-space: pre-wrap;
  }
  #error[hidden] { display: none; }
  #sweep { position: fixed; left: 0; top: 0; border: 0; opacity: 0; pointer-events: none; z-index: -1; }
  footer { border-top-width: 1px; padding: 10px 16px 12px; display: grid; gap: 10px; }
  /* --audio-rows: how many rows the sound lane needs (overlapping clips stack).
     Set on #timeline, so the lane labels line up with the lanes. */
  #timeline { --audio-h: calc(var(--audio-rows, 1) * 10px + 2px); display: grid; row-gap: 6px; }
  /* Lane names sit over the left end of their lanes, so they take no width. */
  #track .label {
    position: absolute; left: 4px; z-index: 1; pointer-events: none;
    color: var(--text); font-size: 9px; line-height: 10px;
    /* A dark outline instead of a backing box, so it reads over any bar color. */
    text-shadow: 0 0 2px var(--bg), 0 0 2px var(--bg), 0 0 1px var(--bg);
  }
  #track.no-labels .label { display: none; }
  #track .label.frames { top: -1px; }
  #track .label.sound { top: 13px; }
  #track .label.subs { top: calc(17px + var(--audio-h)); }
  #track {
    position: relative; height: calc(54px + var(--audio-h)); cursor: pointer; touch-action: none; user-select: none; overflow: hidden;
  }
  #track .lane { position: absolute; left: 0; right: 0; height: 12px; background: #11141a; border-radius: 3px; }
  #track .lane.frames { top: 0; height: 8px; width: 100%; display: block; }
  #track .lane.audio { top: 12px; height: var(--audio-h); }
  #track .lane.cues { top: calc(16px + var(--audio-h)); }
  #track .lane.time { top: calc(32px + var(--audio-h)); height: 22px; background: transparent; border-top: 1px solid var(--line); }
  #track .bar { position: absolute; top: 2px; height: 8px; border-radius: 2px; background: var(--sound); opacity: 0.85; min-width: 2px; }
  #track .bar.voice { background: var(--voice); }
  #track .bar.placeholder { background: transparent; border: 1px dashed var(--voice); }
  #track .bar.cue { background: var(--cue); }
  #track .tick { position: absolute; top: 0; height: 5px; border-left: 1px solid var(--line); }
  #track .tick span { position: absolute; top: 5px; left: 3px; color: var(--dim); font-size: 10px; }
  #range { position: absolute; top: 0; bottom: 0; background: var(--range); border-left: 1px solid var(--accent); border-right: 1px solid var(--accent); }
  #range[hidden] { display: none; }
  #head { position: absolute; top: 0; bottom: 0; width: 2px; margin-left: -1px; background: var(--accent); }
  #overview { position: relative; height: 6px; background: #11141a; border-radius: 3px; cursor: pointer; touch-action: none; }
  #overview[hidden] { display: none; }
  #thumb { position: absolute; top: 0; bottom: 0; min-width: 6px; background: var(--dim); border-radius: 3px; cursor: grab; }
  .controls { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
  .controls .clock { font-family: ui-monospace, monospace; min-width: 15ch; }
  .controls .frame-no { min-width: 20ch; }
  /* Right-aligned, so text that changes width every frame moves no buttons. */
  .controls .info {
    /* A zero basis, so it shrinks (and ellipsizes) instead of wrapping to a new line. */
    flex: 1 1 0; margin-left: auto; min-width: 0; display: flex; gap: 14px; justify-content: flex-end;
    color: var(--dim); font: 12px ui-monospace, monospace; white-space: nowrap; overflow: hidden;
  }
  .controls .info span { overflow: hidden; text-overflow: ellipsis; }
  .controls .sep { width: 1px; height: 20px; background: var(--line); margin: 0 4px; }
  #help {
    position: fixed; top: 52px; right: 16px; z-index: 10; width: min(420px, calc(100vw - 32px));
    max-height: calc(100vh - 68px); overflow: auto; background: var(--panel); border: 1px solid var(--line);
    border-radius: 8px; padding: 14px 16px; box-shadow: 0 12px 40px rgba(0, 0, 0, 0.5);
  }
  #help[hidden] { display: none; }
  #help h2 { font-size: 12px; margin: 14px 0 6px; color: var(--dim); text-transform: uppercase; letter-spacing: 0.04em; }
  #help h2:first-child { margin-top: 0; }
  #help .toggle { display: flex; gap: 8px; align-items: center; margin-top: 8px; color: var(--text); cursor: pointer; }
  #help p { margin: 0 0 6px; }
  #help dl { display: grid; grid-template-columns: auto 1fr; gap: 4px 12px; margin: 0; }
  #help dt { white-space: nowrap; }
  #help dd { margin: 0; color: var(--dim); }
  #help kbd { font: 11px ui-monospace, monospace; border: 1px solid var(--line); border-radius: 4px; padding: 1px 5px; }
  #help i { display: inline-block; width: 14px; height: 8px; border-radius: 2px; margin-right: 6px; }
  #help .capture { background: var(--accent); }
  #help .copy { background: var(--line); }
  #help .voice { background: var(--voice); }
  #help .sound { background: var(--sound); }
  #help .placeholder { border: 1px dashed var(--voice); }
  #help .cue { background: var(--cue); }
  #copied { color: var(--accent); font-size: 12px; }
</style>
</head>
<body>
<header>
  <span class="name">kamishibai dev</span>
  <span class="entry" id="entry"></span>
  <span class="status"><span id="state">loading…</span><span id="sweepState"></span><span id="pending" class="warn"></span></span>
  <button id="mute" aria-pressed="false" title="M — mute">🔊 Sound</button>
  <button id="cc" aria-pressed="true" title="C — off → captions → storyboard">CC: captions</button>
  <button id="helpButton" aria-expanded="false" aria-controls="help" title="?">?</button>
</header>
<section id="help" hidden>
  <h2>Timeline</h2>
  <dl>
    <dt><i class="capture"></i>captured</dt><dd>top lane: a frame a render screenshots</dd>
    <dt><i class="copy"></i>copied</dt><dd>a frame a render copies from the one before: seek returned <kbd>false</kbd>, or the same fingerprint as that frame. Blank: not seeked yet</dd>
    <dt><i class="voice"></i>voice</dt><dd>sound lane: narration, or a clip with a label. Sounds that overlap in time stack on more rows</dd>
    <dt><i class="sound"></i>other sound</dt><dd>music, effects, a video's audio</dd>
    <dt><i class="placeholder"></i>not synthesized</dt><dd>a line with no audio yet; its length is a guess</dd>
    <dt><i class="cue"></i>subtitle</dt><dd>a soft subtitle cue</dd>
  </dl>
  <label class="toggle"><input type="checkbox" id="laneLabels" checked /> Show lane names on the timeline</label>
  <h2>CC</h2>
  <dl>
    <dt>off</dt><dd>nothing over the picture</dd>
    <dt>captions</dt><dd>the subtitles</dd>
    <dt>storyboard</dt><dd>every sound as text, narration included (a line already in the captions is just named "captioned")</dd>
  </dl>
  <h2>Keys</h2>
  <dl>
    <dt><kbd>Space</kbd></dt><dd>play / pause</dd>
    <dt><kbd>←</kbd> <kbd>→</kbd></dt><dd>one frame (with <kbd>Shift</kbd>: one second)</dd>
    <dt><kbd>Home</kbd> <kbd>End</kbd></dt><dd>start / end (of the range, if set)</dd>
    <dt><kbd>I</kbd> <kbd>O</kbd></dt><dd>range in / out</dd>
    <dt><kbd>Esc</kbd></dt><dd>clear the range</dd>
    <dt><kbd>L</kbd></dt><dd>loop</dd>
    <dt><kbd>M</kbd></dt><dd>mute</dd>
    <dt><kbd>C</kbd></dt><dd>step CC</dd>
    <dt><kbd>+</kbd> <kbd>−</kbd> <kbd>0</kbd></dt><dd>zoom the timeline in / out / to the whole reel</dd>
    <dt>⌘/Ctrl + wheel</dt><dd>zoom at the pointer (or pinch); the wheel alone scrolls</dd>
    <dt><kbd>?</kbd></dt><dd>this help</dd>
  </dl>
  <h2>seek(ms)</h2>
  <p>At the right of the controls, for the current frame:</p>
  <dl>
    <dt>fingerprint</dt><dd>the string <kbd>seek</kbd> returned (kamishibai/react hashes the DOM). Hover for all of it</dd>
    <dt><kbd>false</kbd></dt><dd><kbd>seek</kbd> said "same as the frame before". Only shown when the frame before was the last one seeked, since it means nothing otherwise</dd>
    <dt>capture</dt><dd>a render screenshots this frame</dd>
    <dt>copy</dt><dd>a render reuses the frame before: <kbd>seek</kbd> returned <kbd>false</kbd>, or the same fingerprint as that frame</dd>
    <dt>renders N of M</dt><dd>once every frame is known: how many frames a render screenshots</dd>
  </dl>
  <h2>Narration</h2>
  <p>dev never calls a TTS provider. Lines already in the cache play; new or edited ones get an estimated length.
  Run <kbd>kamishibai tts &lt;entry&gt;</kbd> to bake them, and the layout may shift to the real lengths.</p>
  <p><b>Copy --only</b> copies the range for <kbd>kamishibai capture</kbd> / <kbd>render</kbd>.</p>
</section>
<main id="viewport">
  <div id="frame"><div id="overlay"><div id="chips"></div><div id="caption"></div></div></div>
  <pre id="error" hidden></pre>
</main>
<footer>
  <div id="timeline">
  <div id="track">
    <span class="label frames">frames</span><span class="label sound">sound</span><span class="label subs">subs</span>
    <canvas class="lane frames" id="laneFrames"></canvas>
    <div class="lane audio" id="laneAudio"></div>
    <div class="lane cues" id="laneCues"></div>
    <div class="lane time" id="laneTime"></div>
    <div id="range" hidden></div>
    <div id="head"></div>
  </div>
  <div id="overview" hidden title="drag to scroll the timeline"><div id="thumb"></div></div>
  </div>
  <div class="controls">
    <button id="start" title="Home">⏮</button>
    <button id="prev" title="← (Shift: 1 s)">◀︎</button>
    <button id="play" title="Space">▶︎</button>
    <button id="next" title="→ (Shift: 1 s)">▶︎|</button>
    <button id="end" title="End">⏭</button>
    <span class="clock" id="clock">00:00.000</span>
    <span class="clock frame-no" id="frameNo">frame 0</span>
    <span class="sep"></span>
    <button id="in" title="I — range start">In</button>
    <button id="out" title="O — range end">Out</button>
    <button id="clear" title="Esc — clear the range">Clear</button>
    <button id="loop" aria-pressed="false" title="L — loop">Loop</button>
    <button id="copy" title="Copy the range as a --only flag">Copy --only</button>
    <span class="sep"></span>
    <button id="zoomOut" title="− — zoom out">−</button>
    <button id="zoomFit" title="0 — show the whole reel">Fit</button>
    <button id="zoomIn" title="+ — zoom in">+</button>
    <span id="copied"></span>
    <span class="info"><span id="seekInfo"></span><span id="frameStats"></span></span>
  </div>
</footer>
<script type="module" src="/__kamishibai/player.js"></script>
</body>
</html>
`;

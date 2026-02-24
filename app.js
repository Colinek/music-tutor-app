import * as Tone from "https://cdn.jsdelivr.net/npm/tone@15.1.22/+esm";
import { Midi } from "https://cdn.jsdelivr.net/npm/@tonejs/midi@2.0.28/+esm";

const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const TIMING_WINDOW_SECONDS = 0.2;
const PITCH_WINDOW_CENTS = 35;

const dom = {
  songSelect: document.getElementById("songSelect"),
  loadLocalBtn: document.getElementById("loadLocalBtn"),
  localMidiFile: document.getElementById("localMidiFile"),
  localXmlFile: document.getElementById("localXmlFile"),
  playPauseBtn: document.getElementById("playPauseBtn"),
  stopBtn: document.getElementById("stopBtn"),
  micBtn: document.getElementById("micBtn"),
  tempoSlider: document.getElementById("tempoSlider"),
  tempoValue: document.getElementById("tempoValue"),
  analysisTrackSelect: document.getElementById("analysisTrackSelect"),
  guideAudible: document.getElementById("guideAudible"),
  expectedNote: document.getElementById("expectedNote"),
  detectedNote: document.getElementById("detectedNote"),
  accuracyPct: document.getElementById("accuracyPct"),
  checkedNotes: document.getElementById("checkedNotes"),
  playbackTime: document.getElementById("playbackTime"),
  status: document.getElementById("status"),
  score: document.getElementById("score")
};

const state = {
  songs: [],
  currentSong: null,
  midi: null,
  osmd: null,
  cursor: null,
  players: [],
  referenceTrackIndex: 0,
  referenceNotes: [],
  onsetTimes: [],
  nextOnsetIndex: 0,
  tempoRate: 1,
  totalDuration: 0,
  isPlaying: false,
  uiLoopId: null,
  detectedHz: null,
  mic: {
    running: false,
    context: null,
    analyser: null,
    stream: null,
    rafId: null
  },
  score: {
    attempted: 0,
    hits: 0,
    results: new Map(),
    nextFinalizeIndex: 0
  }
};

init().catch((err) => {
  setStatus(`Initialization failed: ${err.message}`);
});

async function init() {
  bindEvents();
  await loadSongsIndex();
  dom.tempoValue.textContent = `${state.tempoRate.toFixed(2)}x`;
}

function bindEvents() {
  dom.songSelect.addEventListener("change", async () => {
    const id = dom.songSelect.value;
    if (!id) {
      return;
    }
    const song = state.songs.find((item) => item.id === id);
    if (song) {
      await loadSongFromManifest(song);
    }
  });

  dom.loadLocalBtn.addEventListener("click", async () => {
    const midiFile = dom.localMidiFile.files?.[0];
    const xmlFile = dom.localXmlFile.files?.[0];
    if (!midiFile || !xmlFile) {
      setStatus("Select both a MIDI and MusicXML file.");
      return;
    }
    await loadLocalSongPair(midiFile, xmlFile);
  });

  dom.playPauseBtn.addEventListener("click", async () => {
    if (!state.midi) {
      setStatus("Load a song first.");
      return;
    }
    await Tone.start();
    if (state.isPlaying) {
      pausePlayback();
      return;
    }
    startPlayback();
  });

  dom.stopBtn.addEventListener("click", () => {
    stopPlayback(true);
    updateExpected("--");
  });

  dom.micBtn.addEventListener("click", async () => {
    if (state.mic.running) {
      stopMicrophone();
      return;
    }
    await startMicrophone();
  });

  dom.tempoSlider.addEventListener("input", () => {
    const oldDuration = state.totalDuration || 1;
    const oldProgress = Math.min(Tone.Transport.seconds / oldDuration, 1);

    state.tempoRate = Number(dom.tempoSlider.value);
    dom.tempoValue.textContent = `${state.tempoRate.toFixed(2)}x`;

    if (!state.midi) {
      return;
    }

    const wasPlaying = state.isPlaying;
    if (wasPlaying) {
      pausePlayback();
    }

    rebuildPlaybackGraph();
    setReferenceTrack(state.referenceTrackIndex);

    Tone.Transport.seconds = state.totalDuration * oldProgress;
    syncCursorToTime(Tone.Transport.seconds);

    if (wasPlaying) {
      startPlayback();
    }
  });

  dom.analysisTrackSelect.addEventListener("change", () => {
    if (!state.midi) {
      return;
    }
    state.referenceTrackIndex = Number(dom.analysisTrackSelect.value);
    setReferenceTrack(state.referenceTrackIndex);
    rebuildPlaybackGraph();
    syncCursorToTime(Tone.Transport.seconds);
  });

  dom.guideAudible.addEventListener("change", () => {
    if (!state.midi) {
      return;
    }
    const wasPlaying = state.isPlaying;
    const currentTime = Tone.Transport.seconds;
    if (wasPlaying) {
      pausePlayback();
    }
    rebuildPlaybackGraph();
    Tone.Transport.seconds = currentTime;
    syncCursorToTime(currentTime);
    if (wasPlaying) {
      startPlayback();
    }
  });
}

async function loadSongsIndex() {
  try {
    const response = await fetch("./songs.json", { cache: "no-store" });
    if (!response.ok) {
      throw new Error(`songs.json returned ${response.status}`);
    }
    const songs = await response.json();
    state.songs = Array.isArray(songs) ? songs : [];
    renderSongSelect();

    if (state.songs.length > 0) {
      await loadSongFromManifest(state.songs[0]);
    } else {
      setStatus("songs.json is empty. Load local files or add songs.");
    }
  } catch (err) {
    state.songs = [];
    renderSongSelect();
    setStatus(`Could not load songs.json (${err.message}). You can still load local files.`);
  }
}

function renderSongSelect() {
  dom.songSelect.innerHTML = "";
  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = state.songs.length ? "Select a song" : "No songs in songs.json";
  dom.songSelect.appendChild(placeholder);

  state.songs.forEach((song) => {
    const opt = document.createElement("option");
    opt.value = song.id;
    opt.textContent = song.title;
    dom.songSelect.appendChild(opt);
  });

  if (state.songs.length > 0) {
    dom.songSelect.value = state.songs[0].id;
  }
}

async function loadSongFromManifest(song) {
  const folder = song.folder.endsWith("/") ? song.folder : `${song.folder}/`;
  const midiPath = `${folder}${song.midiFilename}`;
  const xmlPath = `${folder}${song.xmlFilename}`;

  setStatus(`Loading ${song.title}...`);

  try {
    const [midiRes, xmlRes] = await Promise.all([
      fetch(midiPath, { cache: "no-store" }),
      fetch(xmlPath, { cache: "no-store" })
    ]);

    if (!midiRes.ok || !xmlRes.ok) {
      throw new Error(`Fetch failed (midi ${midiRes.status}, xml ${xmlRes.status})`);
    }

    const [midiBuffer, xmlText] = await Promise.all([midiRes.arrayBuffer(), xmlRes.text()]);
    await applySongData({
      song,
      midiBuffer,
      xmlText,
      sourceLabel: `${song.title}`
    });
  } catch (err) {
    setStatus(`Failed to load song files: ${err.message}`);
  }
}

async function loadLocalSongPair(midiFile, xmlFile) {
  setStatus(`Loading local files: ${midiFile.name}, ${xmlFile.name}`);
  try {
    const [midiBuffer, xmlText] = await Promise.all([midiFile.arrayBuffer(), xmlFile.text()]);
    await applySongData({
      song: {
        id: "local",
        title: "Local Song",
        analysisTrackIndex: 0
      },
      midiBuffer,
      xmlText,
      sourceLabel: "Local file pair"
    });
  } catch (err) {
    setStatus(`Failed to load local files: ${err.message}`);
  }
}

async function applySongData({ song, midiBuffer, xmlText, sourceLabel }) {
  stopPlayback(true);
  state.currentSong = song;
  state.midi = new Midi(midiBuffer);

  await renderMusicXml(xmlText);
  populateTrackSelect();

  const initialTrack = Number(song.analysisTrackIndex ?? 0);
  state.referenceTrackIndex = clampTrackIndex(initialTrack);
  dom.analysisTrackSelect.value = String(state.referenceTrackIndex);

  rebuildPlaybackGraph();
  setReferenceTrack(state.referenceTrackIndex);

  setStatus(`${sourceLabel} loaded.`);
}

async function renderMusicXml(xmlText) {
  if (!window.opensheetmusicdisplay?.OpenSheetMusicDisplay) {
    throw new Error("OpenSheetMusicDisplay library did not load.");
  }

  if (!state.osmd) {
    state.osmd = new window.opensheetmusicdisplay.OpenSheetMusicDisplay(dom.score, {
      autoResize: true,
      drawTitle: true,
      followCursor: true
    });
  }

  await state.osmd.load(xmlText);
  state.osmd.render();

  state.cursor = state.osmd.cursor;
  if (state.cursor) {
    state.cursor.show();
    state.cursor.reset();
  }
}

function populateTrackSelect() {
  dom.analysisTrackSelect.innerHTML = "";

  state.midi.tracks.forEach((track, index) => {
    const noteCount = track.notes.length;
    const label = track.name?.trim() ? track.name.trim() : `Track ${index + 1}`;
    const opt = document.createElement("option");
    opt.value = String(index);
    opt.textContent = `${label} (${noteCount} notes)`;
    dom.analysisTrackSelect.appendChild(opt);
  });

  if (state.midi.tracks.length === 0) {
    const opt = document.createElement("option");
    opt.value = "0";
    opt.textContent = "No tracks found";
    dom.analysisTrackSelect.appendChild(opt);
  }
}

function rebuildPlaybackGraph() {
  state.players.forEach((player) => {
    player.part.dispose();
    player.synth.dispose();
  });
  state.players = [];

  Tone.Transport.stop();
  Tone.Transport.cancel();
  Tone.Transport.seconds = 0;

  if (!state.midi) {
    state.totalDuration = 0;
    return;
  }

  const tempoRate = state.tempoRate;
  const guideAudible = dom.guideAudible.checked;
  let maxEnd = 0;

  state.midi.tracks.forEach((track, index) => {
    if (!track.notes.length) {
      return;
    }

    const synth = new Tone.PolySynth(Tone.Synth, {
      oscillator: { type: "triangle" },
      envelope: { attack: 0.01, decay: 0.1, sustain: 0.3, release: 0.2 }
    }).toDestination();

    const events = track.notes.map((note) => {
      const event = {
        time: note.time / tempoRate,
        duration: Math.max(note.duration / tempoRate, 0.05),
        midi: note.midi,
        velocity: Math.max(note.velocity || 0.5, 0.15)
      };
      const endTime = event.time + event.duration;
      if (endTime > maxEnd) {
        maxEnd = endTime;
      }
      return event;
    });

    const part = new Tone.Part((time, event) => {
      if (index === state.referenceTrackIndex && !guideAudible) {
        return;
      }
      synth.triggerAttackRelease(Tone.Frequency(event.midi, "midi"), event.duration, time, event.velocity);
    }, events).start(0);

    state.players.push({ synth, part });
  });

  state.totalDuration = maxEnd;
}

function setReferenceTrack(index) {
  const trackIndex = clampTrackIndex(index);
  state.referenceTrackIndex = trackIndex;

  const track = state.midi?.tracks?.[trackIndex];
  const tempoRate = state.tempoRate;

  if (!track || !track.notes.length) {
    state.referenceNotes = [];
    state.onsetTimes = [];
    resetPerformanceStats();
    return;
  }

  state.referenceNotes = track.notes.map((note, idx) => {
    const start = note.time / tempoRate;
    const end = (note.time + note.duration) / tempoRate;
    return {
      index: idx,
      start,
      end,
      midi: note.midi,
      name: midiToNoteName(note.midi)
    };
  });

  state.onsetTimes = [...new Set(state.referenceNotes.map((note) => Number(note.start.toFixed(4))))].sort((a, b) => a - b);
  state.nextOnsetIndex = 0;

  resetPerformanceStats();
  updateExpected("--");
}

function clampTrackIndex(index) {
  const max = Math.max((state.midi?.tracks?.length || 1) - 1, 0);
  return Math.min(Math.max(Number(index) || 0, 0), max);
}

function startPlayback() {
  if (!state.midi) {
    return;
  }

  if (Tone.Transport.seconds >= state.totalDuration && state.totalDuration > 0) {
    Tone.Transport.seconds = 0;
    resetPerformanceStats();
    syncCursorToTime(0);
  }

  Tone.Transport.start("+0.05");
  state.isPlaying = true;
  dom.playPauseBtn.textContent = "Pause";
  startUiLoop();
}

function pausePlayback() {
  Tone.Transport.pause();
  state.isPlaying = false;
  dom.playPauseBtn.textContent = "Resume";
  stopUiLoop();
}

function stopPlayback(resetPosition) {
  Tone.Transport.stop();
  state.isPlaying = false;
  dom.playPauseBtn.textContent = "Play";

  if (resetPosition) {
    Tone.Transport.seconds = 0;
    resetPerformanceStats();
    syncCursorToTime(0);
    dom.playbackTime.textContent = "Time: 0.00s";
  }

  stopUiLoop();
}

function startUiLoop() {
  stopUiLoop();
  state.uiLoopId = window.setInterval(() => {
    const t = Tone.Transport.seconds;

    dom.playbackTime.textContent = `Time: ${t.toFixed(2)}s`;
    syncCursorForward(t);
    evaluateFeedbackAtTime(t);

    if (state.totalDuration > 0 && t >= state.totalDuration) {
      pausePlayback();
      setStatus("Playback finished.");
    }
  }, 50);
}

function stopUiLoop() {
  if (state.uiLoopId) {
    window.clearInterval(state.uiLoopId);
    state.uiLoopId = null;
  }
}

function syncCursorToTime(seconds) {
  if (!state.cursor) {
    return;
  }

  state.cursor.reset();
  state.cursor.show();
  state.nextOnsetIndex = 0;

  while (state.nextOnsetIndex < state.onsetTimes.length && state.onsetTimes[state.nextOnsetIndex] <= seconds) {
    state.cursor.next();
    state.nextOnsetIndex += 1;
  }
}

function syncCursorForward(seconds) {
  if (!state.cursor) {
    return;
  }

  while (state.nextOnsetIndex < state.onsetTimes.length && seconds >= state.onsetTimes[state.nextOnsetIndex]) {
    state.cursor.next();
    state.nextOnsetIndex += 1;
  }
}

function evaluateFeedbackAtTime(timeSeconds) {
  if (!state.referenceNotes.length) {
    updateExpected("--");
    return;
  }

  const active = state.referenceNotes.find(
    (note) => timeSeconds >= note.start - TIMING_WINDOW_SECONDS && timeSeconds <= note.end + TIMING_WINDOW_SECONDS
  );

  updateExpected(active ? active.name : "--");

  if (active) {
    maybeMarkHit(active.index, active.midi);
  }

  while (state.score.nextFinalizeIndex < state.referenceNotes.length) {
    const note = state.referenceNotes[state.score.nextFinalizeIndex];
    if (timeSeconds <= note.end + TIMING_WINDOW_SECONDS) {
      break;
    }
    finalizeNote(state.score.nextFinalizeIndex);
    state.score.nextFinalizeIndex += 1;
  }

  renderScoreCounters();
}

function maybeMarkHit(noteIndex, expectedMidi) {
  if (state.detectedHz == null) {
    return;
  }

  const cents = centsOffFromMidi(state.detectedHz, expectedMidi);
  if (Math.abs(cents) > PITCH_WINDOW_CENTS) {
    return;
  }

  const existing = state.score.results.get(noteIndex) || { hit: false, finalized: false };
  existing.hit = true;
  state.score.results.set(noteIndex, existing);
}

function finalizeNote(noteIndex) {
  const existing = state.score.results.get(noteIndex) || { hit: false, finalized: false };
  if (existing.finalized) {
    return;
  }

  existing.finalized = true;
  state.score.results.set(noteIndex, existing);

  state.score.attempted += 1;
  if (existing.hit) {
    state.score.hits += 1;
  }
}

function renderScoreCounters() {
  const attempted = state.score.attempted;
  const hits = state.score.hits;
  const pct = attempted > 0 ? (hits / attempted) * 100 : 0;

  dom.accuracyPct.textContent = `${pct.toFixed(1)}%`;
  dom.checkedNotes.textContent = String(attempted);

  dom.accuracyPct.className = pct >= 80 ? "good" : pct > 0 ? "bad" : "";
}

function resetPerformanceStats() {
  state.score.attempted = 0;
  state.score.hits = 0;
  state.score.results = new Map();
  state.score.nextFinalizeIndex = 0;
  renderScoreCounters();
}

async function startMicrophone() {
  try {
    state.mic.context = new (window.AudioContext || window.webkitAudioContext)();
    state.mic.stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true
      }
    });

    const source = state.mic.context.createMediaStreamSource(state.mic.stream);
    state.mic.analyser = state.mic.context.createAnalyser();
    state.mic.analyser.fftSize = 2048;
    source.connect(state.mic.analyser);

    state.mic.running = true;
    dom.micBtn.textContent = "Stop Mic";
    setStatus("Microphone active.");
    readPitchFrame();
  } catch (err) {
    setStatus(`Microphone error: ${err.message}`);
  }
}

function stopMicrophone() {
  if (state.mic.rafId) {
    cancelAnimationFrame(state.mic.rafId);
  }

  if (state.mic.stream) {
    state.mic.stream.getTracks().forEach((track) => track.stop());
  }

  if (state.mic.context) {
    state.mic.context.close();
  }

  state.mic.running = false;
  state.mic.context = null;
  state.mic.analyser = null;
  state.mic.stream = null;
  state.mic.rafId = null;
  state.detectedHz = null;
  dom.detectedNote.textContent = "--";
  dom.micBtn.textContent = "Start Mic";
  setStatus("Microphone stopped.");
}

function readPitchFrame() {
  if (!state.mic.running || !state.mic.analyser || !state.mic.context) {
    return;
  }

  const buffer = new Float32Array(state.mic.analyser.fftSize);
  state.mic.analyser.getFloatTimeDomainData(buffer);

  const frequency = autoCorrelate(buffer, state.mic.context.sampleRate);
  if (frequency > 0) {
    state.detectedHz = frequency;
    const midi = noteFromFrequency(frequency);
    const note = midiToNoteName(midi);
    dom.detectedNote.textContent = note;
  } else {
    state.detectedHz = null;
    dom.detectedNote.textContent = "--";
  }

  state.mic.rafId = requestAnimationFrame(readPitchFrame);
}

function autoCorrelate(buffer, sampleRate) {
  let size = buffer.length;
  let rms = 0;

  for (let i = 0; i < size; i += 1) {
    rms += buffer[i] * buffer[i];
  }

  rms = Math.sqrt(rms / size);
  if (rms < 0.01) {
    return -1;
  }

  let r1 = 0;
  let r2 = size - 1;
  const threshold = 0.2;

  for (let i = 0; i < size / 2; i += 1) {
    if (Math.abs(buffer[i]) < threshold) {
      r1 = i;
      break;
    }
  }

  for (let i = 1; i < size / 2; i += 1) {
    if (Math.abs(buffer[size - i]) < threshold) {
      r2 = size - i;
      break;
    }
  }

  const clipped = buffer.slice(r1, r2);
  size = clipped.length;

  const correlations = new Array(size).fill(0);
  for (let i = 0; i < size; i += 1) {
    for (let j = 0; j < size - i; j += 1) {
      correlations[i] += clipped[j] * clipped[j + i];
    }
  }

  let d = 0;
  while (d + 1 < size && correlations[d] > correlations[d + 1]) {
    d += 1;
  }

  let maxValue = -1;
  let maxPos = -1;
  for (let i = d; i < size; i += 1) {
    if (correlations[i] > maxValue) {
      maxValue = correlations[i];
      maxPos = i;
    }
  }

  if (maxPos <= 0) {
    return -1;
  }

  return sampleRate / maxPos;
}

function noteFromFrequency(frequency) {
  return Math.round(12 * (Math.log(frequency / 440) / Math.log(2)) + 69);
}

function midiToFrequency(midi) {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

function centsOffFromMidi(frequency, midi) {
  const target = midiToFrequency(midi);
  return 1200 * Math.log2(frequency / target);
}

function midiToNoteName(midi) {
  const safeMidi = Math.max(0, Math.min(127, Math.round(midi)));
  const noteName = NOTE_NAMES[safeMidi % 12];
  const octave = Math.floor(safeMidi / 12) - 1;
  return `${noteName}${octave}`;
}

function updateExpected(noteLabel) {
  dom.expectedNote.textContent = noteLabel;
}

function setStatus(message) {
  dom.status.textContent = message;
}

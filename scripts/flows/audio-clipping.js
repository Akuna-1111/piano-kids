/**
 * 验证「连续按键盘嘈杂」的修复：离线复现真实弹奏，量输出峰值与削波。
 *
 * 在页面里 import 应用**自己的**代码（`PianoVoice` / 音色预设 / `mixHeadroom`），
 * 用 `OfflineAudioContext` 搭一条与 `AudioEngine` 完全相同的信号链：
 *
 *   voice → pianoBus(余量) → dry + reverb → limiter → master(音量) → 软削波 → 输出
 *
 * 用法：npm run shot -- "#/" --script scripts/flows/audio-clipping.js
 */

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

for (let i = 0; i < 100 && !document.querySelector('.app'); i += 1) await sleep(100);

const { PianoVoice } = await import('/src/core/audio/PianoSynth.ts');
const { getVoicePreset } = await import('/src/core/audio/voicePresets.ts');
const { Reverb } = await import('/src/core/audio/Reverb.ts');
const { PIANO_BUS_HEADROOM, SOFT_CLIP_CEILING, createSoftClipCurve, softClipSample } =
  await import('/src/core/audio/mixHeadroom.ts');

const SAMPLE_RATE = 48000;
const REVERB_SEND = 0.19;
const HARD_CLIP = 0.999;

/** 与 AudioEngine 一致的一条链；`fixed=false` 时用来复现修复前的配置。 */
function buildChain(ctx, volume, fixed) {
  const limiter = ctx.createDynamicsCompressor();
  limiter.threshold.value = fixed ? -2 : -10;
  limiter.knee.value = fixed ? 4 : 12;
  limiter.ratio.value = fixed ? 12 : 6;
  limiter.attack.value = fixed ? 0.001 : 0.003;
  limiter.release.value = fixed ? 0.12 : 0.25;

  const pianoBus = ctx.createGain();
  pianoBus.gain.value = fixed ? PIANO_BUS_HEADROOM : 1;

  const dryGain = ctx.createGain();
  dryGain.gain.value = 1;

  const reverb = new Reverb(ctx, { durationSec: 1.15, decay: 2.9 });
  const reverbSend = ctx.createGain();
  reverbSend.gain.value = REVERB_SEND;

  const master = ctx.createGain();
  master.gain.value = volume;

  pianoBus.connect(dryGain);
  dryGain.connect(limiter);
  pianoBus.connect(reverbSend);
  reverbSend.connect(reverb.input);
  reverb.output.connect(limiter);
  limiter.connect(master);

  if (fixed) {
    const pre = ctx.createGain();
    pre.gain.value = 1 / SOFT_CLIP_CEILING;
    master.connect(pre);
    const shaper = ctx.createWaveShaper();
    shaper.curve = createSoftClipCurve();
    shaper.oversample = '2x';
    pre.connect(shaper);
    shaper.connect(ctx.destination);
  } else {
    master.connect(ctx.destination);
  }

  return { pianoBus };
}

const NOTES = ['C4', 'D4', 'E4', 'F4', 'G4', 'A4', 'B4', 'C5'];

async function renderBurst({ presetId, notes, repeats, intervalMs, holdMs, totalSec, fixed, volume }) {
  const ctx = new OfflineAudioContext(2, Math.ceil(SAMPLE_RATE * totalSec), SAMPLE_RATE);
  const { pianoBus } = buildChain(ctx, volume, fixed);
  const preset = getVoicePreset(presetId);
  const noise = (() => {
    const length = Math.floor(SAMPLE_RATE * 0.06);
    const buffer = ctx.createBuffer(1, length, SAMPLE_RATE);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i += 1) data[i] = (Math.random() * 2 - 1) * (1 - i / length);
    return buffer;
  })();

  const held = new Map();
  let index = 0;
  for (let r = 0; r < repeats; r += 1) {
    for (const note of notes) {
      const when = 0.05 + index * (intervalMs / 1000);
      index += 1;
      held.get(note)?.stopNow(when);
      const midi = 60 + NOTES.indexOf(note);
      const voice = new PianoVoice({
        ctx,
        destination: pianoBus,
        frequency: 440 * Math.pow(2, (midi - 69) / 12),
        velocity: 0.85,
        when,
        note,
        noiseBuffer: noise,
        preset,
      });
      held.set(note, voice);
      voice.release(when + holdMs / 1000);
    }
  }

  const buffer = await ctx.startRendering();
  const left = buffer.getChannelData(0);
  const right = buffer.getChannelData(1);
  let peak = 0;
  let hardClipped = 0;
  let sumSquares = 0;
  for (let i = 0; i < left.length; i += 1) {
    const magnitude = Math.max(Math.abs(left[i]), Math.abs(right[i]));
    if (magnitude > peak) peak = magnitude;
    if (magnitude >= HARD_CLIP) hardClipped += 1;
    sumSquares += left[i] * left[i] + right[i] * right[i];
  }
  return {
    峰值: Number(peak.toFixed(3)),
    硬削波: hardClipped,
    RMS: Number(Math.sqrt(sumSquares / (left.length * 2)).toFixed(3)),
  };
}

const SCENARIOS = [
  { name: '单音', notes: ['C4'], repeats: 1, intervalMs: 0, holdMs: 600, totalSec: 3 },
  { name: '三音和弦', notes: ['C4', 'E4', 'G4'], repeats: 1, intervalMs: 0, holdMs: 400, totalSec: 3 },
  { name: '八音全按', notes: NOTES, repeats: 1, intervalMs: 0, holdMs: 400, totalSec: 3 },
  { name: '连续单音 16 下', notes: ['C4'], repeats: 16, intervalMs: 110, holdMs: 60, totalSec: 3 },
  { name: '八键连按 4 轮', notes: NOTES, repeats: 4, intervalMs: 70, holdMs: 50, totalSec: 3.5 },
  { name: '八键疯狂连按 6 轮', notes: NOTES, repeats: 6, intervalMs: 45, holdMs: 35, totalSec: 4 },
];

const rows = [];
for (const fixed of [false, true]) {
  for (const volume of [0.8, 1]) {
    for (const presetId of ['grand', 'electric']) {
      for (const scenario of SCENARIOS) {
        const result = await renderBurst({ ...scenario, presetId, fixed, volume });
        rows.push({
          版本: fixed ? '修复后' : '修复前',
          音色: presetId,
          音量: volume,
          场景: scenario.name,
          ...result,
        });
      }
    }
  }
}

// 顺便核对纯函数：软削波对任意输入都不触顶
const worstSoftClip = [1, 2, 4, 8, 64, 1000].map((x) => Number(softClipSample(x).toFixed(9)));

return JSON.stringify({ rows, worstSoftClip }, null, 2);

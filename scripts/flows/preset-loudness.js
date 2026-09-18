/**
 * 量三套音色的响度，用来把切换器做成「等响」的 ——
 * 换音色不该顺带把音量也换掉。
 *
 * 用法：npm run shot -- "#/" --script scripts/flows/preset-loudness.js
 */

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
for (let i = 0; i < 100 && !document.querySelector('.app'); i += 1) await sleep(100);

const { PianoVoice } = await import('/src/core/audio/PianoSynth.ts');
const { getVoicePreset, VOICE_PRESET_IDS } = await import('/src/core/audio/voicePresets.ts');
const { Reverb } = await import('/src/core/audio/Reverb.ts');
const { PIANO_BUS_HEADROOM, SOFT_CLIP_CEILING, createSoftClipCurve } =
  await import('/src/core/audio/mixHeadroom.ts');

const SAMPLE_RATE = 48000;
const NOTES = ['C4', 'D4', 'E4', 'F4', 'G4', 'A4', 'B4', 'C5'];

async function render(presetId, notes, volume) {
  const totalSec = 3;
  const ctx = new OfflineAudioContext(2, Math.ceil(SAMPLE_RATE * totalSec), SAMPLE_RATE);

  const limiter = ctx.createDynamicsCompressor();
  limiter.threshold.value = -2;
  limiter.knee.value = 4;
  limiter.ratio.value = 12;
  limiter.attack.value = 0.001;
  limiter.release.value = 0.12;
  const pianoBus = ctx.createGain();
  pianoBus.gain.value = PIANO_BUS_HEADROOM;
  const dry = ctx.createGain();
  dry.gain.value = 1;
  const reverb = new Reverb(ctx, { durationSec: 1.15, decay: 2.9 });
  const send = ctx.createGain();
  send.gain.value = 0.19;
  const master = ctx.createGain();
  master.gain.value = volume;
  const pre = ctx.createGain();
  pre.gain.value = 1 / SOFT_CLIP_CEILING;
  const shaper = ctx.createWaveShaper();
  shaper.curve = createSoftClipCurve();
  shaper.oversample = '2x';

  pianoBus.connect(dry);
  dry.connect(limiter);
  pianoBus.connect(send);
  send.connect(reverb.input);
  reverb.output.connect(limiter);
  limiter.connect(master);
  master.connect(pre);
  pre.connect(shaper);
  shaper.connect(ctx.destination);

  const noiseLen = Math.floor(SAMPLE_RATE * 0.06);
  const noise = ctx.createBuffer(1, noiseLen, SAMPLE_RATE);
  const noiseData = noise.getChannelData(0);
  for (let i = 0; i < noiseLen; i += 1) noiseData[i] = (Math.random() * 2 - 1) * (1 - i / noiseLen);

  const preset = getVoicePreset(presetId);
  notes.forEach((note, index) => {
    const when = 0.05;
    new PianoVoice({
      ctx,
      destination: pianoBus,
      frequency: 440 * Math.pow(2, (60 + NOTES.indexOf(note) - 69) / 12),
      velocity: 0.85,
      when,
      note,
      noiseBuffer: noise,
      preset,
    }).release(when + 0.5 + index * 0.0001);
  });

  const buffer = await ctx.startRendering();
  const left = buffer.getChannelData(0);
  const right = buffer.getChannelData(1);
  let peak = 0;
  let sumSquares = 0;
  for (let i = 0; i < left.length; i += 1) {
    const magnitude = Math.max(Math.abs(left[i]), Math.abs(right[i]));
    if (magnitude > peak) peak = magnitude;
    sumSquares += left[i] * left[i] + right[i] * right[i];
  }
  return {
    peak: Number(peak.toFixed(3)),
    rms: Number(Math.sqrt(sumSquares / (left.length * 2)).toFixed(4)),
  };
}

const rows = [];
for (const presetId of VOICE_PRESET_IDS) {
  const single = await render(presetId, ['C4'], 0.8);
  const chord = await render(presetId, NOTES, 0.8);
  rows.push({ presetId, 单音峰值: single.peak, 单音RMS: single.rms, 八音峰值: chord.peak, 八音RMS: chord.rms });
}

// 以三角钢琴为基准，算出等响所需的增益
const reference = rows.find((r) => r.presetId === 'grand');
for (const row of rows) {
  row.相对三角琴_dB = Number((20 * Math.log10(reference.单音RMS / row.单音RMS)).toFixed(1));
  row.建议增益 = Number((reference.单音RMS / row.单音RMS).toFixed(2));
}

return JSON.stringify({ rows }, null, 2);

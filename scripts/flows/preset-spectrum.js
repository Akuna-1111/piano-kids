/**
 * 量三套音色「听起来有多不一样」：渲染同一个音，做频谱分析，逐频段对比。
 *
 * 需求是「三角钢琴和立式钢琴差别不大」，所以这里给的是**客观的频谱差**：
 * 只改明暗（频谱斜率）的话，听起来只是「同一台琴蒙了块布」；
 * 真正的乐器差别体现在**共振的形状**上，所以重点看中低频段的差异。
 *
 * 用法：npm run shot -- "#/" --script scripts/flows/preset-spectrum.js
 */

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
for (let i = 0; i < 100 && !document.querySelector('.app'); i += 1) await sleep(100);

const { PianoVoice } = await import('/src/core/audio/PianoSynth.ts');
const { getVoicePreset, VOICE_PRESET_IDS } = await import('/src/core/audio/voicePresets.ts');
const { PIANO_BUS_HEADROOM, SOFT_CLIP_CEILING, createSoftClipCurve } =
  await import('/src/core/audio/mixHeadroom.ts');

const SAMPLE_RATE = 48000;

/** 渲染一个音，返回前 400ms 的样本（起音段最能体现音色）。 */
async function renderNote(presetId, note, midi) {
  const ctx = new OfflineAudioContext(1, SAMPLE_RATE * 2, SAMPLE_RATE);

  // 与 AudioEngine 同一条链：总线余量 → 琴体共鸣（共享）→ 干声 → 软削波
  const bus = ctx.createGain();
  bus.gain.value = PIANO_BUS_HEADROOM;

  const preset = getVoicePreset(presetId);
  let node = bus;
  for (const band of preset.bodyResonances) {
    const filter = ctx.createBiquadFilter();
    filter.type = 'peaking';
    filter.frequency.value = Math.min(SAMPLE_RATE * 0.45, band.frequency);
    filter.Q.value = band.q;
    filter.gain.value = band.gainDb;
    node.connect(filter);
    node = filter;
  }
  const pre = ctx.createGain();
  pre.gain.value = 1 / SOFT_CLIP_CEILING;
  const shaper = ctx.createWaveShaper();
  shaper.curve = createSoftClipCurve();
  node.connect(pre);
  pre.connect(shaper);
  shaper.connect(ctx.destination);

  const noiseLen = Math.floor(SAMPLE_RATE * 0.06);
  const noise = ctx.createBuffer(1, noiseLen, SAMPLE_RATE);
  const data = noise.getChannelData(0);
  for (let i = 0; i < noiseLen; i += 1) data[i] = (Math.random() * 2 - 1) * (1 - i / noiseLen);

  new PianoVoice({
    ctx,
    destination: bus,
    frequency: 440 * Math.pow(2, (midi - 69) / 12),
    velocity: 0.85,
    when: 0.02,
    note,
    noiseBuffer: noise,
    preset,
  }).release(1.2);

  const buffer = await ctx.startRendering();
  return buffer.getChannelData(0);
}

/** 用 Goertzel 算法量某个频率上的能量（比做完整 FFT 省事，且只要关心的频段）。 */
function bandEnergy(samples, frequency, from = 0.02, to = 0.42) {
  const start = Math.floor(from * SAMPLE_RATE);
  const end = Math.min(samples.length, Math.floor(to * SAMPLE_RATE));
  const k = (frequency * 2 * Math.PI) / SAMPLE_RATE;
  const coeff = 2 * Math.cos(k);
  let s1 = 0;
  let s2 = 0;
  for (let i = start; i < end; i += 1) {
    const s0 = samples[i] + coeff * s1 - s2;
    s2 = s1;
    s1 = s0;
  }
  return Math.sqrt(s1 * s1 + s2 * s2 - coeff * s1 * s2) / (end - start);
}

const BANDS = [80, 140, 220, 330, 470, 620, 900, 1300, 1800, 2600, 3800, 5500, 8000];

/** 量一套音色在 C4（261.6Hz）上的频谱包络。 */
async function spectrum(presetId) {
  const samples = await renderNote(presetId, 'C4', 60);
  const values = BANDS.map((frequency) => bandEnergy(samples, frequency));
  const reference = Math.max(...values);
  return values.map((value) => 20 * Math.log10((value || 1e-9) / reference));
}

const spectra = {};
for (const presetId of VOICE_PRESET_IDS) spectra[presetId] = await spectrum(presetId);

const grand = spectra.grand;
const upright = spectra.upright;
const electric = spectra.electric;

const rows = BANDS.map((frequency, index) => ({
  Hz: frequency,
  三角: Number(grand[index].toFixed(1)),
  立式: Number(upright[index].toFixed(1)),
  电钢: Number(electric[index].toFixed(1)),
  '立式-三角_dB': Number((upright[index] - grand[index]).toFixed(1)),
}));

const diffsUpright = rows.map((r) => Math.abs(r['立式-三角_dB']));
const diffsElectric = rows.map((r) => Math.abs(r.电钢 - r.三角));

return JSON.stringify(
  {
    rows,
    对比: {
      '立式 vs 三角：最大频段差(dB)': Math.max(...diffsUpright),
      '立式 vs 三角：平均频段差(dB)': Number(
        (diffsUpright.reduce((a, b) => a + b, 0) / diffsUpright.length).toFixed(1),
      ),
      '电钢 vs 三角：最大频段差(dB)': Math.max(...diffsElectric),
      '电钢 vs 三角：平均频段差(dB)': Number(
        (diffsElectric.reduce((a, b) => a + b, 0) / diffsElectric.length).toFixed(1),
      ),
      判据: '平均频段差 < 3dB 基本听不出是两台琴；> 5dB 会明确是两种乐器',
    },
  },
  null,
  2,
);

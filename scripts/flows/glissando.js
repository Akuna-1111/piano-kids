/**
 * 诊断「连续滑动琴键有嘈杂音」—— 第二版。
 *
 * 第一版（`glissando.js` 初版）的结论：削波前峰值只有 0.93、RMS 损失 0%，
 * 击弦噪声 / 制音器 / 混响 / 声部堆积**都不是原因**。
 * 但那一版**漏了琴体共振（cabinet）**—— 真实链条是
 * `voice → pianoBus → cabinet → limiter → master → 软削波`，
 * 而 cabinet 的三角钢琴预设是 `[90Hz +3.2, 330Hz −2.8, 2.6kHz +2.8, 5.2kHz +1.5]`。
 * **它抬的正是低音**，而 15 / 25 键才包含低音区 —— 与「键越多越明显」完全吻合。
 *
 * 这一版把 cabinet 加回去，并且换掉失明的指标：
 *   · 超过拐点的样本比例（饱和深度，比「硬削波样本数」灵敏 —— 后者在有软削波时恒为 0）
 *   · 频谱平坦度（Welch 谱 几何均值/算术均值）= 「沙沙 / 嘈杂」的客观代理
 *   · 包络 3–20Hz 调制占比 = 半音相邻造成的**粗糙感**（拍频），这是「键越多越难听」的另一条线索
 *   · 低频能量占比 <300Hz
 *
 * 用法：npm run shot -- "#/" --script scripts/flows/glissando.js
 */

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
for (let i = 0; i < 100 && !document.querySelector('.app'); i += 1) await sleep(100);

const { PianoVoice } = await import('/src/core/audio/PianoSynth.ts');
const { getVoicePreset } = await import('/src/core/audio/voicePresets.ts');
const { Reverb } = await import('/src/core/audio/Reverb.ts');
const { PIANO_BUS_HEADROOM, SOFT_CLIP_CEILING, SOFT_CLIP_KNEE, createSoftClipCurve } =
  await import('/src/core/audio/mixHeadroom.ts');
const { getPlayableMidi } = await import('/src/features/piano/pianoLayout.ts');
const { midiToFrequency, midiToNoteName, noteToMidi } = await import('/src/core/audio/notes.ts');

const SAMPLE_RATE = 48000;
const REVERB_SEND = 0.19;
const KNEE = SOFT_CLIP_KNEE;
const BLACK = new Set([1, 3, 6, 8, 10]);

function makeNoise(ctx, seed) {
  const length = Math.floor(SAMPLE_RATE * 0.06);
  const buffer = ctx.createBuffer(1, length, SAMPLE_RATE);
  const data = buffer.getChannelData(0);
  let state = seed >>> 0;
  for (let i = 0; i < length; i += 1) {
    state = (state * 1664525 + 1013904223) >>> 0;
    data[i] = ((state / 4294967296) * 2 - 1) * (1 - i / length);
  }
  return buffer;
}

function buildChain(ctx, { withClipper, withCabinet, reverbSend, preset }) {
  const limiter = ctx.createDynamicsCompressor();
  limiter.threshold.value = -2;
  limiter.knee.value = 4;
  limiter.ratio.value = 12;
  limiter.attack.value = 0.001;
  limiter.release.value = 0.12;

  const pianoBus = ctx.createGain();
  pianoBus.gain.value = PIANO_BUS_HEADROOM;

  let busTail = pianoBus;
  if (withCabinet) {
    // 与 AudioEngine.rebuildCabinet 一致：串一串 peaking，频率受奈奎斯特限制
    for (const resonance of preset.bodyResonances) {
      const filter = ctx.createBiquadFilter();
      filter.type = 'peaking';
      filter.frequency.value = Math.min(resonance.frequency, SAMPLE_RATE * 0.45);
      filter.Q.value = resonance.q;
      filter.gain.value = resonance.gainDb;
      busTail.connect(filter);
      busTail = filter;
    }
  }

  const dryGain = ctx.createGain();
  dryGain.gain.value = 1;
  const reverb = new Reverb(ctx, { durationSec: 1.15, decay: 2.9 });
  const reverbSendGain = ctx.createGain();
  reverbSendGain.gain.value = reverbSend;
  const master = ctx.createGain();
  master.gain.value = 0.8;

  busTail.connect(dryGain);
  dryGain.connect(limiter);
  busTail.connect(reverbSendGain);
  reverbSendGain.connect(reverb.input);
  reverb.output.connect(limiter);
  limiter.connect(master);

  if (withClipper) {
    const pre = ctx.createGain();
    pre.gain.value = 1 / SOFT_CLIP_CEILING;
    const shaper = ctx.createWaveShaper();
    shaper.curve = createSoftClipCurve();
    shaper.oversample = '2x';
    master.connect(pre);
    pre.connect(shaper);
    shaper.connect(ctx.destination);
  } else {
    master.connect(ctx.destination);
  }
  return { pianoBus };
}

/** 滑动一圈：滑过去再滑回来 */
function scheduleFor(midis, { stepMs, laps }) {
  const events = [];
  let t = 0.08;
  for (let lap = 0; lap < laps; lap += 1) {
    const order = lap % 2 === 0 ? midis : [...midis].reverse();
    for (const midi of order) {
      events.push({ midi, when: t });
      t += stepMs / 1000;
    }
  }
  return { events, totalSec: t + 3 };
}

/** Welch 谱 + 三个感知指标 */
function analyse(left, right) {
  const N = 1024;
  const hop = 8192;
  const window = new Float64Array(N);
  for (let i = 0; i < N; i += 1) window[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (N - 1));
  const power = new Float64Array(N / 2);
  let frames = 0;
  const re = new Float64Array(N);
  const im = new Float64Array(N);
  for (let start = 0; start + N <= left.length; start += hop) {
    for (let i = 0; i < N; i += 1) {
      re[i] = (left[start + i] + right[start + i]) * 0.5 * window[i];
      im[i] = 0;
    }
    // 朴素 DFT（N=1024 足够小，且只在探针里跑）
    for (let k = 1; k < N / 2; k += 1) {
      let sr = 0;
      let si = 0;
      const w = (-2 * Math.PI * k) / N;
      for (let i = 0; i < N; i += 1) {
        const a = w * i;
        sr += re[i] * Math.cos(a);
        si += re[i] * Math.sin(a);
      }
      power[k] += sr * sr + si * si;
    }
    frames += 1;
  }
  let logSum = 0;
  let linSum = 0;
  let lowSum = 0;
  let highSum = 0;
  const bins = N / 2 - 1;
  for (let k = 1; k < N / 2; k += 1) {
    const value = Math.max(power[k] / Math.max(frames, 1), 1e-18);
    logSum += Math.log(value);
    linSum += value;
    const hz = (k * SAMPLE_RATE) / N;
    if (hz < 300) lowSum += value;
    if (hz > 2000 && hz < 6000) highSum += value;
  }
  const flatness = Math.exp(logSum / bins) / (linSum / bins);

  // 包络 3–20Hz 调制占比（粗糙感 / 拍频）
  const block = 240; // → 200Hz 包络
  const envLength = Math.floor(left.length / block);
  const env = new Float64Array(envLength);
  for (let i = 0; i < envLength; i += 1) {
    let sum = 0;
    for (let j = 0; j < block; j += 1) {
      sum += Math.abs(left[i * block + j]) + Math.abs(right[i * block + j]);
    }
    env[i] = sum / (block * 2);
  }
  let mean = 0;
  for (let i = 0; i < envLength; i += 1) mean += env[i];
  mean /= Math.max(envLength, 1);
  let modulation = 0;
  let total = 0;
  for (let i = 0; i < envLength; i += 1) {
    const d = env[i] - mean;
    total += d * d;
  }
  // 3–20Hz 带通（用 200Hz 采样率下的二阶 IIR 近似）
  const f0 = 10;
  const w0 = (2 * Math.PI * f0) / 200;
  const alpha = Math.sin(w0) / (2 * 1.2);
  const b0 = alpha;
  const b1 = 0;
  const b2 = -alpha;
  const a0 = 1 + alpha;
  const a1 = -2 * Math.cos(w0);
  const a2 = 1 - alpha;
  let x1 = 0;
  let x2 = 0;
  let y1 = 0;
  let y2 = 0;
  for (let i = 0; i < envLength; i += 1) {
    const x = env[i] - mean;
    const y = (b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2) / a0;
    x2 = x1;
    x1 = x;
    y2 = y1;
    y1 = y;
    modulation += y * y;
  }
  return {
    flatness,
    roughness: Math.sqrt(modulation / Math.max(total, 1e-12)),
    lowShare: lowSum / Math.max(linSum, 1e-12),
    highShare: highSum / Math.max(linSum, 1e-12),
  };
}

async function render({ midis, stepMs, laps, preset, withClipper, withCabinet, reverbSend, velocity, damperOverride, killPrevious }) {
  const { events, totalSec } = scheduleFor(midis, { stepMs, laps });
  const ctx = new OfflineAudioContext(2, Math.ceil(SAMPLE_RATE * totalSec), SAMPLE_RATE);
  const voicePreset = damperOverride ? { ...preset, damperTimeConstant: () => damperOverride } : preset;
  const { pianoBus } = buildChain(ctx, { withClipper, withCabinet, reverbSend, preset });
  const noise = makeNoise(ctx, 12345);
  let previous = null;

  for (const event of events) {
    if (killPrevious && previous) previous.stopNow(event.when);
    const voice = new PianoVoice({
      ctx,
      destination: pianoBus,
      frequency: midiToFrequency(event.midi),
      velocity,
      when: event.when,
      note: midiToNoteName(event.midi),
      noiseBuffer: noise,
      preset: voicePreset,
    });
    voice.release(event.when + 0.07);
    previous = voice;
  }

  const buffer = await ctx.startRendering();
  const left = buffer.getChannelData(0);
  const right = buffer.getChannelData(1);
  let peak = 0;
  let over = 0;
  let sumSquares = 0;
  for (let i = 0; i < left.length; i += 1) {
    const magnitude = Math.max(Math.abs(left[i]), Math.abs(right[i]));
    if (magnitude > peak) peak = magnitude;
    if (magnitude > KNEE) over += 1;
    sumSquares += left[i] * left[i] + right[i] * right[i];
  }
  return {
    peak,
    overKneePct: (over / left.length) * 100,
    rms: Math.sqrt(sumSquares / (left.length * 2)),
    ...analyse(left, right),
  };
}

const grand = getVoicePreset('grand');
const whiteOnly = (size) => getPlayableMidi(size).filter((m) => !BLACK.has(((m % 12) + 12) % 12));
const all = (size) => getPlayableMidi(size);

/** 每个用例：8 键作参照，25 键上逐个换掉一个变量 */
const CASES = [
  { name: '8键·原样', midis: all(8) },
  { name: '15键·原样', midis: all(15) },
  { name: '25键·原样', midis: all(25) },
  { name: '25键·无琴体', midis: all(25), withCabinet: false },
  { name: '25键·只白键', midis: whiteOnly(25) },
  { name: '25键·无混响', midis: all(25), reverbSend: 0 },
  { name: '25键·力度0.5', midis: all(25), velocity: 0.5 },
  { name: '25键·制音0.05s', midis: all(25), damperOverride: 0.05 },
];

const rows = [];
for (const item of CASES) {
  const base = {
    midis: item.midis,
    stepMs: 45,
    laps: 2,
    preset: grand,
    withClipper: true,
    withCabinet: item.withCabinet !== false,
    reverbSend: item.reverbSend ?? REVERB_SEND,
    velocity: item.velocity ?? 0.9,
    damperOverride: item.damperOverride,
    killPrevious: false,
  };
  const linear = await render({ ...base, withClipper: false });
  const out = await render(base);
  rows.push(
    `${item.name.padEnd(16)} 键${String(item.midis.length).padStart(2)} | ` +
      `削波前峰${linear.peak.toFixed(2)} 超拐点${linear.overKneePct.toFixed(1).padStart(4)}% | ` +
      `输出峰${out.peak.toFixed(2)} 超拐点${out.overKneePct.toFixed(1).padStart(4)}% | ` +
      `RMS${out.rms.toFixed(3)} 平坦度${out.flatness.toFixed(4)} 粗糙${out.roughness.toFixed(3)} ` +
      `低频占比${(out.lowShare * 100).toFixed(0)}% 2–6k${(out.highShare * 100).toFixed(0)}%`,
  );
}

return `余量=${PIANO_BUS_HEADROOM} 拐点=${KNEE} 琴体峰=${grand.bodyResonances.map((r) => `${r.frequency}Hz${r.gainDb > 0 ? '+' : ''}${r.gainDb}`).join(' ')}\n${rows.join('\n')}`;

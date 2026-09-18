import { describe, expect, it } from 'vitest';
import { noteToMidi } from './notes';
import {
  DEFAULT_VOICE_PRESET_ID,
  VOICE_PRESETS,
  VOICE_PRESET_IDS,
  getVoicePreset,
  isVoicePresetId,
} from './voicePresets';

/**
 * 音色预设。
 *
 * 「好不好听」测不了，但**造成「电子琴感」的那些参数**可以：
 *
 *  1. 力度必须改变**音色**（频谱倾斜的形状），而不只是音量 —— 这是最主要的差别
 *  2. 必须有琴体共鸣（音板 / 箱体），否则就是干声
 *  3. 三套预设必须**真的不一样**，否则切换器是摆设
 */

describe('音色预设：注册表', () => {
  it('三套预设都有 id / 名字 / 描述，且 id 与键一致', () => {
    for (const id of VOICE_PRESET_IDS) {
      const preset = VOICE_PRESETS[id];
      expect(preset.id).toBe(id);
      expect(preset.name.length).toBeGreaterThan(1);
      expect(preset.description.length).toBeGreaterThan(4);
    }
    expect(Object.keys(VOICE_PRESETS).sort()).toEqual([...VOICE_PRESET_IDS].sort());
  });

  it('默认音色是三角钢琴 —— 也就是原来那套参数', () => {
    expect(DEFAULT_VOICE_PRESET_ID).toBe('grand');
    expect(getVoicePreset(DEFAULT_VOICE_PRESET_ID).name).toBe('三角钢琴');
  });

  it('未知 / 空 id 都回落到默认音色，而不是崩掉', () => {
    for (const bad of [null, undefined, '', 'nonsense', 'GRAND']) {
      expect(getVoicePreset(bad).id).toBe(DEFAULT_VOICE_PRESET_ID);
    }
    expect(isVoicePresetId('grand')).toBe(true);
    expect(isVoicePresetId('nonsense')).toBe(false);
    expect(isVoicePresetId(42)).toBe(false);
    expect(isVoicePresetId(null)).toBe(false);
  });
});

describe('音色预设：力度必须改变音色，而不只是音量', () => {
  const midi = noteToMidi('C4')!;

  it('敲得越重，高次分音被抬得越多（这是「像不像钢琴」的关键）', () => {
    for (const id of VOICE_PRESET_IDS) {
      const preset = VOICE_PRESETS[id];
      const soft = preset.spectralTilt(10, 0.2);
      const hard = preset.spectralTilt(10, 1);
      expect(hard, `${preset.name} 的高次分音应随力度变亮`).toBeGreaterThan(soft * 1.5);
    }
  });

  it('倾斜是「形状」变化：越高的分音随力度变化越大', () => {
    // 只给一个统一倍率的话，不管怎么调都会回到电子琴的听感
    for (const id of VOICE_PRESET_IDS) {
      const preset = VOICE_PRESETS[id];
      const lowRatio = preset.spectralTilt(4, 1) / preset.spectralTilt(4, 0.2);
      const highRatio = preset.spectralTilt(14, 1) / preset.spectralTilt(14, 0.2);
      expect(highRatio, `${preset.name} 的第 14 分音应比第 4 分音变化更大`).toBeGreaterThan(lowRatio);
    }
  });

  it('前两个分音不随力度变化（真实钢琴的基频与八度一直很稳）', () => {
    for (const id of VOICE_PRESET_IDS) {
      const preset = VOICE_PRESETS[id];
      expect(preset.spectralTilt(1, 0.1)).toBe(1);
      expect(preset.spectralTilt(2, 1)).toBe(1);
    }
  });

  it('电钢琴的力度范围最夸张 —— 「bark」就是靠它', () => {
    const dynamicRange = (id: (typeof VOICE_PRESET_IDS)[number]) => {
      const preset = VOICE_PRESETS[id];
      return preset.spectralTilt(12, 1) / preset.spectralTilt(12, 0.2);
    };
    expect(dynamicRange('electric')).toBeGreaterThan(dynamicRange('grand'));
    expect(dynamicRange('grand')).toBeGreaterThan(dynamicRange('upright'));
  });

  it('基频余音：低音比高音长，且中音区都有几秒（否则一定像电子琴）', () => {
    for (const id of VOICE_PRESET_IDS) {
      const preset = VOICE_PRESETS[id];
      const low = preset.fundamentalDecay(noteToMidi('C2')!);
      const mid = preset.fundamentalDecay(noteToMidi('C4')!);
      const high = preset.fundamentalDecay(noteToMidi('C6')!);
      expect(low, preset.name).toBeGreaterThan(mid);
      expect(mid, preset.name).toBeGreaterThan(high);
      // 立式琴的余音本来就短（真实立式琴 C4 大约 2–4 秒），
      // 但**不能短到像电子琴** —— 这里卡的是「秒级」这个量级
      expect(mid, preset.name).toBeGreaterThan(2.5);
    }
    // 三角琴余音最长，立式琴最短（真实乐器就是这样）
    expect(VOICE_PRESETS.grand.fundamentalDecay(midi)).toBeGreaterThan(
      VOICE_PRESETS.upright.fundamentalDecay(midi) * 2,
    );
  });

  it('制音器时间常数：低音比高音慢，且都是「几十毫秒」量级（不是切断）', () => {
    for (const id of VOICE_PRESET_IDS) {
      const preset = VOICE_PRESETS[id];
      const low = preset.damperTimeConstant(noteToMidi('C2')!);
      const high = preset.damperTimeConstant(noteToMidi('C6')!);
      expect(low, preset.name).toBeGreaterThan(high);
      expect(high, preset.name).toBeGreaterThan(0.02);
      expect(low, preset.name).toBeLessThan(0.35);
    }
  });
});

describe('音色预设：琴体共鸣（整台琴共享的形状）', () => {
  it('两套钢琴都有琴体共鸣：足够多的频段、频率在实用范围内、增益不过火', () => {
    for (const id of ['grand', 'upright'] as const) {
      const preset = VOICE_PRESETS[id];
      expect(preset.bodyResonances.length, preset.name).toBeGreaterThanOrEqual(4);
      // 至少有**一段提升** —— 只有挖坑不算「有共鸣」
      expect(
        preset.bodyResonances.some((band) => band.gainDb > 1),
        `${preset.name} 必须有真的共振峰`,
      ).toBe(true);
      for (const band of preset.bodyResonances) {
        expect(band.frequency, preset.name).toBeGreaterThan(60);
        expect(band.frequency, preset.name).toBeLessThan(8000);
        expect(band.q, preset.name).toBeGreaterThan(0.4);
        // §7.3：不做夸张的彩色共鸣，单段增益控制在温和范围内（正负都是）
        expect(Math.abs(band.gainDb), preset.name).toBeLessThan(6);
      }
    }
  });

  it('立式琴的箱体色彩比三角琴更重（对比的是「提升总量」，不是带符号的和）', () => {
    /** 带符号求和没有意义（挖坑会抵消提升），要看「抬起来多少」。 */
    const boostTotal = (id: 'grand' | 'upright') =>
      VOICE_PRESETS[id].bodyResonances.reduce(
        (sum, band) => sum + Math.max(0, band.gainDb),
        0,
      );
    const maxBoost = (id: 'grand' | 'upright') =>
      Math.max(...VOICE_PRESETS[id].bodyResonances.map((band) => band.gainDb));

    expect(boostTotal('upright')).toBeGreaterThan(boostTotal('grand'));
    expect(maxBoost('upright')).toBeGreaterThan(maxBoost('grand'));
  });

  it('两套琴的形状是**不同的形状**，不是同一形状的缩放', () => {
    // 三角琴：中低被挖掉一点（避免盒子味）；立式琴：中低是一个大包（箱子嗡嗡的）
    const grandScoop = Math.min(...VOICE_PRESETS.grand.bodyResonances.map((b) => b.gainDb));
    const uprightAround600 = VOICE_PRESETS.upright.bodyResonances.find(
      (b) => b.frequency > 400 && b.frequency < 900,
    );
    expect(grandScoop).toBeLessThan(0);
    expect(uprightAround600?.gainDb).toBeGreaterThan(3);

    // 三角琴高频是抬的（开盖），立式琴高频是压的（没盖）
    const topBand = (id: 'grand' | 'upright') =>
      VOICE_PRESETS[id].bodyResonances.reduce((highest, band) =>
        band.frequency > highest.frequency ? band : highest,
      );
    expect(topBand('grand').gainDb).toBeGreaterThan(0);
    expect(topBand('upright').gainDb).toBeLessThan(0);
  });
});

describe('音色预设：三套必须真的不一样', () => {
  it('电钢琴是单弦（没有拍频）、不做非谐性、有颤音', () => {
    const electric = VOICE_PRESETS.electric;
    expect(electric.beatDetuneCents).toBe(0);
    expect(electric.beatingPartialCount).toBe(0);
    expect(electric.inharmonicity(60)).toBe(0);
    expect(electric.tremolo).not.toBeNull();
    expect(electric.tremolo!.rateHz).toBeGreaterThan(2);
    expect(electric.tremolo!.rateHz).toBeLessThan(8);
    expect(electric.tremolo!.depth).toBeGreaterThan(0.05);
    // 颤音不能深到变成音量抖动
    expect(electric.tremolo!.depth).toBeLessThan(0.5);
  });

  it('两套钢琴有拍频（同音多弦），电钢琴没有', () => {
    expect(VOICE_PRESETS.grand.beatDetuneCents).toBeGreaterThan(0);
    expect(VOICE_PRESETS.upright.beatDetuneCents).toBeGreaterThan(0);
    expect(VOICE_PRESETS.grand.tremolo).toBeNull();
    expect(VOICE_PRESETS.upright.tremolo).toBeNull();
  });

  it('电钢琴的高次分音基准更干净，靠力度把「铃」抬起来', () => {
    // 基准（不含力度）必须更干净，否则轻触时也会有金属声
    for (const k of [2, 5, 10, 12]) {
      expect(
        VOICE_PRESETS.electric.partialAmplitude(k),
        `第 ${k} 次分音`,
      ).toBeLessThan(VOICE_PRESETS.grand.partialAmplitude(k));
    }
    // 但重击时（含倾斜）必须明显抬起来 —— 这就是「bark」
    const bell = (id: 'grand' | 'electric', velocity: number) => {
      const preset = VOICE_PRESETS[id];
      return preset.partialAmplitude(10) * preset.spectralTilt(10, velocity);
    };
    expect(bell('electric', 1) / bell('electric', 0.2)).toBeGreaterThan(8);
    // 重击时电钢琴的铃要比钢琴的高次分音更突出
    expect(bell('electric', 1)).toBeGreaterThan(bell('grand', 1));
  });

  it('立式琴比三角琴暗：高次分音滚降更陡', () => {
    expect(VOICE_PRESETS.upright.partialAmplitude(8)).toBeLessThan(
      VOICE_PRESETS.grand.partialAmplitude(8),
    );
  });

  it('立式琴的调音偏差比三角琴大，电钢琴最小', () => {
    expect(VOICE_PRESETS.upright.tuningSpreadCents).toBeGreaterThan(
      VOICE_PRESETS.grand.tuningSpreadCents,
    );
    expect(VOICE_PRESETS.electric.tuningSpreadCents).toBeLessThan(
      VOICE_PRESETS.grand.tuningSpreadCents,
    );
  });

  it('每套预设的分音上限都在可接受范围内（不会造出上百个振荡器）', () => {
    for (const id of VOICE_PRESET_IDS) {
      expect(VOICE_PRESETS[id].maxPartial, VOICE_PRESETS[id].name).toBeLessThanOrEqual(20);
    }
  });

  it('电钢琴没有低频击弦噪声，钢琴有（齿上没有毛毡）', () => {
    expect(VOICE_PRESETS.electric.attackNoise?.low ?? null).toBeNull();
    expect(VOICE_PRESETS.grand.attackNoise?.low).not.toBeNull();
    expect(VOICE_PRESETS.upright.attackNoise?.low).not.toBeNull();
  });

  it('三套音色的输出增益做了等响（以三角钢琴为基准）', () => {
    // 换音色不该顺带把音量也换掉
    expect(VOICE_PRESETS.grand.outputGain).toBe(1);
    for (const id of VOICE_PRESET_IDS) {
      const gain = VOICE_PRESETS[id].outputGain;
      expect(gain, VOICE_PRESETS[id].name).toBeGreaterThan(0.5);
      expect(gain, VOICE_PRESETS[id].name).toBeLessThan(2.5);
    }
    // 电钢琴的频谱能量低得多，必须补回来（实测低 4.7dB）
    expect(VOICE_PRESETS.electric.outputGain).toBeGreaterThan(VOICE_PRESETS.grand.outputGain);
  });
});

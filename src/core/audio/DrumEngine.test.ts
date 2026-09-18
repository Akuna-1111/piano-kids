import { describe, expect, it } from 'vitest';
import { DRUM_BUS_GAIN, DrumEngine } from './DrumEngine';

/**
 * 咔声的接线与包络。
 *
 * jsdom 里没有 Web Audio，所以这里用一个**记账用的假上下文**：
 * 它只回答「建了什么节点、参数被设成了什么」—— 这正是这类代码里唯一会出错的部分
 * （接错总线、忘了 stop、包络里出现 0 导致 exponentialRamp 抛错）。
 */
interface RecordedOsc {
  type: string;
  frequency: number;
  started: number | null;
  stopped: number | null;
  connectedTo: unknown[];
}

interface FakeParam {
  value: number;
  setValueAtTime(value: number, at: number): void;
  linearRampToValueAtTime(value: number, at: number): void;
  exponentialRampToValueAtTime(value: number, at: number): void;
}

interface FakeGainNode {
  value: number;
  gain: FakeParam;
  events: string[];
  connectedTo: unknown[];
}

class FakeContext {
  oscillators: RecordedOsc[] = [];
  gains: FakeGainNode[] = [];

  createGain() {
    const node = {
      value: 0,
      events: [] as string[],
      connectedTo: [] as unknown[],
      gain: {
        value: 0,
        setValueAtTime: (value: number, at: number) => node.events.push(`set:${value}@${at}`),
        linearRampToValueAtTime: (value: number, at: number) =>
          node.events.push(`linear:${value}@${at}`),
        exponentialRampToValueAtTime: (value: number, at: number) => {
          // 真 API 在目标值为 0 时会抛错，这里如实模拟
          if (value === 0) throw new Error('exponentialRampToValueAtTime: 目标值不能为 0');
          node.events.push(`exp:${value}@${at}`);
        },
      },
      connect(target: unknown) {
        node.connectedTo.push(target);
      },
      disconnect() {},
    };
    this.gains.push(node);
    return node;
  }

  createOscillator() {
    const record: RecordedOsc = {
      type: 'sine',
      frequency: 0,
      started: null,
      stopped: null,
      connectedTo: [],
    };
    const node = {
      get type() {
        return record.type;
      },
      set type(value: string) {
        record.type = value;
      },
      frequency: {
        get value() {
          return record.frequency;
        },
        set value(next: number) {
          record.frequency = next;
        },
      },
      onended: null as (() => void) | null,
      connect(target: unknown) {
        record.connectedTo.push(target);
      },
      start(at: number) {
        record.started = at;
      },
      stop(at?: number) {
        record.stopped = at ?? -1;
        (node.onended as (() => void) | null)?.();
      },
    };
    this.oscillators.push(record);
    return node;
  }
}

function makeEngine() {
  const ctx = new FakeContext();
  const destination = { name: 'limiter' };
  const engine = new DrumEngine(
    ctx as unknown as AudioContext,
    destination as unknown as AudioNode,
  );
  return { ctx, engine, destination };
}

describe('DrumEngine（节拍器咔声）', () => {
  it('总线接在给定的目标上，并且有独立增益', () => {
    const { ctx, destination } = makeEngine();
    expect(ctx.gains[0].gain.value).toBe(DRUM_BUS_GAIN);
    expect(ctx.gains[0].connectedTo).toEqual([destination]);
  });

  it('一声 = 两个正弦，2ms 起音 + 55ms 指数衰减', () => {
    const { ctx, engine } = makeEngine();
    engine.click(10, false);

    expect(ctx.oscillators).toHaveLength(2);
    for (const osc of ctx.oscillators) {
      expect(osc.type).toBe('sine');
      expect(osc.started).toBe(10);
      expect(osc.stopped).toBeCloseTo(10 + 0.055 + 0.02, 6);
    }
    // 包络：setValue(0) → linear(peak) → exp(极小但非 0)
    const envelope = ctx.gains[1];
    expect(envelope.events[0]).toBe('set:0@10');
    expect(envelope.events[1]).toBe('linear:0.62@10.002');
    expect(envelope.events[2]).toMatch(/^exp:0\.0008@10\.055/);
  });

  it('重拍更高更响（孩子才听得出四拍一组）', () => {
    const { ctx, engine } = makeEngine();
    engine.click(0, true);
    const accentFrequencies = ctx.oscillators.map((osc) => osc.frequency);
    const accentPeak = ctx.gains[1].events[1];

    const plain = makeEngine();
    plain.engine.click(0, false);
    const plainFrequencies = plain.ctx.oscillators.map((osc) => osc.frequency);

    expect(Math.min(...accentFrequencies)).toBeGreaterThan(Math.min(...plainFrequencies));
    expect(accentPeak).toBe('linear:0.9@0.002');
  });

  it('退出时能把已排进时间轴的咔声全部掐掉，不留鬼声', () => {
    const { ctx, engine } = makeEngine();
    engine.click(100, false);
    engine.click(101, true);
    expect(ctx.oscillators).toHaveLength(4);

    engine.stopAll();
    for (const osc of ctx.oscillators) {
      expect(osc.stopped).toBe(-1); // stop() 不带时间参数 = 立即停
    }
  });

  it('包络里不出现 0（真实 API 会抛错）—— 两次点击都不抛', () => {
    const { engine } = makeEngine();
    expect(() => {
      engine.click(0, false);
      engine.click(0.5, true);
    }).not.toThrow();
  });
});

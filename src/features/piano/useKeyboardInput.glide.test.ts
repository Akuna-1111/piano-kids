import { describe, expect, it } from 'vitest';
import {
  GLIDE_HOLD_MS,
  GLIDE_MIN_GAP_MS,
  GLIDE_VELOCITY,
  decideGlideOnset,
} from './useKeyboardInput';

/**
 * 滑奏的发声策略。
 *
 * 背景：手指擦过琴键时，**同样手速在窄键上会触发多几倍的音**
 * （实测 8 键 79ms/音，25 键 24ms/音 = 41 个音/秒），
 * 每个音又都带制音器尾巴 → 听起来是一片嘈杂，而不是滑奏。
 * 之前两次都在电平上找原因（余量 / 软削波），所以没修好：
 * 那种滑动的输出峰值只有 0.90，软削波几乎没工作。
 */
describe('滑奏（glissando）发声策略', () => {
  it('逐键弹奏完全不受影响：力度原样传达', () => {
    expect(decideGlideOnset({ gliding: false, baseVelocity: 0.9, sinceLastOnsetMs: 9999 })).toEqual({
      emit: true,
      velocity: 0.9,
      delayMs: 0,
    });
  });

  it('滑奏的音被压到 GLIDE_VELOCITY（擦过去不是按下去）', () => {
    const decision = decideGlideOnset({ gliding: true, baseVelocity: 0.9, sinceLastOnsetMs: 9999 });
    expect(decision.velocity).toBe(GLIDE_VELOCITY);
    expect(decision.emit).toBe(true);
  });

  it('滑得太快时先不出声，并给出「等多久再补」', () => {
    const decision = decideGlideOnset({ gliding: true, baseVelocity: 0.9, sinceLastOnsetMs: 20 });
    expect(decision.emit).toBe(false);
    expect(decision.delayMs).toBe(GLIDE_MIN_GAP_MS - 20);
  });

  it('间隔刚好够时立刻发声（边界不吞音）', () => {
    const decision = decideGlideOnset({
      gliding: true,
      baseVelocity: 0.9,
      sinceLastOnsetMs: GLIDE_MIN_GAP_MS,
    });
    expect(decision.emit).toBe(true);
    expect(decision.delayMs).toBe(0);
  });

  it('滑奏里更轻的力度不会把更轻的原始力度抬高', () => {
    // 触控笔轻压 0.4：应该保持 0.4，而不是被「上限」提到 0.6
    expect(decideGlideOnset({ gliding: true, baseVelocity: 0.4, sinceLastOnsetMs: 9999 }).velocity).toBe(0.4);
  });

  it('参数自洽：滑奏间隔必须明显短于滑奏判定阈值，否则一次快弹会永久被判成滑奏', () => {
    expect(GLIDE_MIN_GAP_MS).toBeLessThan(GLIDE_HOLD_MS);
    // 上限 ≈ 15 个音/秒：再多就不是「滑奏」而是「一片嘈杂」
    expect(1000 / GLIDE_MIN_GAP_MS).toBeLessThan(20);
    // 滑奏必须比「按下去」轻，否则等于没改
    expect(GLIDE_VELOCITY).toBeLessThan(0.9);
  });
});

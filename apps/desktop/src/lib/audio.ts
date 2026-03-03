// ── Web Audio API Sound System for Synthesis OS ──
// No external dependencies. Pure Web Audio API with lazy initialization.

type SoundType = "click" | "success" | "error" | "synth";

// Lazy AudioContext initialization (browser requires user gesture first)
let audioCtx: AudioContext | null = null;

function getAudioContext(): AudioContext {
    if (!audioCtx) {
        audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
    }
    return audioCtx;
}

// Sound definitions using oscillator frequencies and envelopes
const SOUNDS: Record<SoundType, { freq: number; duration: number; type: OscillatorType; ramp?: number }> = {
    click: { freq: 800, duration: 0.08, type: "sine" },
    success: { freq: 1200, duration: 0.15, type: "sine", ramp: 880 },
    error: { freq: 300, duration: 0.2, type: "square" },
    synth: { freq: 440, duration: 0.3, type: "sine", ramp: 660 },
};

/**
 * Play a sound effect with specified volume.
 * @param type - Sound type: "click", "success", "error", or "synth"
 * @param volume - Volume level 0-100
 */
export function playSound(type: SoundType, volume: number = 50): void {
    try {
        const ctx = getAudioContext();
        const sound = SOUNDS[type];

        const osc = ctx.createOscillator();
        const gain = ctx.createGain();

        osc.connect(gain);
        gain.connect(ctx.destination);

        osc.type = sound.type;
        osc.frequency.setValueAtTime(sound.freq, ctx.currentTime);
        if (sound.ramp) {
            osc.frequency.linearRampToValueAtTime(sound.ramp, ctx.currentTime + sound.duration);
        }

        const vol = (volume / 100) * 0.15; // Scale down for comfortable levels
        gain.gain.setValueAtTime(vol, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + sound.duration);

        osc.start();
        osc.stop(ctx.currentTime + sound.duration);
    } catch {
        // Silently fail if AudioContext not available
    }
}

// Ambient synthesis sound state (loop)
let ambientOsc: OscillatorNode | null = null;
let ambientGain: GainNode | null = null;
let ambientLfo: OscillatorNode | null = null;

/**
 * Start ambient background sound.
 * @param type - "hum" for steady hum, "pulse" for pulsing effect
 * @param volume - Volume level 0-100
 */
export function startAmbientSound(type: "hum" | "pulse", volume: number = 50): void {
    stopAmbientSound();
    try {
        const ctx = getAudioContext();
        ambientOsc = ctx.createOscillator();
        ambientGain = ctx.createGain();

        ambientOsc.connect(ambientGain);
        ambientGain.connect(ctx.destination);

        const vol = (volume / 100) * 0.03; // Very quiet ambient level

        if (type === "hum") {
            ambientOsc.type = "sine";
            ambientOsc.frequency.setValueAtTime(120, ctx.currentTime);
            ambientGain.gain.setValueAtTime(vol, ctx.currentTime);
        } else {
            // Pulse: sine wave with LFO modulation on the gain
            ambientOsc.type = "sine";
            ambientOsc.frequency.setValueAtTime(220, ctx.currentTime);

            ambientLfo = ctx.createOscillator();
            const lfoGain = ctx.createGain();
            ambientLfo.frequency.setValueAtTime(2, ctx.currentTime); // 2Hz pulse
            lfoGain.gain.setValueAtTime(vol * 0.5, ctx.currentTime);
            ambientLfo.connect(lfoGain);
            lfoGain.connect(ambientGain.gain);
            ambientLfo.start();

            ambientGain.gain.setValueAtTime(vol, ctx.currentTime);
        }

        ambientOsc.start();
    } catch {
        // Silently fail
    }
}

/**
 * Stop ambient background sound.
 */
export function stopAmbientSound(): void {
    try {
        ambientOsc?.stop();
        ambientOsc?.disconnect();
        ambientGain?.disconnect();
        ambientLfo?.stop();
        ambientLfo?.disconnect();
    } catch {
        // Already stopped
    }
    ambientOsc = null;
    ambientGain = null;
    ambientLfo = null;
}

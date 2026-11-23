package hu.lepes.app;

/** Same cues as the web engine.js: two short 880 Hz tones = fast, one long 440 Hz tone = slow. */
final class Tones {
    static final int SR = 16000;
    private static final int SHORT = (int) Math.floor(.22 * SR);
    private static final int SECOND = (int) Math.floor(.38 * SR);
    private static final int LONG = (int) Math.floor(.85 * SR);

    private Tones() {}

    /** Fills buf with samples for absolute frames [start, start + buf.length) of a looping cycle. */
    static void fill(short[] buf, long start, int fastFrames, int cycleFrames) {
        long f = start % cycleFrames;
        for (int i = 0; i < buf.length; i++) {
            buf[i] = sample((int) f, fastFrames);
            if (++f == cycleFrames) f = 0;
        }
    }

    /** The 4 second sound test: fast cue at 0 s, slow cue at 2 s. */
    static short[] preview() {
        short[] buf = new short[4 * SR];
        fill(buf, 0, 2 * SR, 4 * SR);
        return buf;
    }

    private static short sample(int f, int fastFrames) {
        if (f < SHORT) return tone(f, .22, 880);
        if (f >= SECOND && f < SECOND + SHORT) return tone(f - SECOND, .22, 880);
        if (f >= fastFrames && f < fastFrames + LONG) return tone(f - fastFrames, .85, 440);
        return 0;
    }

    private static short tone(int i, double duration, double hz) {
        double t = (double) i / SR;
        double envelope = Math.min(1, Math.min(t / .025, (duration - t) / .06));
        return (short) Math.round(.55 * envelope * Math.sin(2 * Math.PI * hz * t) * 32767);
    }
}

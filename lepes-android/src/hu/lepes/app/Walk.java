package hu.lepes.app;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.graphics.drawable.Icon;
import android.media.AudioAttributes;
import android.media.AudioFocusRequest;
import android.media.AudioFormat;
import android.media.AudioManager;
import android.media.AudioTrack;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.os.PowerManager;
import android.os.SystemClock;
import android.os.VibrationEffect;
import android.os.Vibrator;

import java.util.Locale;

/**
 * Walking session engine. Lives in the app process, independent of the UI, so it keeps
 * running while the screen is locked. Audio is generated on the fly and streamed, so the
 * audio clock itself is the timer: no large WAV in memory, no drift.
 */
final class Walk {
    static final int NOTIFICATION_ID = 1;
    private static final String CHANNEL = "walk";
    private static final int SR = Tones.SR;
    private static Walk instance;

    private final Context ctx;
    private final Handler main = new Handler(Looper.getMainLooper());
    private final AudioManager audioManager;
    private final NotificationManager notifications;
    private final AudioAttributes attributes = new AudioAttributes.Builder()
            .setUsage(AudioAttributes.USAGE_MEDIA)
            .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
            .build();
    private final AudioFocusRequest duckRequest;
    private final PowerManager.WakeLock wakeLock;

    private String state = "idle";
    private int fast = 180, slow = 180;
    private boolean vibrate, interrupted, ducked, noisyRegistered;
    private String lastPhase;
    private AudioTrack track, previewTrack;
    private Writer writer;
    /** Frame position where the current track started, and where playback was paused. */
    private long base, pausedAt;

    private final BroadcastReceiver noisy = new BroadcastReceiver() {
        @Override public void onReceive(Context c, Intent i) { pause(true); }
    };
    private final Runnable tick = this::tick;

    static synchronized Walk get(Context c) {
        if (instance == null) instance = new Walk(c.getApplicationContext());
        return instance;
    }

    private Walk(Context ctx) {
        this.ctx = ctx;
        audioManager = ctx.getSystemService(AudioManager.class);
        notifications = ctx.getSystemService(NotificationManager.class);
        duckRequest = new AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_MAY_DUCK)
                .setAudioAttributes(attributes)
                .setOnAudioFocusChangeListener(change -> {})
                .build();
        wakeLock = ctx.getSystemService(PowerManager.class)
                .newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "lepes:walk");
        wakeLock.setReferenceCounted(false);
        NotificationChannel channel = new NotificationChannel(CHANNEL, "Séta", NotificationManager.IMPORTANCE_LOW);
        channel.setDescription("A futó séta állapota és vezérlése");
        channel.setShowBadge(false);
        channel.setSound(null, null);
        channel.enableVibration(false);
        channel.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);
        notifications.createNotificationChannel(channel);
    }

    synchronized void start(int fastSeconds, int slowSeconds, boolean vib) {
        if (fastSeconds < 10 || fastSeconds > 900 || slowSeconds < 10 || slowSeconds > 900) return;
        stopAudio();
        fast = fastSeconds; slow = slowSeconds; vibrate = vib;
        base = 0; pausedAt = 0; lastPhase = null; interrupted = false;
        play();
    }

    synchronized void resume() {
        if (!"paused".equals(state)) return;
        base = pausedAt;
        interrupted = false;
        play();
    }

    synchronized void pause(boolean byInterruption) {
        if (!"playing".equals(state)) return;
        stopAudio();
        state = "paused";
        interrupted = byInterruption;
        cancelVibration();
        updateNotification();
    }

    synchronized void toggle() {
        if ("playing".equals(state)) pause(false); else resume();
    }

    synchronized void stop() {
        stopAudio();
        stopPreview();
        state = "idle";
        base = pausedAt = 0;
        lastPhase = null;
        interrupted = false;
        cancelVibration();
        main.removeCallbacks(tick);
        ctx.stopService(new Intent(ctx, WalkService.class));
        notifications.cancel(NOTIFICATION_ID);
    }

    synchronized void setVibration(boolean on) {
        vibrate = on;
        if (!on) cancelVibration();
    }

    synchronized boolean isIdle() { return "idle".equals(state); }

    synchronized String statusJson() {
        return String.format(Locale.US,
                "{\"state\":\"%s\",\"position\":%.3f,\"fast\":%d,\"slow\":%d,\"interrupted\":%b}",
                state, position(), fast, slow, interrupted);
    }

    synchronized void preview() {
        stopPreview();
        short[] pcm = Tones.preview();
        previewTrack = new AudioTrack.Builder()
                .setAudioAttributes(attributes)
                .setAudioFormat(format())
                .setTransferMode(AudioTrack.MODE_STATIC)
                .setBufferSizeInBytes(pcm.length * 2)
                .build();
        previewTrack.write(pcm, 0, pcm.length);
        previewTrack.play();
        final AudioTrack t = previewTrack;
        main.postDelayed(() -> { synchronized (Walk.this) { if (previewTrack == t) stopPreview(); } }, 4500);
    }

    void vibrateTest() { vibrateFor("fast"); }

    // --- internals ---

    private static AudioFormat format() {
        return new AudioFormat.Builder()
                .setSampleRate(SR)
                .setEncoding(AudioFormat.ENCODING_PCM_16BIT)
                .setChannelMask(AudioFormat.CHANNEL_OUT_MONO)
                .build();
    }

    private void play() {
        stopPreview();
        int min = AudioTrack.getMinBufferSize(SR, AudioFormat.CHANNEL_OUT_MONO, AudioFormat.ENCODING_PCM_16BIT);
        track = new AudioTrack.Builder()
                .setAudioAttributes(attributes)
                .setAudioFormat(format())
                .setTransferMode(AudioTrack.MODE_STREAM)
                .setBufferSizeInBytes(Math.max(min, SR)) // ~0.5 s
                .setPerformanceMode(AudioTrack.PERFORMANCE_MODE_POWER_SAVING)
                .build();
        writer = new Writer(track, base, fast * SR, (fast + slow) * SR);
        track.play();
        writer.start();
        state = "playing";
        wakeLock.acquire(6 * 60 * 60 * 1000L);
        if (!noisyRegistered) {
            IntentFilter filter = new IntentFilter(AudioManager.ACTION_AUDIO_BECOMING_NOISY);
            if (Build.VERSION.SDK_INT >= 33) ctx.registerReceiver(noisy, filter, Context.RECEIVER_NOT_EXPORTED);
            else ctx.registerReceiver(noisy, filter);
            noisyRegistered = true;
        }
        ctx.startForegroundService(new Intent(ctx, WalkService.class));
        updateNotification();
        main.removeCallbacks(tick);
        main.post(tick);
    }

    private void stopAudio() {
        if (track != null) {
            writer.alive = false;
            try { track.pause(); } catch (IllegalStateException ignored) {}
            pausedAt = base + (track.getPlaybackHeadPosition() & 0xffffffffL);
            try { track.flush(); } catch (IllegalStateException ignored) {}
            try { writer.join(500); } catch (InterruptedException ignored) {}
            track.release();
            track = null;
            writer = null;
        }
        if (wakeLock.isHeld()) wakeLock.release();
        if (noisyRegistered) {
            try { ctx.unregisterReceiver(noisy); } catch (IllegalArgumentException ignored) {}
            noisyRegistered = false;
        }
        setDucked(false);
    }

    private void stopPreview() {
        if (previewTrack != null) {
            try { previewTrack.stop(); } catch (IllegalStateException ignored) {}
            previewTrack.release();
            previewTrack = null;
        }
    }

    private double position() {
        if ("playing".equals(state) && track != null) {
            return (base + (track.getPlaybackHeadPosition() & 0xffffffffL)) / (double) SR;
        }
        return pausedAt / (double) SR;
    }

    private synchronized void tick() {
        if (!"playing".equals(state)) return;
        double cycle = position() % (fast + slow);
        boolean isFast = cycle < fast;
        String phase = isFast ? "fast" : "slow";
        if (!phase.equals(lastPhase)) {
            lastPhase = phase;
            if (vibrate) vibrateFor(phase);
            updateNotification();
        }
        // Duck other apps' audio (music, podcasts) only around each cue, so they keep playing.
        double sinceCue = isFast ? cycle : cycle - fast;
        double toNextCue = isFast ? fast - cycle : fast + slow - cycle;
        setDucked(sinceCue < 1.1 || toNextCue < 0.6);
        main.postDelayed(tick, 250);
    }

    private void setDucked(boolean on) {
        if (on == ducked) return;
        if (on) ducked = audioManager.requestAudioFocus(duckRequest) == AudioManager.AUDIOFOCUS_REQUEST_GRANTED;
        else { audioManager.abandonAudioFocusRequest(duckRequest); ducked = false; }
    }

    private void vibrateFor(String phase) {
        Vibrator v = ctx.getSystemService(Vibrator.class);
        if (v == null || !v.hasVibrator()) return;
        VibrationEffect effect = "fast".equals(phase)
                ? VibrationEffect.createWaveform(new long[]{0, 180, 130, 180}, -1)
                : VibrationEffect.createOneShot(500, VibrationEffect.DEFAULT_AMPLITUDE);
        v.vibrate(effect, new AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_ALARM).build());
    }

    private void cancelVibration() {
        Vibrator v = ctx.getSystemService(Vibrator.class);
        if (v != null) v.cancel();
    }

    private void updateNotification() {
        if (!"idle".equals(state)) notifications.notify(NOTIFICATION_ID, buildNotification());
    }

    synchronized Notification buildNotification() {
        double pos = position();
        double cycle = pos % (fast + slow);
        boolean isFast = cycle < fast;
        long remainingMs = (long) Math.ceil(((isFast ? fast : fast + slow) - cycle) * 1000);
        String next = isFast ? "Utána: lassú séta · " + slow / 60 + " perc" : "Utána: gyors séta · " + fast / 60 + " perc";
        boolean playing = "playing".equals(state);

        Intent open = new Intent(ctx, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP);
        Notification.Builder b = new Notification.Builder(ctx, CHANNEL)
                .setSmallIcon(R.drawable.ic_stat)
                .setColor(0xff133e35)
                .setContentIntent(PendingIntent.getActivity(ctx, 0, open, PendingIntent.FLAG_IMMUTABLE))
                .setOngoing(true)
                .setOnlyAlertOnce(true)
                .setVisibility(Notification.VISIBILITY_PUBLIC)
                .setCategory(Notification.CATEGORY_PROGRESS);
        if (playing) {
            b.setContentTitle(isFast ? "Gyors séta" : "Lassú séta")
                    .setContentText(next)
                    .setUsesChronometer(true)
                    .setChronometerCountDown(true)
                    .setWhen(System.currentTimeMillis() + remainingMs)
                    .setShowWhen(true);
        } else {
            long s = remainingMs / 1000;
            b.setContentTitle("A séta szünetel")
                    .setContentText(String.format(Locale.US, "%s · %02d:%02d van hátra", isFast ? "Gyors séta" : "Lassú séta", s / 60, s % 60))
                    .setShowWhen(false);
        }
        b.addAction(action(playing ? R.drawable.ic_pause : R.drawable.ic_play, playing ? "Szünet" : "Folytatás", WalkService.ACTION_TOGGLE, 1));
        b.addAction(action(R.drawable.ic_stop, "Befejezés", WalkService.ACTION_STOP, 2));
        if (Build.VERSION.SDK_INT >= 31) b.setForegroundServiceBehavior(Notification.FOREGROUND_SERVICE_IMMEDIATE);
        return b.build();
    }

    private Notification.Action action(int icon, String title, String action, int request) {
        Intent i = new Intent(ctx, WalkService.class).setAction(action);
        PendingIntent pi = PendingIntent.getService(ctx, request, i, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        return new Notification.Action.Builder(Icon.createWithResource(ctx, icon), title, pi).build();
    }

    /** Streams generated PCM; non-blocking writes so pause/stop never wait on the audio HAL. */
    private static final class Writer extends Thread {
        volatile boolean alive = true;
        private final AudioTrack track;
        private final int fastFrames, cycleFrames;
        private long next;

        Writer(AudioTrack track, long start, int fastFrames, int cycleFrames) {
            super("lepes-audio");
            this.track = track;
            this.next = start;
            this.fastFrames = fastFrames;
            this.cycleFrames = cycleFrames;
        }

        @Override public void run() {
            android.os.Process.setThreadPriority(android.os.Process.THREAD_PRIORITY_AUDIO);
            short[] buf = new short[SR / 10];
            int off = 0, len = 0;
            while (alive) {
                if (len == 0) {
                    Tones.fill(buf, next, fastFrames, cycleFrames);
                    off = 0;
                    len = buf.length;
                }
                int written = track.write(buf, off, len, AudioTrack.WRITE_NON_BLOCKING);
                if (written < 0) break;
                if (written == 0) {
                    SystemClock.sleep(40);
                } else {
                    off += written;
                    len -= written;
                    next += written;
                }
            }
        }
    }
}

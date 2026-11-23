package hu.lepes.app;

import android.app.Service;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.IBinder;

/** Foreground service: keeps the process alive with the screen locked and hosts the notification controls. */
public class WalkService extends Service {
    static final String ACTION_TOGGLE = "hu.lepes.app.TOGGLE";
    static final String ACTION_STOP = "hu.lepes.app.STOP";

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        Walk walk = Walk.get(this);
        if (Build.VERSION.SDK_INT >= 29) {
            startForeground(Walk.NOTIFICATION_ID, walk.buildNotification(), ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK);
        } else {
            startForeground(Walk.NOTIFICATION_ID, walk.buildNotification());
        }
        String action = intent == null ? null : intent.getAction();
        if (ACTION_TOGGLE.equals(action)) walk.toggle();
        else if (ACTION_STOP.equals(action)) walk.stop();
        if (walk.isIdle()) {
            stopForeground(STOP_FOREGROUND_REMOVE);
            stopSelf();
        }
        return START_NOT_STICKY;
    }

    @Override
    public IBinder onBind(Intent intent) { return null; }
}

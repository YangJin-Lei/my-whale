package com.mywhale.app;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "CacheBackend")
public class CacheBackendPlugin extends Plugin {
    @PluginMethod
    public void start(PluginCall call) {
        try {
            int port = call.getInt("port", 8787);
            LocalCacheServer server = LocalCacheServer.getInstance(getContext());
            server.start(port);
            JSObject ret = new JSObject();
            ret.put("running", server.isRunning());
            ret.put("url", "http://127.0.0.1:" + port);
            call.resolve(ret);
        } catch (Exception e) {
            call.reject("Failed to start cache backend: " + e.getMessage());
        }
    }

    @PluginMethod
    public void stop(PluginCall call) {
        LocalCacheServer server = LocalCacheServer.getInstance(getContext());
        server.stop();
        JSObject ret = new JSObject();
        ret.put("running", false);
        call.resolve(ret);
    }

    @PluginMethod
    public void status(PluginCall call) {
        LocalCacheServer server = LocalCacheServer.getInstance(getContext());
        JSObject ret = server.getStatsJson();
        call.resolve(ret);
    }

    @Override
    protected void handleOnDestroy() {
        LocalCacheServer.getInstance(getContext()).stop();
        super.handleOnDestroy();
    }
}

package tw.com.sylong.tvcar;

import android.content.*;
import android.content.pm.*;
import android.net.Uri;
import android.os.*;
import android.webkit.WebResourceResponse;
import org.json.*;
import java.io.*;
import java.security.MessageDigest;
import java.util.*;
import java.util.concurrent.*;

/** Bound-service transport. Raw media addresses and account state never enter the page. */
final class BlueMLiveBridge implements Closeable {
    interface Listener { void completed(String requestId,String json); }
    private static final String PACKAGE="app.morphe.android.youtube";
    private static final String SERVICE="com.sylong.bluem.live.LiveResolveService";
    private static final String CERT="7cee829c140e3ba32767e541e98d99a87214b80c7b3095692549131a2d6ebf02";
    private static final String QA_CERT="b26fca7ea810d7f4c34fcd12814cbe26fdbbab46e5ce6844543efb2f28315203";
    private final Context context;
    private final Handler main=new Handler(Looper.getMainLooper());
    private final ExecutorService worker=Executors.newSingleThreadExecutor();
    private final Listener listener;
    private volatile BlueMLiveMedia media;
    private String requestId="",videoId="";
    private boolean bound;
    private Messenger remote;
    private int providerUid=-1;
    private Future<?> preparation;
    private volatile BlueMLiveMedia warming;
    private volatile long generation;
    private final Runnable timeout=()->completeError("藍色 M 直播解析逾時，請重新連線。",false);
    private final Messenger receiver=new Messenger(new Handler(Looper.getMainLooper(),message->{
        if(message.what!=2 || message.sendingUid!=providerUid)return true;
        String id=message.getData().getString("requestId","");
        if(!id.equals(requestId) || id.isEmpty())return true;
        String result=message.getData().getString("result","");
        if(result.length()>128*1024){completeError("藍色 M 回傳的直播資料過大。",true);return true;}
        final String requested=videoId;
        final long token=generation;
        preparation=worker.submit(()->{
            BlueMLiveMedia ready=null;
            try {
                JSONObject value=new JSONObject(result);
                if(!value.optBoolean("ok"))throw new IOException("此頻道目前無法由藍色 M 解析，請稍後重新連線。");
                ready=new BlueMLiveMedia(value,requested); warming=ready;
                if(token!=generation){ready.close();return;}
                ready.warmUp();
                final BlueMLiveMedia source=ready;
                main.post(()->{
                    if(token!=generation || !id.equals(requestId)){source.close();return;}
                    media=source;main.removeCallbacks(timeout);
                    JSONObject response=new JSONObject();
                    try{response.put("ok",true).put("url",source.masterUrl()).put("backend","blue-m");}catch(JSONException ignored){}
                    deliver(id,response.toString());
                });
            } catch(Exception failure) {
                if(ready!=null)ready.close();
                main.post(()->{if(token==generation && id.equals(requestId))completeError("此頻道的藍色 M 串流暫時無法連線，請重新連線。",false);});
            } finally { if(warming==ready)warming=null; }
        });return true;
    }));
    private final ServiceConnection connection=new ServiceConnection(){
        @Override public void onServiceConnected(ComponentName name,IBinder binder){
            remote=new Messenger(binder);
            if(requestId.isEmpty())return;
            Message message=Message.obtain(null,1);message.replyTo=receiver;Bundle payload=new Bundle();
            payload.putString("requestId",requestId);payload.putString("videoId",videoId);message.setData(payload);
            try{remote.send(message);}catch(RemoteException failure){completeError("藍色 M 直播服務已中斷。",false);}
        }
        @Override public void onServiceDisconnected(ComponentName name){remote=null;if(media==null&&!requestId.isEmpty())completeError("藍色 M 正在重新啟動，請重新連線。",false);}
        @Override public void onNullBinding(ComponentName name){completeError("目前藍色 M 版本不支援影視內播，請先更新。",true);}
        @Override public void onBindingDied(ComponentName name){remote=null;if(media==null&&!requestId.isEmpty())completeError("藍色 M 已更新，請重新連線。",false);}
    };
    BlueMLiveBridge(Context context,Listener listener){this.context=context.getApplicationContext();this.listener=listener;}
    private void deliver(String id,String json){listener.completed(id,json);}
    void resolve(String video,String id){
        if(!video.matches("[A-Za-z0-9_-]{11}") || !id.matches("[A-Za-z0-9_-]{1,64}"))return;
        stop();videoId=video;requestId=id;
        if(Build.VERSION.SDK_INT<28){completeError("藍色 M 內播需要 Android 9 以上。",true);return;}
        try {
            verifyProvider();
            Intent intent=new Intent().setComponent(new ComponentName(PACKAGE,SERVICE));
            bound=context.bindService(intent,connection,Context.BIND_AUTO_CREATE);
            if(!bound)throw new IOException("目前藍色 M 版本不支援影視內播，請先更新。");
            main.postDelayed(timeout,35000);
        }catch(Exception failure){completeError(failure instanceof PackageManager.NameNotFoundException?"請先安裝支援影視內播的藍色 M。":"目前藍色 M 版本尚未通過內播驗證，請安裝配套更新。",true);}
    }
    @android.annotation.TargetApi(28)
    private void verifyProvider() throws Exception {
        PackageManager pm=context.getPackageManager();
        PackageInfo info=pm.getPackageInfo(PACKAGE,PackageManager.GET_SIGNING_CERTIFICATES|PackageManager.GET_META_DATA);
        providerUid=info.applicationInfo.uid;
        Signature[] signatures=info.signingInfo.getApkContentsSigners();
        if(signatures.length!=1)throw new IOException("Unsupported signing lineage");
        byte[] digest=MessageDigest.getInstance("SHA-256").digest(signatures[0].toByteArray());
        StringBuilder hex=new StringBuilder();for(byte value:digest)hex.append(String.format(Locale.ROOT,"%02x",value));
        if(!CERT.equals(hex.toString()) && !(BuildConfig.DEBUG&&QA_CERT.equals(hex.toString())))throw new IOException("Untrusted partner");
        if(info.applicationInfo.metaData==null || !"1".equals(String.valueOf(info.applicationInfo.metaData.get("com.sylong.bluem.LIVE_BRIDGE"))))throw new IOException("Partner update required");
        pm.getServiceInfo(new ComponentName(PACKAGE,SERVICE),0);
    }
    private void completeError(String message,boolean terminal){
        if(requestId.isEmpty())return;
        String id=requestId;stop();JSONObject value=new JSONObject();
        try{value.put("ok",false).put("message",message).put("terminal",terminal);}catch(JSONException ignored){}
        listener.completed(id,value.toString());
    }
    WebResourceResponse intercept(Uri uri){
        if(uri==null || !"https".equals(uri.getScheme()) || !"sylong7708.github.io".equals(uri.getHost()) || (uri.getPort()!=-1&&uri.getPort()!=443) || uri.getUserInfo()!=null || uri.getPath()==null || !uri.getPath().startsWith(BlueMLiveMedia.PREFIX))return null;
        try{
            BlueMLiveMedia source=media;BlueMLiveMedia.Body body=source==null?null:source.response(uri.getPath());
            if(body==null)return errorResponse(410,"直播連線已關閉");
            Map<String,String> headers=new HashMap<>();headers.put("Cache-Control","no-store");headers.put("Access-Control-Allow-Origin","https://sylong7708.github.io");
            return new WebResourceResponse(body.mime,body.mime.contains("mpegurl")?"UTF-8":null,body.code,"OK",headers,body.stream);
        }catch(Exception failure){return errorResponse(502,"直播片段暫時無法載入");}
    }
    private WebResourceResponse errorResponse(int code,String text){
        return new WebResourceResponse("text/plain","UTF-8",code,"Live request unavailable",Collections.singletonMap("Cache-Control","no-store"),new ByteArrayInputStream(text.getBytes(java.nio.charset.StandardCharsets.UTF_8)));
    }
    void cancel(String id){if(id.equals(requestId))stop();}
    void reset(){stop();}
    private void stop(){
        ++generation;
        if(remote!=null&&!requestId.isEmpty()){
            Message cancel=Message.obtain(null,3);cancel.replyTo=receiver;Bundle data=new Bundle();data.putString("requestId",requestId);cancel.setData(data);
            try{remote.send(cancel);}catch(RemoteException ignored){}
        }
        main.removeCallbacks(timeout);requestId="";videoId="";
        if(preparation!=null)preparation.cancel(true);preparation=null;
        BlueMLiveMedia preparing=warming;warming=null;if(preparing!=null)preparing.close();
        BlueMLiveMedia old=media;media=null;if(old!=null)old.close();
        if(bound){try{context.unbindService(connection);}catch(IllegalArgumentException ignored){}}bound=false;remote=null;providerUid=-1;
    }
    @Override public void close(){stop();worker.shutdownNow();}
}

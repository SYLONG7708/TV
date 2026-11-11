package tw.com.sylong.tvcar;

import android.net.Uri;
import android.webkit.WebResourceResponse;
import org.json.JSONObject;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.util.*;

/** A single app-owned session, available only through the trusted licensed UI. */
final class SourceMediaBridge implements Closeable {
    interface Listener {void completed(String id,String json);}
    static final String PREFIX="/TV/__source_media__/";
    private final Listener listener;
    private volatile SourceMediaTransport transport;
    private String requestId="",path="";
    SourceMediaBridge(Listener listener){this.listener=listener;}
    synchronized void resolve(String value,String id){
        if(id==null||!id.matches("[A-Za-z0-9_-]{1,64}"))return;
        reset();requestId=id;JSONObject result=new JSONObject();
        try{
            transport=new SourceMediaTransport(value);path=PREFIX+UUID.randomUUID()+"/video.mp4";
            result.put("ok",true).put("url","https://sylong7708.github.io"+path).put("backend","source-media");
        }catch(Exception error){try{result.put("ok",false).put("message","此播放線目前無法連線，正在檢查其他訊號。");}catch(Exception ignored){}}
        listener.completed(id,result.toString());
    }
    WebResourceResponse intercept(Uri uri,Map<String,String> requestHeaders){
        if(uri==null||!"https".equals(uri.getScheme())||!"sylong7708.github.io".equals(uri.getHost())||(uri.getPort()!=-1&&uri.getPort()!=443)||uri.getUserInfo()!=null||uri.getPath()==null||!uri.getPath().startsWith(PREFIX))return null;
        SourceMediaTransport current; synchronized(this){if(!uri.getPath().equals(path)||uri.getQuery()!=null||uri.getFragment()!=null)return error(410);current=transport;}
        if(current==null)return error(410);
        String range=null;if(requestHeaders!=null)for(Map.Entry<String,String> header:requestHeaders.entrySet())if("Range".equalsIgnoreCase(header.getKey()))range=header.getValue();
        try{
            SourceMediaTransport.Body body=current.open(range);
            try{
                InputStream stream=SourceMediaRangeStream.adapt(body.code,range,body.headers,body.stream);
                Map<String,String> headers=new HashMap<>(body.headers);
                // WebView generates this from the adapted stream. Appending
                // the upstream value creates duplicate Content-Length fields.
                headers.remove("Content-Length");
                return new WebResourceResponse("video/mp4",null,body.code,body.code==206?"Partial Content":"OK",headers,stream);
            }catch(Exception error){body.close();throw error;}
        }
        catch(Exception failure){return error(502);}
    }
    private WebResourceResponse error(int code){return new WebResourceResponse("text/plain","UTF-8",code,"Media unavailable",Collections.singletonMap("Cache-Control","no-store"),new ByteArrayInputStream("此影片連線已關閉或暫時無法使用。".getBytes(StandardCharsets.UTF_8)));}
    synchronized void cancel(String id){if(id!=null&&id.equals(requestId))reset();}
    synchronized void reset(){SourceMediaTransport old=transport;transport=null;path="";requestId="";if(old!=null)old.close();}
    @Override public void close(){reset();}
}

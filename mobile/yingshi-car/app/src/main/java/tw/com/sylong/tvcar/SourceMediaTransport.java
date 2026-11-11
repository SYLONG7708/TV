package tw.com.sylong.tvcar;

import java.io.*;
import java.net.*;
import java.util.*;

/** Refresh the public gateway redirect for every MP4 range; signed URLs stay native. */
final class SourceMediaTransport implements Closeable {
    interface Opener { HttpURLConnection open(URL url) throws IOException; }
    static final class Body implements Closeable {
        final int code; final Map<String,String> headers; final InputStream stream;
        Body(int code,Map<String,String> headers,InputStream stream){this.code=code;this.headers=headers;this.stream=stream;}
        @Override public void close() throws IOException {stream.close();}
    }
    private final URL gateway;
    private final Opener opener;
    private final Set<HttpURLConnection> active=Collections.synchronizedSet(new HashSet<>());
    private volatile boolean closed;
    SourceMediaTransport(String value) throws IOException {this(value,SourceMediaTransport::publicConnection);}
    SourceMediaTransport(String value,Opener opener) throws IOException {
        if(!isGateway(value))throw new IOException("Unsupported source gateway");
        gateway=new URL(value.replace("[","%5B").replace("]","%5D"));this.opener=opener;
    }
    static boolean isGateway(String value){
        try{URL u=new URL(value);return value.length()<8192&&!value.matches("(?s).*[\\x00-\\x20\\x7f].*")&&"http".equalsIgnoreCase(u.getProtocol())&&"ccc.oiio.fun".equalsIgnoreCase(u.getHost())&&(u.getPort()==-1||u.getPort()==80)&&u.getUserInfo()==null&&u.getRef()==null;}
        catch(Exception ignored){return false;}
    }
    static boolean allowedTarget(URL url){
        String host=url.getHost().toLowerCase(Locale.ROOT);
        return url.getUserInfo()==null&&url.getRef()==null&&(("http".equals(url.getProtocol())&&host.equals("ccc.oiio.fun")&&(url.getPort()==-1||url.getPort()==80))||("https".equals(url.getProtocol())&&host.endsWith(".ctyun.cn")&&(url.getPort()==-1||url.getPort()==443)));
    }
    private static HttpURLConnection publicConnection(URL url) throws IOException {
        if(!allowedTarget(url))throw new IOException("Unsupported media redirect");
        for(InetAddress ip:InetAddress.getAllByName(url.getHost())){
            byte[] b=ip.getAddress();int a=b[0]&255;
            if(ip.isAnyLocalAddress()||ip.isLoopbackAddress()||ip.isSiteLocalAddress()||ip.isLinkLocalAddress()||ip.isMulticastAddress()||(b.length==16&&(a&254)==252)||(b.length==4&&(a==0||(a==100&&((b[1]&255)>=64&&(b[1]&255)<=127)))))throw new IOException("Private media address");
        }
        return (HttpURLConnection)url.openConnection();
    }
    static boolean validRange(String range){
        if(range==null||range.isEmpty())return true;
        if(!range.matches("bytes=(?:[0-9]{1,15}-[0-9]{0,15}|-[0-9]{1,15})"))return false;
        String[] parts=range.substring(6).split("-",-1);
        return parts[0].isEmpty()||parts[1].isEmpty()||Long.parseLong(parts[1])>=Long.parseLong(parts[0]);
    }
    Body open(String range) throws IOException {
        if(!validRange(range))throw new IOException("Invalid video range");
        URL url=gateway;
        for(int redirects=0;redirects<6;redirects++){
            if(closed)throw new IOException("Source session closed");
            if(!allowedTarget(url))throw new IOException("Unsupported media redirect");
            final HttpURLConnection connection=opener.open(url);active.add(connection);
            try{
                connection.setInstanceFollowRedirects(false);connection.setConnectTimeout(8000);connection.setReadTimeout(12000);
                connection.setRequestProperty("User-Agent","YingshiCar/1.4.32");
                connection.setRequestProperty("Accept-Encoding","identity");
                if(range!=null&&!range.isEmpty())connection.setRequestProperty("Range",range);
                int code=connection.getResponseCode();
                if(code==301||code==302||code==303||code==307||code==308){
                    String location=connection.getHeaderField("Location");if(location==null)throw new IOException("Missing media redirect");
                    url=new URL(url,location);release(connection);continue;
                }
                if(code!=200&&code!=206)throw new IOException("Media response unavailable");
                if(!"https".equals(url.getProtocol())||!url.getHost().toLowerCase(Locale.ROOT).endsWith(".ctyun.cn"))throw new IOException("Media redirect did not reach HTTPS storage");
                String type=connection.getContentType();
                if(type!=null&&(type.toLowerCase(Locale.ROOT).contains("text/")||type.toLowerCase(Locale.ROOT).contains("xml")||type.toLowerCase(Locale.ROOT).contains("json")))throw new IOException("Media response is not video");
                if(closed)throw new IOException("Source session closed");
                Map<String,String> headers=new HashMap<>();headers.put("Cache-Control","no-store");headers.put("Accept-Ranges","bytes");headers.put("Access-Control-Allow-Origin","https://sylong7708.github.io");
                for(String name:new String[]{"Content-Length","Content-Range"}){String value=connection.getHeaderField(name);if(value!=null&&value.length()<200&&!value.contains("\r")&&!value.contains("\n"))headers.put(name,value);}
                InputStream stream=new FilterInputStream(connection.getInputStream()){
                    private boolean done;
                    @Override public void close() throws IOException {if(done)return;done=true;try{super.close();}finally{release(connection);}}
                };
                return new Body(code,headers,stream);
            }catch(IOException|RuntimeException error){release(connection);throw error;}
        }
        throw new IOException("Too many media redirects");
    }
    private void release(HttpURLConnection connection){active.remove(connection);connection.disconnect();}
    @Override public void close(){closed=true;HttpURLConnection[] rows; synchronized(active){rows=active.toArray(new HttpURLConnection[0]);}for(HttpURLConnection connection:rows)release(connection);}
}

package tw.com.sylong.tvcar;

import org.json.*;
import java.io.*;
import java.net.*;
import java.nio.charset.StandardCharsets;
import java.util.*;
import java.util.concurrent.*;

/** Converts Morphe's live fragmented MP4 tracks into an app-local HLS window. */
final class BlueMLiveMedia implements Closeable {
    static final String PREFIX = "/TV/__bluem_live__/";
    private static final int MAX_SEGMENT_BYTES = 8 * 1024 * 1024;
    final String id = UUID.randomUUID().toString();
    final String videoId;
    private final String userAgent;
    private final Map<Integer, Track> tracks = new LinkedHashMap<>();
    private final Map<Integer, byte[]> initialization = new ConcurrentHashMap<>();
    private final Set<HttpURLConnection> connections = Collections.newSetFromMap(new ConcurrentHashMap<>());
    private final Track audio;
    private final Track reference;
    private volatile boolean closed;
    private long head, headCheckedAt;

    static final class Body {
        final String mime; final int code; final InputStream stream;
        Body(String mime, int code, InputStream stream) { this.mime=mime; this.code=code; this.stream=stream; }
        static Body text(String mime,String value) { return new Body(mime,200,new ByteArrayInputStream(value.getBytes(StandardCharsets.UTF_8))); }
    }
    private static final class Track {
        final int itag,width,height,bitrate; final String url,codec;
        Track(JSONObject row) throws Exception {
            itag=row.getInt("itag"); url=row.getString("url"); width=row.optInt("width"); height=row.optInt("height"); bitrate=Math.max(32000,row.optInt("bitrate",1000000));
            String mime=row.getString("mime");
            java.util.regex.Matcher match=java.util.regex.Pattern.compile("codecs=\"([A-Za-z0-9._-]+)\"").matcher(mime);
            if(!allowedUrl(url) || !match.find()) throw new IOException("Invalid live media descriptor");
            codec=match.group(1);
            if(height>0 && (!mime.startsWith("video/mp4") || !codec.startsWith("avc1") || width>1920 || height>1080)) throw new IOException("Unsupported video track");
            if(height==0 && (!mime.startsWith("audio/mp4") || !codec.startsWith("mp4a"))) throw new IOException("Unsupported audio track");
        }
    }
    BlueMLiveMedia(JSONObject source,String requestedVideo) throws Exception {
        if(!source.optBoolean("ok") || !"morphe".equals(source.optString("backend")) || !requestedVideo.equals(source.optString("videoId"))) throw new IOException("Morphe did not resolve the requested live channel");
        videoId=requestedVideo; userAgent=source.getString("userAgent");
        if(userAgent.length()>512 || userAgent.indexOf('\n')>=0 || userAgent.indexOf('\r')>=0) throw new IOException("Invalid media client");
        audio=new Track(source.getJSONObject("audio")); tracks.put(audio.itag,audio);
        JSONArray video=source.getJSONArray("video");
        if(video.length()<1 || video.length()>12) throw new IOException("Invalid live track count");
        List<Track> videos=new ArrayList<>();
        for(int i=0;i<video.length();i++) videos.add(new Track(video.getJSONObject(i)));
        Collections.sort(videos,(left,right)->Integer.compare(left.height,right.height));
        for(Track track:videos) tracks.put(track.itag,track);
        reference=videos.get(Math.min(2,videos.size()-1));
    }
    static boolean allowedUrl(String value) {
        try { URI uri=URI.create(value); String host=uri.getHost();
            return "https".equals(uri.getScheme()) && host!=null && host.toLowerCase(Locale.ROOT).endsWith(".googlevideo.com")
                && uri.getUserInfo()==null && (uri.getPort()==-1 || uri.getPort()==443);
        } catch(Exception invalid) { return false; }
    }
    String masterUrl() { return "https://sylong7708.github.io"+PREFIX+id+"/master.m3u8"; }
    void warmUp() throws Exception { currentHead(); init(audio); init(reference); }
    synchronized long currentHead() throws Exception {
        if(closed) throw new IOException("Live session closed");
        long now=TimeUnit.NANOSECONDS.toMillis(System.nanoTime());
        if(head>0 && now-headCheckedAt<2500) return head;
        head=Math.min(readHead(reference),readHead(audio)); headCheckedAt=now;
        if(head<8) throw new IOException("Live edge unavailable");
        return head;
    }
    private long readHead(Track track) throws Exception {
        HttpURLConnection connection=open(track.url,"bytes=0-1023");
        try(InputStream stream=connection.getInputStream()) {
            long value=Long.parseLong(connection.getHeaderField("X-Head-Seqnum")); stream.read(); return value;
        } finally { release(connection); }
    }
    private byte[] init(Track track) throws Exception {
        byte[] existing=initialization.get(track.itag); if(existing!=null) return existing;
        HttpURLConnection connection=open(track.url,"bytes=0-32767");
        byte[] bytes;
        try(InputStream stream=connection.getInputStream()) { bytes=extractInitialization(readAtMost(stream,32768)); }
        finally { release(connection); }
        initialization.put(track.itag,bytes); return bytes;
    }
    static byte[] extractInitialization(byte[] bytes) throws IOException {
        ByteArrayOutputStream output=new ByteArrayOutputStream(); boolean ftyp=false,moov=false;
        for(int offset=0;offset+8<=bytes.length;) {
            long size=0; for(int i=0;i<4;i++) size=(size<<8)|(bytes[offset+i]&255);
            String type=new String(bytes,offset+4,4,StandardCharsets.US_ASCII);
            int header=8;
            if(size==1) { if(offset+16>bytes.length) break; size=0; for(int i=8;i<16;i++)size=(size<<8)|(bytes[offset+i]&255); header=16; }
            if(size<header || size>bytes.length-offset) break;
            if("ftyp".equals(type) || "moov".equals(type)) { output.write(bytes,offset,(int)size); ftyp|="ftyp".equals(type); moov|="moov".equals(type); }
            offset+=(int)size;
            if(ftyp && moov) return output.toByteArray();
        }
        throw new IOException("Live initialization metadata missing");
    }
    private static byte[] readAtMost(InputStream input,int limit) throws IOException {
        ByteArrayOutputStream output=new ByteArrayOutputStream();byte[] buffer=new byte[4096];
        while(output.size()<limit) { int n=input.read(buffer,0,Math.min(buffer.length,limit-output.size()));if(n<0)break;output.write(buffer,0,n); }
        return output.toByteArray();
    }
    Body response(String path) throws Exception {
        String base=PREFIX+id+"/"; if(closed || !path.startsWith(base)) return null;
        String tail=path.substring(base.length());
        if("master.m3u8".equals(tail)) {
            StringBuilder text=new StringBuilder("#EXTM3U\n#EXT-X-VERSION:7\n");
            text.append("#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID=\"audio\",NAME=\"原音\",DEFAULT=YES,AUTOSELECT=YES,URI=\"").append(audio.itag).append("/playlist.m3u8\"\n");
            for(Track track:tracks.values()) if(track.height>0) text.append("#EXT-X-STREAM-INF:BANDWIDTH=").append(track.bitrate+audio.bitrate)
                .append(",RESOLUTION=").append(track.width).append('x').append(track.height).append(",CODECS=\"").append(track.codec).append(',').append(audio.codec)
                .append("\",AUDIO=\"audio\"\n").append(track.itag).append("/playlist.m3u8\n");
            return Body.text("application/vnd.apple.mpegurl",text.toString());
        }
        String[] parts=tail.split("/"); if(parts.length!=2 || !parts[0].matches("[0-9]{1,3}")) return null;
        Track track=tracks.get(Integer.parseInt(parts[0])); if(track==null) return null;
        if("playlist.m3u8".equals(parts[1])) {
            long end=currentHead()-2,start=end-5;
            StringBuilder text=new StringBuilder("#EXTM3U\n#EXT-X-VERSION:7\n#EXT-X-TARGETDURATION:6\n#EXT-X-MEDIA-SEQUENCE:"+start+"\n#EXT-X-MAP:URI=\"init.mp4\"\n");
            for(long seq=start;seq<=end;seq++) text.append("#EXTINF:5.0,\n").append(seq).append(".m4s\n");
            return Body.text("application/vnd.apple.mpegurl",text.toString());
        }
        if("init.mp4".equals(parts[1])) return new Body("video/mp4",200,new ByteArrayInputStream(init(track)));
        if(!parts[1].matches("[0-9]{1,12}\\.m4s")) return null;
        long sequence=Long.parseLong(parts[1].substring(0,parts[1].length()-4));
        long latest=currentHead(); if(sequence<latest-300 || sequence>latest+2) return null;
        HttpURLConnection connection=open(track.url+"&sq="+sequence,null);
        InputStream stream=connection.getInputStream();
        return new Body("video/mp4",200,new FilterInputStream(stream) {
            int bytes;
            @Override public int read() throws IOException {int value=super.read();if(value>=0 && ++bytes>MAX_SEGMENT_BYTES)throw new IOException("Live segment exceeds limit");return value;}
            @Override public int read(byte[] b,int offset,int length) throws IOException {int n=super.read(b,offset,length);if(n>0 && (bytes+=n)>MAX_SEGMENT_BYTES)throw new IOException("Live segment exceeds limit");return n;}
            @Override public void close() throws IOException {try{super.close();}finally{release(connection);}}
        });
    }
    private HttpURLConnection open(String url,String range) throws Exception {
        for(int redirects=0;redirects<3;redirects++) {
            if(closed || !allowedUrl(url)) throw new IOException("Invalid live media request");
            HttpURLConnection connection=(HttpURLConnection)new URL(url).openConnection();connections.add(connection);
            connection.setConnectTimeout(6000);connection.setReadTimeout(10000);connection.setInstanceFollowRedirects(false);
            connection.setRequestProperty("User-Agent",userAgent);
            if(range!=null)connection.setRequestProperty("Range",range);
            try {
                int code=connection.getResponseCode();
                if(code==301 || code==302 || code==307 || code==308) {String next=new URL(new URL(url),connection.getHeaderField("Location")).toString();release(connection);url=next;continue;}
                if(code<200 || code>=300) throw new IOException("Live upstream HTTP "+code);
                if(closed)throw new IOException("Live session closed");
                return connection;
            } catch(Exception failure) {release(connection);throw failure;}
        }
        throw new IOException("Live redirect limit");
    }
    private void release(HttpURLConnection connection) {connections.remove(connection);connection.disconnect();}
    @Override public void close() {closed=true;for(HttpURLConnection connection:connections)connection.disconnect();connections.clear();initialization.clear();}
}

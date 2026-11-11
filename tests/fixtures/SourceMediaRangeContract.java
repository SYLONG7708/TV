package tw.com.sylong.tvcar;
import java.io.*;
import java.util.*;
public final class SourceMediaRangeContract {
    static void check(boolean value,String message){if(!value)throw new AssertionError(message);}
    static Map<String,String> headers(String interval){return Collections.singletonMap("Content-Range",interval);}
    public static void run() throws Exception {
        InputStream seek=SourceMediaRangeStream.adapt(206,"bytes=500-",headers("bytes 500-503/2000"),new ByteArrayInputStream(new byte[]{17,18,19,20}));
        check(seek.available()==504,"Chromium sees the original byte interval");
        check(seek.skip(500)==500,"WebView seek consumes only the virtual prefix");check(seek.available()==4,"response length is the actual slice");
        check(seek.read()==17,"first byte was not skipped twice");check(Arrays.equals(seek.readAllBytes(),new byte[]{18,19,20}),"remaining bytes match the upstream slice");seek.close();
        InputStream suffix=SourceMediaRangeStream.adapt(206,"bytes=-2",headers("bytes 998-999/1000"),new ByteArrayInputStream(new byte[]{69,70}));
        check(suffix.available()==2&&suffix.read()==69,"suffix ranges must not get a virtual prefix");suffix.close();
        long offset=3_000_000_000L;
        InputStream large=SourceMediaRangeStream.adapt(206,"bytes="+offset+"-",headers("bytes "+offset+"-3000000001/3000000002"),new ByteArrayInputStream(new byte[]{23,24}));
        check(large.available()==0,"unknown size avoids signed 32-bit overflow");long left=offset;while(left>0){long skipped=large.skip(left);check(skipped>0&&skipped<=Integer.MAX_VALUE,"bounded JNI skip");left-=skipped;}
        check(large.read()==23,"large seek preserves body bytes");large.close();
        boolean rejected=false;try{SourceMediaRangeStream.adapt(206,"bytes=500-",headers("bytes 400-503/2000"),new ByteArrayInputStream(new byte[0]));}catch(IOException expected){rejected=true;}check(rejected,"mismatched upstream range rejected");
        System.out.println("PASS WebView range offsets, suffix requests and large offsets");
    }
}

package tw.com.sylong.tvcar;

import java.io.*;
import java.util.Map;
import java.util.regex.*;

/**
 * WebView seeks its intercepted stream even when the upstream already returned
 * a 206 slice. Consume that seek as a virtual prefix, without downloading it.
 * See Chromium InputStreamReader::SkipToRequestedRange and wry issue 1864.
 */
final class SourceMediaRangeStream extends InputStream {
    private final InputStream body;
    private long prefix,remaining;
    private SourceMediaRangeStream(InputStream body,long prefix,long length){this.body=body;this.prefix=prefix;remaining=length;}
    static InputStream adapt(int status,String range,Map<String,String> headers,InputStream body) throws IOException {
        long prefix=0,length=-1;
        try{
            if(status==206){
                Matcher interval=Pattern.compile("bytes ([0-9]{1,18})-([0-9]{1,18})/(?:[0-9]{1,18}|\\*)").matcher(headers.getOrDefault("Content-Range",""));
                if(!interval.matches())throw new IOException("Missing video byte interval");
                long start=Long.parseLong(interval.group(1)),end=Long.parseLong(interval.group(2));
                if(end<start)throw new IOException("Invalid video byte interval");length=end-start+1;
                Matcher requested=Pattern.compile("bytes=([0-9]{1,15})-([0-9]{0,15})").matcher(range==null?"":range);
                if(requested.matches()){
                    if(start!=Long.parseLong(requested.group(1)))throw new IOException("Unexpected video byte interval");
                    if(!requested.group(2).isEmpty()&&end>Long.parseLong(requested.group(2)))throw new IOException("Unexpected video byte interval");
                    prefix=start;
                }
            }else if(headers.containsKey("Content-Length"))length=Long.parseLong(headers.get("Content-Length"));
        }catch(NumberFormatException failure){throw new IOException("Invalid video length",failure);}
        return new SourceMediaRangeStream(body,prefix,length);
    }
    @Override public int available() throws IOException {
        long size=prefix+(remaining>=0?remaining:body.available());
        // Chromium's JNI size is signed 32-bit. Zero denotes an unknown size
        // and avoids truncating a large valid byte offset.
        return size>Integer.MAX_VALUE?0:(int)Math.max(0,size);
    }
    @Override public long skip(long count) throws IOException {
        if(count<=0)return 0;
        if(prefix>0){long advanced=Math.min(Math.min(count,prefix),(long)Integer.MAX_VALUE);prefix-=advanced;return advanced;}
        long advanced=body.skip(count);if(remaining>=0)remaining=Math.max(0,remaining-advanced);return advanced;
    }
    @Override public int read() throws IOException {int value=body.read();if(value>=0&&remaining>0)remaining--;return value;}
    @Override public int read(byte[] buffer,int offset,int length) throws IOException {int count=body.read(buffer,offset,length);if(count>0&&remaining>=0)remaining=Math.max(0,remaining-count);return count;}
    @Override public void close() throws IOException {body.close();}
}

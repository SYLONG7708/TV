package tw.com.sylong.tvcar;

import java.io.*;
import java.nio.*;
import java.nio.charset.StandardCharsets;
import java.util.Arrays;

/** Offline boundary checks for untrusted media metadata; no stream URLs or Android device. */
public final class BlueMLiveMediaTest {
    private static int checks;
    private static void check(boolean value) { checks++; if(!value)throw new AssertionError("Check "+checks); }
    private static byte[] box(String type, byte[] body) {
        return ByteBuffer.allocate(body.length+8).putInt(body.length+8).put(type.getBytes(StandardCharsets.US_ASCII)).put(body).array();
    }
    private static byte[] join(byte[]... values)throws IOException {
        ByteArrayOutputStream out=new ByteArrayOutputStream();for(byte[] value:values)out.write(value);return out.toByteArray();
    }
    private static void rejects(byte[] bytes)throws Exception {
        try { BlueMLiveMedia.extractInitialization(bytes);throw new AssertionError("Malformed metadata accepted"); }
        catch(IOException expected) { checks++; }
    }
    public static void main(String[] args)throws Exception {
        byte[] ftyp=box("ftyp",new byte[]{1,2,3,4}),moov=box("moov",new byte[]{5,6}),mdat=box("mdat",new byte[]{7,8});
        check(Arrays.equals(BlueMLiveMedia.extractInitialization(join(ftyp,moov,mdat)),join(ftyp,moov)));
        check(Arrays.equals(BlueMLiveMedia.extractInitialization(join(ftyp,box("free",new byte[0]),moov,mdat)),join(ftyp,moov)));
        rejects(ftyp);rejects(join(ftyp,Arrays.copyOf(moov,moov.length-1)));rejects(new byte[0]);
        rejects(join(ftyp,ByteBuffer.allocate(8).putInt(Integer.MAX_VALUE).put("moov".getBytes(StandardCharsets.US_ASCII)).array()));
        rejects(join(ftyp,ByteBuffer.allocate(16).putInt(1).put("moov".getBytes(StandardCharsets.US_ASCII)).putLong(Long.MAX_VALUE).array()));
        rejects(join(ftyp,ByteBuffer.allocate(8).putInt(0).put("moov".getBytes(StandardCharsets.US_ASCII)).array()));
        for(String url:new String[]{"https://r1.googlevideo.com/videoplayback?live=1","https://r2.googlevideo.com:443/path"})check(BlueMLiveMedia.allowedUrl(url));
        for(String url:new String[]{"http://r1.googlevideo.com/x","https://googlevideo.com.evil.test/x","https://r1.googlevideo.com@127.0.0.1/x","https://user@r1.googlevideo.com/x","https://r1.googlevideo.com:444/x","file:///data/local/private","https://127.0.0.1/x","https://googlevideo.com/x","not a URL"})check(!BlueMLiveMedia.allowedUrl(url));
        System.out.println("Blue M live media: "+checks+" checks PASS");
    }
}

package tw.com.sylong.tvcar;
import java.net.*;
import java.io.*;
import java.util.*;
public final class SourceMediaTransportContract {
    static void check(boolean value,String message){if(!value)throw new AssertionError(message);}
    static final class Connection extends HttpURLConnection {
        final int status;final Map<String,String> headers;boolean disconnected;
        Connection(URL url,int status,Map<String,String> headers){super(url);this.status=status;this.headers=headers;}
        public int getResponseCode(){return status;}
        public String getHeaderField(String name){return headers.get(name);}
        public String getContentType(){return "application/octet-stream";}
        public InputStream getInputStream(){return new ByteArrayInputStream(new byte[]{1,2});}
        public void disconnect(){disconnected=true;}public boolean usingProxy(){return false;}public void connect(){}
    }
    public static void main(String[] args) throws Exception {
        check(SourceMediaTransport.isGateway("http://ccc.oiio.fun/file.mp4"),"declared gateway");
        for(String url:new String[]{"http://127.0.0.1/file.mp4","http://ccc.oiio.fun:81/file.mp4","http://u:p@ccc.oiio.fun/file.mp4"})check(!SourceMediaTransport.isGateway(url),"reject unknown gateway");
        check(!SourceMediaTransport.allowedTarget(new URL("https://ctyun.cn.evil.invalid/file.mp4")),"reject redirect host spoofing");
        for(String range:new String[]{"bytes=10-1","bytes=0-1,4-5","bytes=1-2\r\nCookie: x"})check(!SourceMediaTransport.validRange(range),"reject invalid range");
        final int[] refreshed={0};List<Connection> opened=new ArrayList<>();List<String> targets=new ArrayList<>();
        SourceMediaTransport transport=new SourceMediaTransport("http://ccc.oiio.fun/file.mp4",url->{
            Connection c;
            if(url.getHost().equals("ccc.oiio.fun")){int generation=++refreshed[0];c=new Connection(url,302,Collections.singletonMap("Location","https://media.ctyun.cn/file.mp4?signature="+generation));}
            else {targets.add(url.toString());Map<String,String> headers=new HashMap<>();headers.put("Content-Range","bytes 0-1/200000");headers.put("Content-Length","2");c=new Connection(url,206,headers);}
            opened.add(c);return c;
        });
        for(int i=0;i<2;i++){try(SourceMediaTransport.Body body=transport.open(i==0?"bytes=0-1":"bytes=1000-1001")){check(body.code==206,"partial response");check(body.headers.get("Cache-Control").equals("no-store"),"do not cache signed transport");check(body.stream.read()==1,"streamed bytes");}}
        check(refreshed[0]==2,"each range refreshes the original gateway");check(!targets.get(0).equals(targets.get(1)),"do not reuse expired signed URL");
        check(opened.stream().allMatch(c->c.disconnected),"all closed range requests disconnected");
        check(opened.get(3).getRequestProperty("Range").equals("bytes=1000-1001"),"preserve seek range across redirect");
        transport.close();boolean cancelled=false;try{transport.open("bytes=0-1");}catch(IOException expected){cancelled=true;}check(cancelled,"closed session cannot be reused");
        SourceMediaTransport unsafe=new SourceMediaTransport("http://ccc.oiio.fun/file.mp4",url->new Connection(url,302,Collections.singletonMap("Location","http://127.0.0.1/private")));
        boolean rejected=false;try{unsafe.open("bytes=0-1");}catch(IOException expected){rejected=true;}check(rejected,"private redirect rejected before fetch");unsafe.close();
        System.out.println("PASS SourceMediaTransport range, renewal, URL policy and cancellation");
    }
}

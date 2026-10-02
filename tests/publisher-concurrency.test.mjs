import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {execFileSync, spawnSync} from 'node:child_process';
import test from 'node:test';

test('publisher rejects an externally replaced data snapshot before uploading or staging local changes', async t => {
  const shell=process.platform==='win32'?'powershell.exe':'pwsh';
  if(spawnSync(shell,['-NoProfile','-NonInteractive','-Command','$PSVersionTable.PSVersion.ToString()'],{windowsHide:true}).error){t.skip('PowerShell unavailable');return;}
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'oktv-publisher-test-'));
  t.after(async()=>{assert.ok(path.resolve(root).startsWith(path.resolve(os.tmpdir())+path.sep+'oktv-publisher-test-'));await fs.rm(root,{recursive:true,force:true});});
  const remote=path.join(root,'remote.git'),writer=path.join(root,'writer'),other=path.join(root,'other');
  const git=(cwd,...args)=>execFileSync('git',['-C',cwd,...args],{encoding:'utf8',windowsHide:true,stdio:['ignore','pipe','pipe']}).trim();
  await fs.mkdir(remote);git(remote,'init','--bare');await fs.mkdir(writer);git(writer,'init');git(writer,'config','user.name','Fixture');git(writer,'config','user.email','fixture@example.invalid');
  await fs.mkdir(path.join(writer,'docs/data'),{recursive:true});await fs.writeFile(path.join(writer,'docs/data/a.json'),'old');git(writer,'add','.');git(writer,'commit','-m','Original data');git(writer,'branch','-M','gh-pages');git(writer,'remote','add','origin',remote);git(writer,'push','origin','gh-pages');
  git(root,'clone','--branch','gh-pages',remote,other);git(other,'config','user.name','Fixture');git(other,'config','user.email','fixture@example.invalid');await fs.writeFile(path.join(other,'docs/data/a.json'),'new external data');git(other,'commit','-am','External publisher');git(other,'push','origin','gh-pages');
  const newer=git(other,'rev-parse','HEAD');await fs.writeFile(path.join(writer,'docs/data/a.json'),'pending local data');
  const psQuote=v=>"'"+v.replaceAll("'","''")+"'";
  const script=path.resolve(import.meta.dirname,'../tools/publish-gh-pages-batched.ps1');
  const command=`try { & ${psQuote(script)} -RepositoryRoot ${psQuote(writer)} -RunId '123' -RunAttempt '1' -PushAttempts 1 } catch { [Console]::Error.WriteLine($_.Exception.Message); exit 1 }`;
  const result=spawnSync(shell,['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-Command',command],{encoding:'utf8',windowsHide:true,timeout:30000});
  assert.notEqual(result.status,0);assert.match(result.stdout+result.stderr,/refusing to upload a stale snapshot/);
  assert.equal(git(remote,'rev-parse','refs/heads/gh-pages'),newer);
  assert.equal(git(remote,'for-each-ref','--format=%(refname)','refs/heads/oktv-pages-upload-'),'');
  assert.equal(git(writer,'diff','--cached','--name-only'),'');
  assert.equal(await fs.readFile(path.join(writer,'docs/data/a.json'),'utf8'),'pending local data');
});

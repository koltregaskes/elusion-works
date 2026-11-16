import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
test('catalogue failure is a red check while success stays green',()=>{
  const source=fs.readFileSync(new URL('./catalogue-health.mjs',import.meta.url),'utf8');
  for(const [outcome,expected]of [['success',0],['failure',1],['skipped',1]]){
    const messages=[],mockProcess={env:{CATALOGUE_OUTCOME:outcome}};
    vm.runInNewContext(source,{process:mockProcess,console:{log:value=>messages.push(value),error:value=>messages.push(value)}});
    assert.equal(mockProcess.exitCode??0,expected,outcome);
    assert.equal(messages.length,1,'a health result cannot be silent');
  }
});

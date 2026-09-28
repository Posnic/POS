'use strict';
const test = require('node:test'),
  assert = require('node:assert/strict');
const fs = require('node:fs'),
  os = require('node:os'),
  path = require('node:path');
const { KitchenAudioQueue } = require('../src/kitchen-audio-queue');
function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kitchen-audio-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'queue.json');
  const settings = () => ({
    talkEnabled: true,
    outputs: [
      { id: 'kitchen', label: 'Kitchen' },
      { id: 'pass', label: 'Pass' },
    ],
    volume: 0.5,
  });
  return { file, settings, q: new KitchenAudioQueue(file, settings) };
}
function done(q, task, error) {
  return q.ack({ jobId: task.jobId, targetId: task.target.id, index: task.index, error });
}
test('speakers complete independently; disconnected output retries without repeating completed output', (t) => {
  const { q } = fixture(t);
  q.enqueue({ steps: [{ text: 'Table 5' }] }, 'order-5');
  assert.equal(q.next().target.id, 'kitchen');
  done(q, q.next(), 'Speaker disconnected');
  assert.equal(q.next().target.id, 'pass');
  done(q, q.next());
  assert.equal(q.next(), null);
  q.jobs[0].targets[0].next = 0;
  assert.equal(q.next().target.id, 'kitchen');
  done(q, q.next());
  assert.equal(q.status().jobs[0].complete, true);
});
test('restart retains cursor and immutable duplicate job does not enqueue again', (t) => {
  const { q, file, settings } = fixture(t);
  q.enqueue({ steps: [{ text: 'One' }, { text: 'Two' }] }, 'same');
  done(q, q.next());
  const restored = new KitchenAudioQueue(file, settings);
  assert.equal(restored.next().index, 1);
  restored.enqueue({ steps: [{ text: 'Should not replay' }] }, 'same');
  assert.equal(restored.jobs.length, 1);
  assert.equal(restored.ack({ jobId: 'same', targetId: 'kitchen', index: 0 }), false);
});
test('recording pauses order queue; only its owner can upload; retried upload is idempotent', (t) => {
  const { q } = fixture(t);
  q.enqueue({ steps: [{ text: 'Order' }] });
  const lease = q.start('alice');
  assert.equal(q.next(), null);
  assert.throws(() => q.voice('bob', lease.id, 'data:audio/webm;base64,YQ=='), /expired/);
  const data = 'data:audio/webm;base64,YQ==';
  q.voice('alice', lease.id, data);
  q.voice('alice', lease.id, data);
  assert.equal(q.jobs.length, 2);
  assert.equal(q.next().jobId, q.jobs[0].id);
});
test('expired recording resumes announcements and rejects late voice', (t) => {
  const { q } = fixture(t);
  q.enqueue({ steps: [{ text: 'Order' }] });
  const lease = q.start('alice');
  q.recordings.get(lease.id).until = 0;
  q.recordings.get(lease.id).uploadUntil = 0;
  assert.ok(q.next());
  assert.throws(() => q.voice('alice', lease.id, 'data:audio/webm;base64,YQ=='), /expired/);
});

test('simultaneous staff messages persist in received order and each speaker plays each once', async t => {
  const {q,file,settings}=fixture(t);
  const senders=Array.from({length:12},(_,i)=>({owner:'staff-'+i,recording:q.start('staff-'+i)}));
  const data='data:audio/webm;base64,YQ==';
  await Promise.all(senders.map(async s=>q.voice(s.owner,s.recording.id,data)));
  await Promise.all(senders.map(async s=>q.voice(s.owner,s.recording.id,data)));
  assert.equal(q.jobs.length,12);
  const restored=new KitchenAudioQueue(file,settings),played=[];
  let task;
  while((task=restored.next())){played.push([task.target.id,task.jobId]);done(restored,task);}
  for(const output of ['kitchen','pass'])assert.deepEqual(played.filter(p=>p[0]===output).map(p=>p[1]),senders.map(s=>s.recording.id));
  assert.ok(restored.jobs.every(j=>j.complete));
});

test('one sender cannot cancel another; a delayed upload does not pause playback indefinitely',t=>{
  const {q}=fixture(t),a=q.start('alice'),b=q.start('bob');
  q.cancel('alice',b.id);assert.ok(q.recordings.has(b.id));
  q.voice('alice',a.id,'data:audio/webm;base64,YQ==');assert.equal(q.next(),null);
  q.recordings.get(b.id).until=0;assert.equal(q.next().jobId,a.id);
  q.voice('bob',b.id,'data:audio/webm;base64,YQ==');assert.equal(q.jobs.length,2);
});

test('a voice arriving during a multi-line order does not interrupt its remaining lines',t=>{
  const {q}=fixture(t);
  q.enqueue({steps:[{text:'One'},{text:'Two'}]},'order');done(q,q.next());
  const s=q.start('staff');q.voice('staff',s.id,'data:audio/webm;base64,YQ==');
  assert.equal(q.next().jobId,'order');assert.equal(q.next().index,1);
});

test('trimming completed history never discards an older disconnected message',t=>{
  const {q,file,settings}=fixture(t);
  q.enqueue({steps:[{text:'Waiting'}],outputIds:['kitchen']},'keep');
  done(q,q.next(),'Disconnected');q.jobs[0].targets[0].next=Date.now()+3600000;
  for(let i=0;i<120;i++){
    q.enqueue({steps:[{text:'Later'}],outputIds:['pass']},'later-'+i);
    done(q,q.next());
  }
  const restored=new KitchenAudioQueue(file,settings);
  assert.equal(restored.jobs[0].id,'keep');assert.equal(restored.jobs[0].complete,false);
  restored.jobs[0].targets[0].next=0;assert.equal(restored.next().jobId,'keep');
});
test('one unavailable speaker does not hold up other speakers on later orders', (t) => {
  const { q } = fixture(t);
  q.enqueue({ steps: [{ text: 'One' }] }, 'one');
  q.enqueue({ steps: [{ text: 'Two' }] }, 'two');
  done(q, q.next(), 'Offline');
  done(q, q.next());
  assert.equal(q.next().jobId, 'two');
  assert.equal(q.next().target.id, 'pass');
});
test('no speaker fallback, empty payloads and excessive queues fail visibly', (t) => {
  const { q } = fixture(t);
  assert.throws(() => q.enqueue({ steps: [] }), /Invalid/);
  assert.throws(() => q.enqueue({ steps: [{ text: 'x' }], outputIds: ['reception'] }), /Choose/);
  for (let i = 0; i < 50; i++) q.enqueue({ steps: [{ text: 'x' }] }, String(i));
  assert.throws(() => q.enqueue({ steps: [{ text: 'x' }] }), /full/);
  assert.equal(q.jobs.length, 50);
});
test('a broken persistence file is preserved, not replaced with an empty queue', (t) => {
  const { file, settings } = fixture(t);
  fs.writeFileSync(file, 'broken');
  assert.throws(() => new KitchenAudioQueue(file, settings));
  assert.equal(fs.readFileSync(file, 'utf8'), 'broken');
});

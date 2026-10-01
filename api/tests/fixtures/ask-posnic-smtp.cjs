'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const net = require('node:net');
require.cache[require.resolve('../../src/models/base.model')] = { exports: class {
  async getCollection() { throw new Error('The SMTP check must not access an application database.'); }
  static async getDb() { throw new Error('The SMTP check must not access an application database.'); }
} };
const runner = require('../../src/services/ask-posnic-runner.service');

// A loopback SMTP peer, never an external recipient or provider account.
async function withSmtp(rejectRecipient, run) {
  const sockets = new Set(), messages = [];
  const server = net.createServer(socket => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    socket.setEncoding('utf8');
    socket.write('220 synthetic.example.invalid ESMTP\r\n');
    let buffer = '', data = false, message = [];
    socket.on('data', chunk => {
      buffer += chunk;
      while (buffer.includes('\r\n')) {
        const index = buffer.indexOf('\r\n');
        const line = buffer.slice(0, index);
        buffer = buffer.slice(index + 2);
        if (data) {
          if (line !== '.') { message.push(line); continue; }
          messages.push(message.join('\n')); message = []; data = false;
          socket.write('250 2.0.0 synthetic-message-accepted\r\n');
        } else if (/^EHLO|^HELO/.test(line)) socket.write('250-synthetic.example.invalid\r\n250 AUTH PLAIN\r\n');
        else if (/^AUTH/.test(line)) socket.write('235 2.7.0 Authenticated\r\n');
        else if (/^MAIL FROM/.test(line)) socket.write('250 2.1.0 Sender accepted\r\n');
        else if (/^RCPT TO/.test(line)) socket.write(rejectRecipient ? '550 5.1.1 Recipient rejected\r\n' : '250 2.1.5 Recipient accepted\r\n');
        else if (line === 'DATA') { data = true; socket.write('354 End with dot\r\n'); }
        else if (line === 'QUIT') socket.end('221 Goodbye\r\n');
        else socket.write('250 OK\r\n');
      }
    });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const report = {
    answer: 'Synthetic sales were 42.50.', metrics: [{ label: 'Sales', value: '42.50' }], source: 'Sales report',
    range: { starting_date: new Date('2026-10-01T00:00:00Z'), ending_date: new Date('2026-10-01T23:59:59Z') },
    branch: { branch_name: 'Synthetic outlet', email_smtp_host: '127.0.0.1', email_smtp_port: server.address().port, email_smtp_username: 'sender@example.invalid', email_smtp_password: 'synthetic-only' },
  };
  try { await run(report, messages); }
  finally { for (const socket of sockets) socket.destroy(); await new Promise(resolve => server.close(resolve)); }
}

test('scheduled summary uses the actual SMTP transport and preserves its acknowledgement', async () => {
  await withSmtp(false, async (report, messages) => {
    const receipt = await runner.deliver({ report: 'sales', channel: 'email', destination: 'owner@example.invalid' }, report);
    assert.equal(receipt.status, 'sent');
    assert.equal(receipt.provider, 'smtp');
    assert.match(receipt.reference, /^<.+>$/);
    assert.equal(messages.length, 1);
    assert.match(messages[0], /Synthetic sales were 42.50/);
    assert.match(messages[0], /Outlet: Synthetic outlet/);
    assert.match(messages[0], /Message-ID:/i);
    assert.ok(!messages[0].includes('synthetic-only'));
  });
});

test('a rejected SMTP recipient never becomes a sent scheduled summary', async () => {
  await withSmtp(true, async (report, messages) => {
    await assert.rejects(runner.deliver({ report: 'sales', channel: 'email', destination: 'owner@example.invalid' }, report));
    assert.equal(messages.length, 0);
  });
});
